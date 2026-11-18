import picomatch from "picomatch";

import { BlumeError } from "../diagnostics.ts";
import matter from "../frontmatter.ts";
import type { Diagnostic } from "../types.ts";
import {
  hashText,
  loadWithCache,
  pollingWatch,
  snapshotCache,
} from "./cache.ts";
import { extractHeadings } from "./normalize.ts";
import { REMOTE_TIMEOUT_MS } from "./remote.ts";
import type {
  ContentSource,
  SourceContext,
  SourceEntry,
  SourceLoadResult,
} from "./types.ts";

/** Options for the built-in remote Markdown/MDX source. */
export interface MdxRemoteSourceOptions {
  name: string;
  prefix?: string;
  /** Raw base URL for `files`, e.g. `https://raw.githubusercontent.com/o/r/main/docs`. */
  url?: string;
  /** Explicit source-relative file paths to fetch from `url`. */
  files?: string[];
  /** Enumerate a GitHub repo subtree via the git-trees API. */
  github?: { owner: string; repo: string; ref: string; path: string };
  include: string[];
  /** Opt-in dev polling interval (seconds); omit to freeze for the session. */
  pollInterval?: number;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

// Include globs compile through picomatch — what the filesystem source's
// tinyglobby uses under the hood — so the same `include` array means the same
// thing on every source type: negation, character classes, nested braces, and
// extglobs included. Compiled once per enumeration, not per ref.

/**
 * Whether a ref is included, read the way tinyglobby reads an `include`
 * array: a `!` pattern excludes what it matches, and the rest include. One
 * picomatch matcher over the whole array would OR a negation in, and
 * `!drafts/**` would include every other path, `.txt` files and all.
 */
const includeMatcher = (include: string[]): ((ref: string) => boolean) => {
  // An empty pattern list matches nothing, so an array of only negations
  // includes nothing, as in tinyglobby.
  const included = picomatch(
    include.filter((pattern) => !pattern.startsWith("!"))
  );
  const excluded = picomatch(
    include
      .filter((pattern) => pattern.startsWith("!"))
      .map((pattern) => pattern.slice(1))
  );
  return (ref) => included(ref) && !excluded(ref);
};

/** A file to fetch: its source-local ref plus where to read it from. */
interface RemoteRef {
  ref: string;
  fetchUrl: string;
  editUrl?: string;
}

// Hosts the GITHUB_TOKEN may be sent to. A configured `url` base can point at
// any server, and leaking the token there would hand a repo credential to an
// arbitrary third party.
const GITHUB_HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);

const isGithubUrl = (url: string): boolean =>
  URL.canParse(url) && GITHUB_HOSTS.has(new URL(url).hostname);

const githubHeaders = (url: string): Record<string, string> => {
  const token = process.env.GITHUB_TOKEN;
  return token && isGithubUrl(url) ? { authorization: `Bearer ${token}` } : {};
};

// What GitHub answers a request for a private repository's file without a
// token (404, so it never confirms the repository exists), a token it rejects
// (401), and a client past the unauthenticated rate limit (403).
const TOKEN_STATUSES = new Set([401, 403, 404]);

/**
 * Why a request failed, naming GITHUB_TOKEN when it's unset and a token could
 * fix the status. A public repository needs no token, so a raw `url` source
 * declares none up front and only says so here, once a request fails.
 */
const statusReason = (url: string, status: number): string =>
  TOKEN_STATUSES.has(status) && !process.env.GITHUB_TOKEN && isGithubUrl(url)
    ? `${url} -> ${status}; GITHUB_TOKEN is not set, which a private repository needs`
    : `${url} -> ${status}`;

/**
 * GET `url`'s body, giving up after {@link REMOTE_TIMEOUT_MS}: a server that
 * accepts the connection and never finishes answering would otherwise hold the
 * scan, and so the build or every dev rescan, indefinitely. A timeout rejects
 * with an error naming the URL and the limit, so the skip or offline
 * diagnostic says what stalled instead of only that an operation was aborted.
 */
const fetchText = async (
  url: string,
  doFetch: typeof fetch
): Promise<string> => {
  try {
    // The signal bounds the body read too, not only the response headers.
    const res = await doFetch(url, {
      headers: githubHeaders(url),
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(statusReason(url, res.status));
    }
    return await res.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        `${url} did not respond within ${REMOTE_TIMEOUT_MS / 1000}s`,
        { cause: error }
      );
    }
    throw error;
  }
};

interface GithubTreeEntry {
  path: string;
  type: string;
}

