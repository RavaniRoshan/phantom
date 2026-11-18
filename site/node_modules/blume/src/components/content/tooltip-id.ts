import { createHash } from "node:crypto";

/**
 * Per-render bookkeeping for stable element ids, kept on the request's
 * `Astro.locals` so every component in one page render — layout and MDX
 * content alike — shares it, and concurrent page renders never see each
 * other's.
 */
export interface StableIdLocals {
  /** Prefix + content digest → how many elements on this page carried it. */
  blumeStableIds?: Map<string, number>;
}

/**
 * An element id derived from what the element renders, not drawn at random,
 * so rebuilding an unchanged page produces the same HTML. A second identical
 * element on the same page gets a numbered suffix to keep ids unique;
 * identical elements render identical markup, so which copy is numbered never
 * changes the page's bytes.
 */
export const stableId = (
  locals: StableIdLocals,
  prefix: string,
  content: readonly (string | undefined)[]
): string => {
  const digest = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex")
    .slice(0, 12);
  const base = `${prefix}-${digest}`;
  locals.blumeStableIds ??= new Map();
  const count = (locals.blumeStableIds.get(base) ?? 0) + 1;
  locals.blumeStableIds.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
};

/** The element id a tooltip's panel and trigger pair on. */
export const tooltipId = (
  locals: StableIdLocals,
  content: readonly (string | undefined)[]
): string => stableId(locals, "blume-tooltip", content);
