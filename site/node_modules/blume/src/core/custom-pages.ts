import { extname, relative } from "pathe";
import { glob, globSync } from "tinyglobby";

/**
 * Custom `.astro` pages (the `pages/` folder): discovery and the routes they
 * serve. Lives in core so the content graph can see them too — a header tab or
 * brand link that points at a custom page must know the page exists only at
 * its own path, not under every locale prefix.
 */

/** A user `.astro` page and the route pattern Blume injects it at. */
export interface CustomPageRoute {
  /** Route pattern, e.g. `/changelog` or `/examples/[slug]`. */
  pattern: string;
  /** Absolute path to the user's `.astro` page file. */
  entrypoint: string;
}

const PAGE_GLOB = ["**/*.astro"];

/**
 * Astro's routing convention: a file or folder whose name starts with `_` is a
 * private partial — importable (shared layouts, home-page sections), but never
 * built into a route. Blume injects pages itself, so it must reproduce the same
 * exclusion or every `pages/_home/Hero.astro`-style component ships as an HTML
 * page.
 */
const isPrivatePage = (rel: string): boolean =>
  rel.split("/").some((segment) => segment.startsWith("_"));

/** Map discovered page files to routes; shared by the async/sync discoverers. */
const toPageRoutes = (
  pagesRoot: string,
  files: string[]
): CustomPageRoute[] => {
  files.sort();
  const routes: CustomPageRoute[] = [];
  for (const file of files) {
    const rel = relative(pagesRoot, file);
    if (isPrivatePage(rel)) {
      continue;
    }
    const withoutExt = rel.slice(0, rel.length - extname(rel).length);
    const parts = withoutExt.split("/");
    // Only a trailing `index` maps to its parent dir; a folder literally named
    // `index` (e.g. `index/foo.astro`) must keep its segment.
    if (parts.at(-1) === "index") {
      parts.pop();
    }
    const pattern = parts.length === 0 ? "/" : `/${parts.join("/")}`;
    routes.push({ entrypoint: file, pattern });
  }
  return routes;
};

/**
 * Discover user `.astro` pages and map them to route patterns. Files keep their
 * original location; only the route pattern is derived (index -> parent,
 * dynamic `[param]` segments preserved).
 */
export const discoverPages = async (
  pagesRoot: string
): Promise<CustomPageRoute[]> =>
  toPageRoutes(
    pagesRoot,
    await glob(PAGE_GLOB, { absolute: true, cwd: pagesRoot, onlyFiles: true })
  );

/** {@link discoverPages} for synchronous callers (e.g. the sitemap builder). */
export const discoverPagesSync = (pagesRoot: string): CustomPageRoute[] =>
  toPageRoutes(
    pagesRoot,
    globSync(PAGE_GLOB, { absolute: true, cwd: pagesRoot, onlyFiles: true })
  );

/** Skip private (`_partial`, `.well-known`) and Astro dynamic (`[param]`) parts. */
const PRIVATE_SEGMENT = /^[._]/u;

/** Segments of a static, shareable page pattern; null for dynamic/private ones. */
export const staticSegments = (pattern: string): string[] | null => {
  const segments = pattern.split("/").filter(Boolean);
  return segments.some(
    (part) => PRIVATE_SEGMENT.test(part) || part.includes("[")
  )
    ? null
    : segments;
};

/**
 * The static routes served by custom `.astro` pages — the same filtering as
 * the generated OG cards, but yielding the routes themselves. Feeds the route
 * sets that must know every servable page beyond the content graph (the link
 * checker, the sitemap); dynamic (`[param]`) and private segments are skipped
 * because their concrete URLs can't be enumerated statically.
 */
export const customStaticRoutes = (pages: { pattern: string }[]): string[] => {
  const routes = new Set<string>();
  for (const { pattern } of pages) {
    const segments = staticSegments(pattern);
    if (segments !== null) {
      routes.add(segments.length === 0 ? "/" : `/${segments.join("/")}`);
    }
  }
  return [...routes];
};
