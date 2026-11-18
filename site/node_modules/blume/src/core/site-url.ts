import { joinURL } from "ufo";

import { trimEnd } from "./trim.ts";

/**
 * Absolute-URL building for the configured `deployment.site`, shared by every
 * emitter that prints site URLs (sitemap, RSS, robots, llms.txt, the MCP and
 * agent-discovery documents). One implementation replaces eight per-file
 * copies that had drifted across three different trailing-slash treatments.
 *
 * Deliberately not `new URL(path, site)`: a root-absolute path would drop the
 * base path of a subpath deployment (`acme.com/docs`). ufo's `joinURL` joins
 * without that footgun; the site is first trimmed with the ReDoS-safe
 * `trimEnd` loop so even a malformed `site` with piled-up trailing slashes
 * joins cleanly.
 */

/** The configured site with any trailing slashes dropped. */
export const siteRoot = (site: string): string => trimEnd(site, "/");

/** `site` + root-absolute `path` (already carrying any deployment base). */
export const absoluteUrl = (site: string, path: string): string => {
  const root = siteRoot(site);
  // joinURL folds a lone "/" away entirely; the homepage keeps its slash
  // (`https://example.com/`), matching what every emitter always printed.
  return path === "/" ? `${root}/` : joinURL(root, path);
};
