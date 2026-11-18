/**
 * Trailing heading markers, matching Fumadocs' syntax so migrated content works
 * verbatim: `## Heading [#custom-id]` pins the anchor id, `## Heading [!toc]`
 * keeps the heading on the page but out of the table of contents, and
 * `## Heading [toc]` shows it only in the table of contents. Markers chain in
 * any order (`## Heading [toc] [#id]`). The `{#id}` pin of Pandoc, kramdown,
 * and Markdown-based specification toolchains is accepted as an equivalent of
 * `[#id]` — in `.md` verbatim, in `.mdx` only as the escape `\{#id\}` (a bare
 * `{…}` there is a JSX expression; the scan-time scanner reports one as
 * `BLUME_MDX_CURLY_ANCHOR`). Both pipelines resolve escapes before parsing
 * markers, so the escaped and bare spellings reach this parser identically.
 *
 * Both heading pipelines share this parser — the render-time hast plugin
 * (`markdown/heading-anchors.ts`) and the scan-time source scanner
 * (`core/sources/normalize.ts`) — so the rendered `id`, the TOC entry, and the
 * anchor index `blume validate` checks against always agree. Both also escape
 * a pinned id's punctuation before they parse (`core/pinned-ids.ts`), so
 * smart punctuation never rewrites the id an author pinned.
 */

import { slug } from "github-slugger";
import type GithubSlugger from "github-slugger";

/**
 * Frontmatter key carrying the slugs of `[!toc]` headings out of a render. The
 * hast plugin pushes onto it and the generated page template reads it back via
 * `remarkPluginFrontmatter` to filter the TOC.
 */
export const TOC_HIDDEN_KEY = "__blumeTocHidden";

/**
 * Frontmatter key carrying TOC text out of a render, keyed by slug, for the
 * headings whose TOC entry must read differently from the heading's text
 * content: a heading holding a `<Badge>` lists without the badge's text. The
 * page template reads it back the way it reads {@link TOC_HIDDEN_KEY}.
 */
export const TOC_TEXT_KEY = "__blumeTocText";

const TRAILING_DASHES = /-+$/u;

/**
 * A heading's auto-generated anchor id, registered with the document slugger.
 * The text is trimmed first: a heading that opens or ends with something that
 * has no text (an inline component, an image, raw HTML) would otherwise slug
 * that edge whitespace into a leading or trailing dash. A slug can still end
 * in dashes when the slugger drops a symbol after a space (`Features ✨`);
 * those go too, so no id ends in a dash.
 */
export const headingSlug = (slugger: GithubSlugger, text: string): string => {
  const trimmed = text.trim();
  const base = slug(trimmed);
  // A slug is stable under re-slugging, so the stripped one registers as is.
  return slugger.slug(
    base.endsWith("-") ? base.replace(TRAILING_DASHES, "") : trimmed
  );
};

/**
 * A heading's text with its badges taken out. `pieces` is the heading's text
 * in order, with `null` where a badge stood; a badge between two words
 * leaves one space, not the two around it (`Install <Badge>beta</Badge> now`
 * reads `Install now`).
 */
export const joinHeadingText = (pieces: readonly (string | null)[]): string => {
  let text = "";
  let gap = false;
  for (const piece of pieces) {
    if (piece === null) {
      gap = true;
      continue;
    }
    text += gap && /\s$/u.test(text) ? piece.replace(/^[\t ]+/u, "") : piece;
    gap = false;
  }
  return text;
};

/** One raw HTML tag, as an inline `.md` (or scanned) heading holds it. */
interface RawTag {
  /** The attribute source after the name, a self-closing `/` included. */
  attributes: string;
  closing: boolean;
  name: string;
}

const RAW_TAG =
  /^<(?<closing>\/)?(?<name>[A-Za-z][\w.-]*)(?<attributes>[^>]*)>$/u;

/** A raw inline HTML node's tag, or null when it holds something else. */
const rawTag = (value: string): RawTag | null => {
  const groups = RAW_TAG.exec(value.trim())?.groups;
  return groups?.name === undefined
    ? null
    : {
        attributes: groups.attributes ?? "",
        closing: groups.closing !== undefined,
        name: groups.name,
      };
};

const isSelfClosing = (tag: RawTag): boolean =>
  tag.attributes.trimEnd().endsWith("/");

/**
 * How a raw HTML node in a heading reads for its anchor: a `<Badge>` tag that
 * opens or closes a run of badge text (a self-closing one is a badge with no
 * text), the opening tag of an `<a>` (`target` its `id`, else its `name`),
 * the `</a>` that closes one, or none of these.
 */
