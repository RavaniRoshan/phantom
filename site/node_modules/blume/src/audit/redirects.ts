import {
  bareRedirect,
  isPatternPath,
  patternDestination,
} from "../core/redirect-patterns.ts";
import type { RedirectResolution } from "./types.ts";
import { normalizePath } from "./url.ts";

interface ConfiguredRedirect {
  from: string;
  to: string;
  status: number;
}

/**
 * A destination's page path: the part before any query string or fragment. A
 * redirect to `/guide#setup` or `/search?q=x` lands on the `/guide` / `/search`
 * page — the suffix belongs to the browser, not the file tree, so keeping it
 * would report a working redirect as broken.
 */
const pathOnly = (value: string): string => {
  const cut = value.search(/[?#]/u);
  return cut === -1 ? value : value.slice(0, cut);
};

/**
 * The most hops a walk follows before calling it a loop. A pattern can send a
 * path somewhere it covers again, one segment longer each time (`/a/*` to
 * `/a/b/:splat`), which never revisits a hop yet never resolves either.
 */
const MAX_HOPS = 32;

/** Where a walk from one path ended, and how. */
type Walk = Pick<RedirectResolution, "chain" | "outcome">;

/**
 * Follow every configured redirect through to its destination, classifying what
 * it lands on.
 *
 * - `loop`    — the chain revisits a hop it has already been to, or runs past
 *   {@link MAX_HOPS}. Never resolves.
 * - `broken`  — the chain ends somewhere the build does not serve.
 * - `chain`   — it resolves, but through at least one intermediate redirect.
 * - `ok`      — one hop, straight to a real page.
 * - `pattern` — a pattern (`/beta/:slug*`), which covers paths rather than
 *   naming one, so there is no single chain to walk; {@link redirectAt}
 *   resolves a path it covers.
 *
 * A pattern ending in a rest also matches its bare path (`/beta`, see
 * `bareRedirect`), which every host gets as an exact rule. That one path is
 * walked like an exact redirect: when it loops or breaks, the pattern takes
 * that outcome, its chain starting at the bare path.
 *
 * An external destination (`https://…`) is always `ok`: it's outside the site,
 * so there's no local page to check it against. A hop onto a path a pattern
 * covers continues through that pattern.
 */
export const resolveRedirects = (
  redirects: readonly ConfiguredRedirect[],
  /** Whether the build serves a normalized path — see `isServed`. */
  served: (path: string) => boolean
): RedirectResolution[] => {
  const byFrom = new Map<string, ConfiguredRedirect>();
  for (const redirect of redirects) {
    byFrom.set(normalizePath(redirect.from), redirect);
  }
  const hopFrom = (path: string): string | undefined =>
    byFrom.get(path)?.to ?? patternDestination(redirects, path);

  const walk = (from: string, to: string): Walk => {
    const chain: string[] = [from];
    const seen = new Set<string>([from]);
    let current = to;

    for (;;) {
      // An external hop ends the walk — we can't follow it locally.
      if (/^https?:\/\//iu.test(current)) {
        chain.push(current);
        break;
      }
      const next = normalizePath(pathOnly(current));
      if (seen.has(next) || chain.length > MAX_HOPS) {
        chain.push(next);
        return { chain, outcome: "loop" };
      }
      chain.push(next);
      seen.add(next);
      const hop = hopFrom(next);
      if (hop === undefined) {
        break;
      }
      current = hop;
    }

    const destination = chain.at(-1) ?? from;
    const external = /^https?:\/\//iu.test(destination);
    if (!(external || served(destination))) {
      return { chain, outcome: "broken" };
    }
    // `chain` is [from, …hops, destination]; more than two entries means at
    // least one intermediate redirect.
    return { chain, outcome: chain.length > 2 ? "chain" : "ok" };
  };

  return redirects.map((redirect) => {
    const from = normalizePath(redirect.from);
    if (!isPatternPath(redirect.from)) {
      return { ...redirect, ...walk(from, redirect.to) };
    }
    const bare = bareRedirect(redirect);
    const walked = bare && walk(normalizePath(bare.from), bare.to);
    return walked && (walked.outcome === "loop" || walked.outcome === "broken")
      ? { ...redirect, ...walked }
      : { ...redirect, chain: [from], outcome: "pattern" as const };
  });
};

/**
 * The configured redirect a path takes, for the checks that report a link,
 * canonical, sitemap entry, or `hreflang` pointing through one: the exact
 * redirect from that path, else the pattern covering it, its `to` filled in
 * for this path.
 */
export const redirectAt = (
  redirects: readonly RedirectResolution[],
  path: string
): { to: string } | undefined => {
  const exact = redirects.find((entry) => normalizePath(entry.from) === path);
  if (exact) {
    return exact;
  }
  const to = patternDestination(redirects, path);
  return to === undefined ? undefined : { to };
};
