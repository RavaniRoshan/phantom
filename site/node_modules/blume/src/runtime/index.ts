/**
 * Runtime helpers usable inside `.astro` pages and islands.
 *
 * These give custom pages and components access to Blume project data
 * (config, navigation, page collections) without reaching into generated
 * runtime internals. The surface grows with the customization milestone.
 */
import type { BlumeData, BlumeRoute } from "../core/data.ts";

export type {
  BlumeData,
  BlumeDataConfig,
  BlumeFeed,
  BlumeRoute,
} from "../core/data.ts";
export type {
  Heading,
  NavNode,
  Navigation,
  NavTab,
  PageRecord,
} from "../core/types.ts";

/** Query for {@link getBlumeCollection}. */
export interface BlumeCollectionQuery {
  /** Astro collection to read from. Defaults to `"docs"`. */
  collection?: string;
  /** Include drafts, hidden pages, and translation fallbacks. Default `false`. */
  includeHidden?: boolean;
  /** Restrict to a locale code (matches `route.locale`). */
  locale?: string;
  /** Restrict to routes whose path starts with this prefix, e.g. `"/blog"`. */
  prefix?: string;
}

/**
 * Select content routes from the `blume:data` snapshot — for building custom
 * index pages, listings, or feeds without touching generated internals. Pass the
 * imported `data` and an optional query; results are sorted by path.
 *
 * ```astro
 * ---
 * import data from "blume:data";
 * import { getBlumeCollection } from "blume/runtime";
 * const posts = getBlumeCollection(data, { prefix: "/blog" });
 * ---
 * <ul>{posts.map((p) => <li><a href={p.path}>{p.title}</a></li>)}</ul>
 * ```
 */
export const getBlumeCollection = (
  data: BlumeData,
  query: BlumeCollectionQuery = {}
): BlumeRoute[] => {
  const collection = query.collection ?? "docs";
  return data.routes
    .filter((route) => {
      if (route.collection !== collection) {
        return false;
      }
      if (query.locale && route.locale !== query.locale) {
        return false;
      }
      if (query.prefix && !route.path.startsWith(query.prefix)) {
        return false;
      }
      if (
        !query.includeHidden &&
        (route.draft || route.hidden || route.fallback)
      ) {
        return false;
      }
      return true;
    })
    .toSorted((a, b) => a.path.localeCompare(b.path));
};