export type RawHeadingTag =
  | { kind: "anchor-close" }
  | { kind: "anchor-open"; selfClosing: boolean; target?: string }
  | { kind: "badge"; selfClosing: boolean; closing: boolean }
  | { kind: "other" };

const ANCHOR_TARGET =
  /(?:^|\s)(?<key>id|name)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'=<>`/]+))/giu;

/** An anchor's own fragment target: its `id`, else its `name`. */
const anchorTarget = (attributes: string): string | undefined => {
  const values = new Map<string, string>();
  for (const match of attributes.matchAll(ANCHOR_TARGET)) {
    const groups = match.groups ?? {};
    const value = groups.double ?? groups.single ?? groups.bare;
    const key = groups.key?.toLowerCase();
    if (key && value && !values.has(key)) {
      values.set(key, value);
    }
  }
  return values.get("id") ?? values.get("name");
};

/** Classify a raw HTML node in a heading — see {@link RawHeadingTag}. */
export const rawHeadingTag = (value: string): RawHeadingTag => {
  const tag = rawTag(value);
  if (tag?.name === "Badge") {
    return {
      closing: tag.closing,
      kind: "badge",
      selfClosing: isSelfClosing(tag),
    };
  }
  if (tag?.name.toLowerCase() !== "a") {
    return { kind: "other" };
  }
  return tag.closing
    ? { kind: "anchor-close" }
    : {
        kind: "anchor-open",
        selfClosing: isSelfClosing(tag),
        target: anchorTarget(tag.attributes),
      };
};

/**
 * A JSX attribute: a name with a string value or an `{expression}` one, or a
 * `{...spread}` (no name).
 */
export interface JsxAttribute {
  name?: string;
  type: string;
  value?: string | { type: string; value?: string } | null;
}

const isStringValue = (value: JsxAttribute["value"]): value is string =>
  typeof value === "string";

/** A JSX `<a>`'s own fragment target: its string `id`, else its `name`. */
export const jsxAnchorTarget = (
  attributes: readonly JsxAttribute[]
): string | undefined => {
  const value = (key: string): string | undefined => {
    const found = attributes.find((attribute) => attribute.name === key)?.value;
    return isStringValue(found) && found !== "" ? found : undefined;
  };
  return value("id") ?? value("name");
};

/**
 * Register a pinned `[#id]` with the document slugger, the way
 * `GithubSlugger#slug` registers the slugs it returns — so a later heading
 * whose auto-slug collides disambiguates (`setup` → `setup-1`) instead of
 * silently duplicating the anchor id. An id that is already taken is left
 * untouched (the pin still uses it verbatim; duplicate pins are the author's
 * explicit choice).
 */
export const occupySlug = (slugger: GithubSlugger, id: string): void => {
  slugger.occurrences[id] ??= 0;
};

/** One trailing marker: `[#id]`, `{#id}`, `[toc]`, or `[!toc]`. */
const MARKER =
  /\s*(?:\{#(?<curlyId>[^\s}]+)\}|\[(?:#(?<id>[^\s\]]+)|(?<hide>!)?toc)\])\s*$/u;

export interface HeadingMarkers {
  /**
   * Author-pinned anchor id from `[#id]` or `{#id}`, used verbatim (never
   * re-slugged, and never smart-punctuated: see `core/pinned-ids.ts`).
   */
  id?: string;
  /** The heading text with every trailing marker stripped. */
  text: string;
  /** `[!toc]` hides the heading from the TOC; `[toc]` shows it only there. */
  toc?: "hide" | "only";
}

/**
 * Split trailing markers off a heading's text. Only markers at the very end of
 * the heading count (mid-text brackets are ordinary prose); when a marker kind
 * repeats, the last one written wins.
 *
 * Callers pass the heading's trailing text node after a Markdown parse, so a
 * bracket that a link-reference definition turns into a CommonMark shortcut
 * link (`[toc]` with a `[toc]: …` definition) is already an element there and
 * never reaches this parse.
 */
export const parseHeadingMarkers = (text: string): HeadingMarkers => {
  let remaining = text;
  let id: string | undefined;
  let toc: HeadingMarkers["toc"];
  for (
    let match = MARKER.exec(remaining);
    match?.groups;
    match = MARKER.exec(remaining)
  ) {
    const explicitId = match.groups.curlyId ?? match.groups.id;
    remaining = remaining.slice(0, match.index);
    if (explicitId === undefined) {
      // Stripping runs right-to-left, so keeping the first capture of each
      // kind makes the rightmost occurrence win.
      toc ??= match.groups.hide === undefined ? "only" : "hide";
    } else {
      id ??= explicitId;
    }
  }
  return { id, text: remaining, toc };
};
