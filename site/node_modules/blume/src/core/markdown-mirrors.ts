import { servesRoute } from "./locale-links.ts";
import type { RouteSet } from "./locale-links.ts";

/**
 * Where Blume serves each page's raw Markdown: a copy beside the page, named
 * for its route (`/guide.md`, `/guide.mdx`; see `rawMarkdownEndpointTemplate`).
 */

/** The extensions every page's Markdown copies are served at. */
export const MIRROR_EXTENSIONS = [".md", ".mdx"] as const;

/**
 * The name the root's copies are served under (`/index.md`). They always are:
 * with no page at `/`, the llms.txt index stands in (see `buildRawMarkdown`).
 */
const ROOT_MIRROR = "/index";

/** A path naming a Markdown copy: the name it's served under, then `.md(x)`. */
const MIRROR_PATH = /^(?<name>\/.+)\.mdx?$/u;

/** The name a page's Markdown copies are served under, from its route. */
export const mirrorName = (route: string): string =>
  route === "/" ? ROOT_MIRROR : route;

/**
 * The page whose Markdown copies are served under `name`, if any are: the
 * root's under `/index`, and a page's under its own route. `/index` is no
 * page's route, yet it names the root's copies, so a path that isn't a page
 * can still name a served copy.
 */
export const mirrorOwner = (
  pages: RouteSet,
  name: string
): string | undefined => {
  if (name === ROOT_MIRROR) {
    return "/";
  }
  return servesRoute(pages, name) ? name : undefined;
};

/**
 * The page a served Markdown copy at `path` belongs to (`/guide.md` the page
 * `/guide`'s, `/index.mdx` the root's), or `undefined` when `path` is no
 * served copy.
 */
export const mirroredPage = (
  pages: RouteSet,
  path: string
): string | undefined => {
  const name = MIRROR_PATH.exec(path)?.groups?.name;
  return name === undefined ? undefined : mirrorOwner(pages, name);
};
