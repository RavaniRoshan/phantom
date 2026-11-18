import { readFileSync, statSync } from "node:fs";
import { Server } from "node:http";
import type { IncomingMessage } from "node:http";

import type { PreviewServer } from "astro";
import { join } from "pathe";

import { stripBasePath } from "../core/base-path.ts";
import {
  compileEveryRedirect,
  matchCompiledRedirect,
  requestPath,
} from "../core/redirect-patterns.ts";
import type { CompiledRedirect } from "../core/redirect-patterns.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import {
  answerRequestsFirst,
  trailingSlashAnswer,
} from "../core/static-host.ts";
import type { HostAnswer } from "../core/static-host.ts";
import type { BlumeManifest } from "../core/types.ts";
import { platformRedirects } from "../deploy/redirects.ts";

/**
 * Astro previews a static build on Vite's preview server, which serves the
 * files in `dist/` and nothing a host would add: the redirect rules the build
 * writes for it (`_redirects`, `vercel.json`), which carry every pattern
 * redirect, and the host's handling of a trailing slash (see
 * `core/static-host.ts`). Its HTML fallback also answers a slashless `/guide`
 * with `guide.html` whenever that path exists. It checks with
 * `fs.existsSync`, which a directory passes too. A redirect from
 * `/guide.html` (a migrated site's URL) has its redirect page written to
 * `dist/guide.html/index.html`, a directory, so the fallback rewrites
 * `/guide` to it, Astro's own preview rewrite appends `/index.html`, and the
 * page at `/guide` becomes a redirect page that refreshes to itself forever.
 * Hosts look up files, so they serve the page at `guide/index.html`.
 */

/** Whether `path` is a directory (true) or a file (false); null when absent. */
const isDirectory = (path: string): boolean | null => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return null;
  }
};

/**
 * The URL to serve a preview request from in place of the one Vite's HTML
 * fallback would pick, or null to leave the request alone: the page's own
 * `index.html` when `dist/<route>.html` is a directory, the redirect page of
 * a redirect from `<route>.html`. `base` is the normalized
 * `deployment.base`, which the URL carries and `dist/` doesn't.
 */
export const previewPageUrl = (
  distDir: string,
  base: string,
  url: string
): string | null => {
  const queryAt = url.search(/[?#]/u);
  const pathname = queryAt === -1 ? url : url.slice(0, queryAt);
  if (pathname.endsWith("/")) {
    return null;
  }
  let route: string;
  try {
    route = decodeURIComponent(stripBasePath(base, pathname));
  } catch {
    return null;
  }
  const page = join(distDir, route);
  if (!page.startsWith(`${distDir}/`)) {
    return null;
  }
  return isDirectory(`${page}.html`) === true &&
    isDirectory(join(page, "index.html")) === false
    ? `${pathname}/index.html${queryAt === -1 ? "" : url.slice(queryAt)}`
    : null;
};

/**
 * The configured redirects as a static build's host files carry them, for
 * the preview to answer as the host would. They're based against the pages
 * of the last generated project (`blume.manifest.json` in the runtime dir),
 * which tell a page from a public file and say which moved pages' Markdown
 * copies move with them.
 */
export const previewRedirects = (
  config: ResolvedConfig,
  runtimeDir: string
): CompiledRedirect[] => {
  if (config.redirects.length === 0) {
    return [];
  }
  let manifest: Pick<BlumeManifest, "routes">;
  try {
    manifest = JSON.parse(
      readFileSync(join(runtimeDir, "blume.manifest.json"), "utf-8")
    );
  } catch {
    manifest = { routes: [] };
  }
  return compileEveryRedirect(platformRedirects({ config, manifest }));
};

/** What a static build's preview answers like a host would. */
export interface PreviewRouting {
  /** The normalized `deployment.base` (`""` at the root). */
  base: string;
  distDir: string;
  /**
   * Whether a path names a folder of HTML in the project's `public/`, served
   * at its slashed URL (see `publicFolder`).
   */
  isPublicFolder: (path: string) => boolean;
  /** Every configured redirect, as the build's host files carry them. */
  redirects: readonly CompiledRedirect[];
}

/**
 * How the preview answers a request ahead of Vite: a configured redirect
 * first, as the host's rules do, then the trailing slash, then the page
 * Vite's fallback would miss ({@link previewPageUrl}).
 */
export const previewAnswer = (
  routing: PreviewRouting,
  request: Pick<IncomingMessage, "method" | "url">
): HostAnswer | null => {
  const url = request.url ?? "/";
  const redirect = matchCompiledRedirect(routing.redirects, requestPath(url));
  if (redirect) {
    return { kind: "redirect", location: redirect[0], status: redirect[1] };
  }
  const slash = trailingSlashAnswer(
    request,
    routing.base,
    routing.isPublicFolder
  );
  if (slash) {
    return slash;
  }
  const page = previewPageUrl(routing.distDir, routing.base, url);
  return page === null ? null : { kind: "rewrite", url: page };
};

/**
 * Answer each request with {@link previewAnswer} before Vite's middleware
 * sees it. Astro's static preview hands back Vite's HTTP server beside the
 * documented fields; without one, the server is left as it is.
 */
export const servePreview = (
  preview: PreviewServer,
  routing: PreviewRouting
): void => {
  if (!("server" in preview && preview.server instanceof Server)) {
    return;
  }
  answerRequestsFirst(preview.server, (request) =>
    previewAnswer(routing, request)
  );
};
