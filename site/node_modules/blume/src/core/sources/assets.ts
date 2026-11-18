import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";

import { extname, join } from "pathe";

import type { Diagnostic } from "../types.ts";
import { hashText } from "./cache.ts";

// A Markdown image as the lowerers write it (`image()` in `lower.ts`): the
// alt text can hold backslash escapes (`\]`), and a destination holding
// spaces or parentheses sits in angle brackets, both with its own escapes.
const MD_IMAGE =
  /!\[(?<alt>(?:\\.|[^\\\]])*)\]\((?:<(?<pointy>(?:\\.|[^\\<>\n])*)>|(?<bare>(?:\\.|[^\\\s)])+))\)/gu;
// A backslash escape inside a destination, which Markdown reads as the
// character it escapes.
const DESTINATION_ESCAPE = /\\(?<char>[!-/:-@[-`{-~])/gu;
// A `<video>` tag's `src`, split so the rewrite can swap the URL and keep the
// surrounding attributes untouched. Notion's uploaded videos arrive as signed,
// expiring URLs exactly like its images, so they rot the same way. `[^>]`
// bounds the attribute run to a single tag.
const HTML_VIDEO_SRC =
  /(?<open><video\b[^>]*?\ssrc=")(?<url>[^"]+)(?<close>")/gu;
const REMOTE = /^https?:\/\//u;
const CODE_FENCE_BLOCK =
  /^(?<fence>`{3,}|~{3,})[^\n]*\n[\s\S]*?^\k<fence>[^\n]*(?=\n|$)/gmu;
// NUL delimiters cannot appear in authored markdown, so tokens never collide.
// oxlint-disable-next-line no-control-regex -- the NUL is the collision guard.
const FENCE_TOKEN = /\u0000blume-fence-(?<index>\d+)\u0000/gu;

// The extension an asset is saved under, keyed by the media type the server
// reports. Only images and videos are ever written: the file is served from
// the docs origin by its extension, so an HTML page (a Vimeo/Loom watch page,
// or a hostile "image" URL) saved as `.html` would render as a page on the
// site. A static host serves by extension, so a `.png` holding JPEG bytes is
// mislabeled and a `.png` holding a video is refused by strict players — the
// response is the source of truth, not the reference kind.
const EXT_BY_MIME = new Map([
  ["image/apng", ".apng"],
  ["image/avif", ".avif"],
  ["image/bmp", ".bmp"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/svg+xml", ".svg"],
  ["image/tiff", ".tiff"],
  ["image/vnd.microsoft.icon", ".ico"],
  ["image/webp", ".webp"],
  ["image/x-icon", ".ico"],
  ["video/mp4", ".mp4"],
  ["video/ogg", ".ogv"],
  ["video/quicktime", ".mov"],
  ["video/webm", ".webm"],
]);
// The same images and videos as a URL's path names them, for a response
// whose type says nothing about the bytes.
const MEDIA_EXTS = new Set([...EXT_BY_MIME.values(), ".jpeg"]);
// Response types that don't say what the bytes are; object stores answer
// uploads this way, so the URL's extension decides.
const OPAQUE_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);
const PART_SUFFIX = ".part";
// Generous enough for a multi-hundred-megabyte recording on an ordinary
// connection; its job is to fail a stalled download rather than hang the build.
const DEFAULT_TIMEOUT_MS = 120_000;

/** Where to write downloaded assets and how to reference them publicly. */
export interface AssetContext {
  assetsDir: string;
  assetsBaseUrl: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * Gate for concurrent downloads. A source shares one gate across every page
   * it materializes, so a database of video-heavy pages doesn't open every
   * download at once. Defaults to no gate.
   */
  limit?: <T>(task: () => Promise<T>) => Promise<T>;
  /**
   * Downloads in progress, keyed by asset stem. A source shares one table
   * (alongside `limit`) across every page it materializes, so two pages that
   * reference the same asset share one download instead of racing to publish
   * the same file. Defaults to a table private to this call.
   */
  inFlight?: Map<string, Promise<string>>;
  /** Abort a download that hasn't completed within this many milliseconds. */
  timeoutMs?: number;
}

/** The image or video extension in a URL's path, or null when it names none. */
const extFromUrl = (url: string): string | null => {
  const clean = url.split("?")[0] ?? url;
  const ext = extname(clean).toLowerCase();
  return MEDIA_EXTS.has(ext) ? ext : null;
};

/** An image's destination as the URL it names, its escapes decoded. */
const imageUrl = (pointy?: string, bare?: string): string =>
  (pointy ?? bare ?? "").replaceAll(DESTINATION_ESCAPE, "$<char>");

/** The response's media type, lowercased and stripped of parameters. */
const mediaType = (res: Response): string =>
  res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * The completed file for a stem whose extension came from an earlier response
 * rather than the URL, so the asset is not fetched on every poll. Only a lone
 * image or video counts: query-less URLs can collide, picking between two
 * files would be a guess, and a partial download (or any other file an older
 * version saved) is never reused.
 */
const completedFor = async (
  dir: string,
  stem: string
): Promise<string | null> => {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const candidates = names.filter(
    (name) => name.startsWith(stem) && MEDIA_EXTS.has(name.slice(stem.length))
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
};

/**
 * The extension to save a response under: the image or video type it
 * reports, or the URL's image or video extension when the type says nothing.
 * Anything else is refused rather than written where the site would serve it.
 */
const extFor = (type: string, urlExt: string | null): string => {
  const ext = EXT_BY_MIME.get(type) ?? (OPAQUE_TYPES.has(type) ? urlExt : null);
  if (ext) {
    return ext;
  }
  throw new Error(
    OPAQUE_TYPES.has(type)
      ? `responded with ${type || "no content type"} and its URL names no image or video file`
      : `responded with ${type}, not an image or video`
  );
};

/**
 * Download remote media referenced in a Markdown body into the asset dir and
 * rewrite the reference to the local public path. Markdown images and the
 * `src` of a `<video>` tag are both covered. Remote CMS URLs (notably Notion's
 * signed, expiring links) would otherwise rot a static build. Assets are
 * content-addressed by URL hash, so repeated builds are stable and deduped —
 * and a file already on disk is not fetched again, which keeps a dev poll
 * from re-downloading every video on every tick.
 */
export const materializeAssets = async (
  markdown: string,
  ctx: AssetContext
): Promise<{ markdown: string; diagnostics: Diagnostic[] }> => {
  const doFetch = ctx.fetchImpl ?? globalThis.fetch;
  const limit = ctx.limit ?? ((task) => task());
  const inFlight = ctx.inFlight ?? new Map<string, Promise<string>>();
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const diagnostics: Diagnostic[] = [];

  // Mask fenced code blocks so an image URL inside a code sample is neither
  // downloaded nor rewritten — the sample must keep showing what the author
  // wrote.
  const fences: string[] = [];
  const masked = markdown.replace(CODE_FENCE_BLOCK, (block) => {
    fences.push(block);
    return `\u0000blume-fence-${fences.length - 1}\u0000`;
  });

  const referenced = [
    ...[...masked.matchAll(MD_IMAGE)].map((match) =>
      imageUrl(match.groups?.pointy, match.groups?.bare)
    ),
    ...[...masked.matchAll(HTML_VIDEO_SRC)].map(
      (match) => match.groups?.url ?? ""
    ),
  ];
  const urls = new Set(referenced.filter((url) => REMOTE.test(url)));

  /** Fetch one asset into the asset dir and return its file name. */
  const download = async (url: string, stem: string): Promise<string> => {
    const urlExt = extFromUrl(url);
    // The name is usually known up front from the path's extension (every
    // Notion upload has one), so a file from an earlier run is reused as is;
    // otherwise the extension came from the last response, so look for it.
    if (urlExt && (await exists(join(ctx.assetsDir, `${stem}${urlExt}`)))) {
      return `${stem}${urlExt}`;
    }
    const completed = await completedFor(ctx.assetsDir, stem);
    if (completed) {
      return completed;
    }
    const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      throw new Error(`${res.status}`);
    }
    // Writing a watch page or an API response out as `.mp4` gives a player
    // that can't play and a green build, and one saved as `.html` would be
    // served as a page on the docs origin: only images and videos are kept.
    const ext = extFor(mediaType(res), urlExt);
    if (!res.body) {
      throw new Error("empty response body");
    }
    const file = `${stem}${ext}`;
    const target = join(ctx.assetsDir, file);
    await mkdir(ctx.assetsDir, { recursive: true });
    // Stream the body to disk rather than buffering it: a video is hundreds of
    // megabytes where an image was a hundred kilobytes. Write to a temporary
    // name unique to this attempt and rename on completion, so a download that
    // dies midway never leaves a truncated file the next run would trust as
    // complete. Two pages fetching the same asset at once share one download
    // through `inFlight` (below), so no two attempts ever publish one file.
    const part = `${target}.${randomUUID()}${PART_SUFFIX}`;
    try {
      await writeFile(part, res.body);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    await rename(part, target);
    return file;
  };

  /**
   * Publish one asset, joining a download another page already has in
   * flight. The gate sits inside the shared promise, so a page waiting on
   * another page's download holds no slot of its own. A waiter whose
   * publisher failed makes its own attempt, exactly as it would have without
   * sharing — one transient error must not fail every page naming the asset.
   */
  const publish = async (url: string): Promise<string> => {
    // Hash the query-less URL: CMS asset URLs are pre-signed, so the query
    // changes on every fetch of the same file — hashing it would mint a new
    // file each refresh and re-dirty the content digest. Two real assets
    // sharing scheme+host+path and differing only in query are rare enough to
    // accept colliding.
    const stem = hashText(url.split("?")[0] ?? url);
    const pending = inFlight.get(stem);
    if (pending) {
      try {
        return await pending;
      } catch {
        // The failed download has left the table by now: join whichever
        // waiter retried first, or go it alone.
        return await publish(url);
      }
    }
    const own = (async () => {
      try {
        return await limit(() => download(url, stem));
      } finally {
        inFlight.delete(stem);
      }
    })();
    inFlight.set(stem, own);
    return await own;
  };

  const rewrites = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const file = await publish(url);
        rewrites.set(url, `${ctx.assetsBaseUrl}/${file}`);
      } catch (error) {
        // SAFETY: everything thrown in this block is an Error — the manual
        // throws in `download`, and fetch/fs failures.
        diagnostics.push({
          code: "BLUME_ASSET_FETCH_FAILED",
          message: `Failed to download asset ${url}: ${(error as Error).message}`,
          severity: "warning",
        });
      }
    })
  );

  const rewritten = masked
    .replaceAll(
      MD_IMAGE,
      (match: string, alt: string, pointy?: string, bare?: string) => {
        const local = rewrites.get(imageUrl(pointy, bare));
        return local ? `![${alt}](${local})` : match;
      }
    )
    .replaceAll(HTML_VIDEO_SRC, (match, open, url, close) => {
      const local = rewrites.get(url);
      return local ? `${open}${local}${close}` : match;
    })
    .replaceAll(FENCE_TOKEN, (token, index) => fences[Number(index)] ?? token);

  return { diagnostics, markdown: rewritten };
};
