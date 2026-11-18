/**
 * What a static host does with the URLs `blume dev` and `blume preview`
 * would otherwise answer on their own terms. Astro's `trailingSlash: "never"`
 * has both 404 a slashed URL (`/guide/`), which every host answers: Vercel
 * redirects it to `/guide`, and the others serve `guide/index.html`. And a
 * folder of HTML shipped in `public/` (`public/demo/index.html`) is served at
 * `/demo/`, `/demo` redirecting there, so the relative links inside it
 * resolve against the folder; the dev server 404s both spellings, and Vite's
 * preview serves only the slashless one.
 */

import { statSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { join, resolve } from "pathe";

import { stripBasePath } from "./base-path.ts";
import { trimEnd } from "./trim.ts";

/** How to answer a request ahead of the server's own handlers. */
export type HostAnswer =
  | { kind: "redirect"; location: string; status: number }
  | { kind: "rewrite"; url: string };

/**
 * The paths Astro keeps out of its trailing-slash handling (`/_astro/`,
 * `/@vite/`, `/.well-known/`, `//`), and the root.
 */
const UNHANDLED_PATH = /^\/(?:[_@./]|$)/u;

/** A request URL's path and its query string, `?` included. */
const splitUrl = (url: string): { pathname: string; search: string } => {
  const queryAt = url.search(/[?#]/u);
  return queryAt === -1
    ? { pathname: url, search: "" }
    : { pathname: url.slice(0, queryAt), search: url.slice(queryAt) };
};

/**
 * Whether `public/<path>/index.html` exists: a folder of HTML the site ships
 * as is. `path` is the decoded request path with `deployment.base` stripped.
 */
export const publicFolder = (publicDir: string) => {
  const root = resolve(publicDir);
  return (path: string): boolean => {
    const index = join(root, path, "index.html");
    if (!index.startsWith(`${root}/`)) {
      return false;
    }
    try {
      return statSync(index).isFile();
    } catch {
      return false;
    }
  };
};

/**
 * How a static host answers a URL's trailing slash, or null to leave the
 * request alone. A slashed URL redirects to its slashless page, its query
 * kept, unless it names a public folder, which serves its `index.html`; a
 * slashless public folder redirects to its slashed URL. `base` is the
 * normalized `deployment.base`, which the URL carries and `public/` doesn't.
 * The redirect is a `301`, a `308` for a method a `301` would turn into a
 * `GET`, as Astro answers on a server-rendered route.
 */
export const trailingSlashAnswer = (
  request: Pick<IncomingMessage, "method" | "url">,
  base: string,
  isPublicFolder: (path: string) => boolean
): HostAnswer | null => {
  const { pathname, search } = splitUrl(request.url ?? "/");
  if (UNHANDLED_PATH.test(pathname)) {
    return null;
  }
  let path: string;
  try {
    path = decodeURIComponent(stripBasePath(base, pathname));
  } catch {
    return null;
  }
  const status =
    request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  if (!pathname.endsWith("/")) {
    return isPublicFolder(path)
      ? { kind: "redirect", location: `${pathname}/${search}`, status }
      : null;
  }
  const slashless = trimEnd(pathname, "/");
  return isPublicFolder(trimEnd(path, "/"))
    ? { kind: "rewrite", url: `${slashless}/index.html${search}` }
    : { kind: "redirect", location: `${slashless}${search}`, status };
};

/**
 * Answer every request on `server` with `answer` first: a redirect is sent
 * then and there, and a rewrite changes the URL the server's own handlers
 * (Vite's middleware) then see. They're the request listeners the server
 * already has, so this goes ahead of every middleware, Astro's included.
 */
export const answerRequestsFirst = (
  server: Server,
  answer: (request: IncomingMessage) => HostAnswer | null,
  headers: Record<string, string> = {}
): void => {
  const handlers = server.listeners("request");
  server.removeAllListeners("request");
  server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    const answered = answer(request);
    if (answered?.kind === "redirect") {
      response.writeHead(answered.status, {
        ...headers,
        Location: answered.location,
      });
      response.end();
      return;
    }
    if (answered) {
      request.url = answered.url;
    }
    for (const handler of handlers) {
      handler.call(server, request, response);
    }
  });
};