/** The files a source reads, and what the listing said about them. */
interface Enumeration {
  /**
   * The configured `path`, described, when the repository at the ref has no
   * folder there, so the source read nothing.
   */
  missing?: string;
  refs: RemoteRef[];
  truncated: boolean;
}

/** Enumerate a GitHub repo subtree, mapping blobs to remote refs. */
const enumerateGithub = async (
  github: { owner: string; repo: string; ref: string; path: string },
  include: string[],
  doFetch: typeof fetch
): Promise<Enumeration> => {
  const { owner, repo, ref } = github;
  const base = github.path.replaceAll(/^\/|\/$/gu, "");
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`;
  const text = await fetchText(treeUrl, doFetch);
  // SAFETY: GitHub's git/trees endpoint returns this envelope; a missing or
  // differently-typed field falls through the `?? []` and blob filters below.
  const body = JSON.parse(text) as {
    tree?: GithubTreeEntry[];
    truncated?: boolean;
  };
  const prefix = base ? `${base}/` : "";
  const included = includeMatcher(include);
  const refs = (body.tree ?? []).flatMap((node) => {
    if (!(node.type === "blob" && node.path.startsWith(prefix))) {
      return [];
    }
    const rel = node.path.slice(prefix.length);
    if (!included(rel)) {
      return [];
    }
    return [
      {
        editUrl: `https://github.com/${owner}/${repo}/edit/${ref}/${prefix}${rel}`,
        fetchUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${prefix}${rel}`,
        ref: rel,
      },
    ];
  });
  // GitHub caps the recursive tree response (~100k entries / 7MB) and flags it
  // with `truncated`; ignoring it would silently import only part of the repo.
  const truncated = body.truncated === true;
  // Git has no empty folders, so a complete listing with nothing under
  // `path` means the path is wrong at this ref (a moved docs folder, a typo).
  const found =
    prefix === "" ||
    truncated ||
    (body.tree ?? []).some((node) => node.path.startsWith(prefix));
  return {
    missing: found ? undefined : `"${base}" in ${owner}/${repo} at ${ref}`,
    refs,
    truncated,
  };
};

// A line an ATX heading opens (`# Title`); any other first line can only open
// a setext heading, underlined on the line after it.
const ATX_HEADING = /^ {0,3}#/u;

/** A remote page's body and front matter, as the source hands them on. */
interface RemotePage {
  body: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- pre-validation front matter, as `SourceEntry.data` holds it
  data: Record<string, unknown>;
}

/**
 * Drop a remote page's leading h1 when it is the page's title. A file written
 * to read on GitHub opens with `# Title`, and Blume renders the page's title
 * as its h1, so the heading would show twice. A local page loses the
 * duplicate when its author deletes the heading (the fix the multiple-h1
 * audit names); a remote file can't be edited from the site that reads it.
 * The heading's text becomes `title` when the front matter sets none, the
 * title Blume derives from it anyway, and an h1 that differs from a front
 * matter title stays. The heading's lines are blanked rather than removed, so
 * every other line keeps the number it has in the remote file.
 */
const withoutTitleHeading = (page: RemotePage): RemotePage => {
  const lines = page.body.split("\n");
  const start = lines.findIndex((line) => line.trim() !== "");
  const span = ATX_HEADING.test(lines[start] ?? "") ? 1 : 2;
  const [heading] =
    start === -1
      ? []
      : extractHeadings(lines.slice(start, start + span).join("\n"));
  if (
    heading?.depth !== 1 ||
    heading.text === "" ||
    (page.data.title !== undefined && page.data.title !== heading.text)
  ) {
    return page;
  }
  lines.fill("", start, start + span);
  return {
    body: lines.join("\n"),
    data: { ...page.data, title: heading.text },
  };
};

/**
 * Remote Markdown/MDX content source. Fetches raw `.md`/`.mdx` over HTTP and
 * passes the text straight through `normalizeEntry`. A snapshot under
 * `.blume/cache/<source>/` makes rebuilds offline-tolerant.
 */
export const mdxRemoteSource = (
  options: MdxRemoteSourceOptions,
  ctx: SourceContext
): ContentSource => {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const cache = snapshotCache(ctx.cacheDir);
  let snapshot = new Map<string, SourceEntry>();

  // Validated up front in `load`, *before* the cached-fetch path: thrown from
  // inside `loadWithCache`'s fetch callback, a misconfiguration would be masked
  // as BLUME_SOURCE_FETCH_FAILED (no cache) or downgraded to a stale-cache
  // BLUME_SOURCE_OFFLINE warning (cache present).
  const assertConfigured = (): void => {
    if (options.github || (options.files && options.url)) {
      return;
    }
    throw new BlumeError({
      code: "BLUME_SOURCE_MISCONFIGURED",
      message: `Source "${options.name}" needs either { github } or { url, files }.`,
      severity: "error",
    });
  };

  const enumerate = async (): Promise<Enumeration> => {
    if (options.github) {
      return await enumerateGithub(options.github, options.include, doFetch);
    }
    const base = (options.url ?? "").replace(/\/$/u, "");
    const included = includeMatcher(options.include);
    const refs = (options.files ?? []).flatMap((ref) =>
      included(ref)
        ? [{ editUrl: `${base}/${ref}`, fetchUrl: `${base}/${ref}`, ref }]
        : []
    );
    return { refs, truncated: false };
  };

  const fetchEntry = async (item: RemoteRef): Promise<SourceEntry> => {
    const text = await fetchText(item.fetchUrl, doFetch);
    const parsed = matter(text);
    const format = item.ref.toLowerCase().endsWith(".mdx") ? "mdx" : "md";
    const page = withoutTitleHeading({
      body: parsed.content,
      data: parsed.data,
    });
    return {
      body: { format, text: page.body },
      data: page.data,
      editUrl: item.editUrl,
      hash: hashText(text),
      // The body is the text's tail, after the front matter, which stays as
      // written: a title taken from the dropped heading lives in `data`, as a
      // title derived from a local page's heading does.
      raw: text.slice(0, text.length - parsed.content.length) + page.body,
      ref: item.ref,
    };
  };

  const load = async (
    refresh = ctx.refresh ?? true
  ): Promise<SourceLoadResult> => {
    assertConfigured();
    const skipped: Diagnostic[] = [];
    const result = await loadWithCache(
      options.name,
      cache,
      async () => {
        const { missing, refs, truncated } = await enumerate();
        if (missing) {
          skipped.push({
            code: "BLUME_SOURCE_PATH_MISSING",
            message: `Source "${options.name}" read no files: there is no folder ${missing}.`,
            severity: "warning",
            suggestion:
              "Check github.path and github.ref against the repository.",
          });
        }
        if (truncated) {
          // The listing covers the whole repository at the ref, whatever
          // `path` is, so narrowing it doesn't help.
          skipped.push({
            code: "BLUME_SOURCE_TRUNCATED",
            message: `Source "${options.name}" hit GitHub's tree listing limit for the whole repository; some files were not enumerated.`,
            severity: "warning",
            suggestion:
              "List the files to read with { url, files } instead, or split the repository.",
          });
        }
        const reasons: string[] = [];
        const settled = await Promise.all(
          refs.map(async (ref) => {
            try {
              return await fetchEntry(ref);
            } catch (error) {
              // SAFETY: fetch and decode failures throw Error instances;
              // only the message is read for the skip diagnostic.
              const reason = (error as Error).message;
              reasons.push(reason);
              skipped.push({
                code: "BLUME_SOURCE_FETCH_FAILED",
                message: `Source "${options.name}" skipped "${ref.ref}" (${reason}); the rest were imported.`,
                severity: "warning",
              });
              return null;
            }
          })
        );
        const entries = settled.filter(
          (entry): entry is SourceEntry => entry !== null
        );
        // Only a total wipeout is a hard failure — let loadWithCache fall back
        // to cache or fail loudly rather than silently importing nothing. A
        // partial failure keeps the healthy pages and warns about the rest.
        // The first failure's reason rides along, so a server that timed out
        // on every file says so.
        if (refs.length > 0 && entries.length === 0) {
          skipped.length = 0;
          throw new Error(
            `all ${refs.length} remote file(s) failed to fetch (${reasons[0]})`
          );
        }
        return entries;
      },
      refresh
    );
    snapshot = new Map(result.entries.map((entry) => [entry.ref, entry]));
    return {
      ...result,
      diagnostics: [...result.diagnostics, ...skipped],
    };
  };

  const read = async (ref: string): Promise<string> => {
    const cached = snapshot.get(ref);
    if (cached) {
      return cached.raw ?? cached.body.text;
    }
    const all = await cache.read();
    const entry = all.find((e) => e.ref === ref);
    return entry?.raw ?? entry?.body.text ?? "";
  };

  return {
    load,
    name: options.name,
    // Refs are the remote tree's file and folder names, so an ordering prefix
    // (`01-getting-started/02-install.mdx`) sorts the sidebar and drops from
    // the route, the way it does in a local content folder.
    orderedNames: true,
    prefix: options.prefix,
    read,
    staged: true,
    watch: options.pollInterval
      ? pollingWatch(
          () => load(true),
          options.pollInterval,
          () => load()
        )
      : undefined,
    withContext: (next) => mdxRemoteSource(options, next),
  };
};
