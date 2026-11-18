/**
 * Heading ids, trailing markers, and self-linking anchors. A Satteri hast
 * plugin runs after Markdown is turned into hast and, for every heading:
 *
 * - parses trailing markers (`[#custom-id]`, `{#custom-id}`, `[!toc]`, `[toc]`
 *   — see `core/heading-markers.ts`) and strips them from the rendered text;

 * - takes out an empty `<a>` the heading holds as its own anchor (GitBook's
 *   `<a href="#x" id="x"></a>`, a wiki's `<a name="x"></a>`), whose `id` or
 *   `name` then pins the heading's id — see {@link readContent};
 * - assigns the anchor `id` (the `[#custom-id]` pin, else that anchor's id,
 *   else a `github-slugger` slug of the marker-free text, `<Badge>` text left
 *   out — see `headingSlug`);
 * - wraps `<h2>`–`<h6>` content in an `<a href="#slug">` so a reader can click
 *   the heading to copy, bookmark, or share a link straight to that section
 *   (`<h1>` — the page title — is slugged for parity but left unwrapped, and
 *   `wrap: false` turns the anchor links off without losing the markers).
 *
 * Satteri's own `heading-ids` plugin (which assigns the `id` used by the table
 * of contents) runs *after* every user hast plugin, and it reuses an `id` that
 * is already present rather than re-slugging. So this plugin is the
 * authoritative id setter: it slugs each heading with the same algorithm (a
 * per-document `github-slugger`, the library Satteri and rehype-slug both use)
 * and writes the `id`, which `heading-ids` then adopts — keeping the in-page
 * anchor, the heading's `id`, and the TOC entry in lockstep. To match
 * Satteri's duplicate disambiguation (`setup`, `setup-1`, …) exactly, it
 * advances the slugger over `<h1>`–`<h6>` in document order even though only
 * `<h2>`–`<h6>` get wrapped.
 *
 * TOC visibility flows out through the render's frontmatter: the slugs of
 * `[!toc]` headings are pushed onto `frontmatter[TOC_HIDDEN_KEY]`, which Astro
 * surfaces as `remarkPluginFrontmatter` so the page template can filter them
 * out of the headings list. `[toc]` headings render with the
 * `blume-toc-only` class (visually hidden, still a live anchor target) so the
 * TOC entry has somewhere to scroll to. `heading-ids` reads a heading's TOC
 * text from its whole text content, badge included, so a heading holding a
 * `<Badge>` reports its badge-free text under `frontmatter[TOC_TEXT_KEY]`.
 */

import { satteriCollectHastText } from "@astrojs/markdown-satteri";
import GithubSlugger from "github-slugger";

import {
  headingSlug,
  joinHeadingText,
  jsxAnchorTarget,
  occupySlug,
  parseHeadingMarkers,
  rawHeadingTag,
  TOC_HIDDEN_KEY,
  TOC_TEXT_KEY,
} from "../core/heading-markers.ts";
import type { JsxAttribute } from "../core/heading-markers.ts";

/** A hast property value: an attribute primitive or a token list. */
type HastPropertyValue = string | number | boolean | (string | number)[];

/** A minimal hast node (avoids a hast type dependency). */
interface HastNode {
  /** An MDX JSX element's attributes. */
  attributes?: JsxAttribute[];
  children?: HastNode[];
  name?: string;
  properties?: Record<string, HastPropertyValue>;
  tagName?: string;
  type: string;
  value?: string;
}

/** The slice of Satteri's hast visitor context this plugin reads. */
interface HastContext {
  data?: {
    astro?: { frontmatter?: Parameters<typeof satteriCollectHastText>[1] };
  };
  setProperty: (node: HastNode, key: string, value: HastPropertyValue) => void;
  textContent: (node: HastNode) => string;
}

/** A Satteri hast plugin, typed structurally to avoid a Satteri dep. */
export interface HeadingAnchorPlugin {
  name: string;
  element: {
    filter: string[];
    visit: (node: HastNode, ctx: HastContext) => HastNode | undefined;
  };
}

export interface HeadingAnchorOptions {
  /** Wrap `<h2>`–`<h6>` in self-linking anchors (`markdown.headingAnchors`). */
  wrap?: boolean;
}

/** Headings slugged for id parity with Satteri; only a subset gets wrapped. */
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"];
const WRAPPED = new Set(["h2", "h3", "h4", "h5", "h6"]);

/** The class that renders a `[toc]`-only heading as an invisible anchor. */
const TOC_ONLY_CLASS = "blume-toc-only";

/**
 * True for an `<a>`: an element, a JSX element, or (in `.md`, where inline
 * HTML stays raw) a raw opening `<a>` tag.
 */
const isAnchor = (node: HastNode): boolean =>
  (node.tagName ?? node.name) === "a" ||
  (node.type === "raw" &&
    rawHeadingTag(node.value ?? "").kind === "anchor-open");

/** True if the nodes already contain an `<a>`, so wrapping would nest links. */
const containsAnchor = (nodes: readonly HastNode[]): boolean =>
  nodes.some((node) => isAnchor(node) || containsAnchor(node.children ?? []));

// One state record per document render. The plugin instance is shared across
// every page, but slug disambiguation (and the hidden-heading list) must reset
// per document; the render-scoped `astro` data object is a stable, unique key
// for one render (entries are dropped once the render is collected, so this
// never leaks).
interface RenderState {
  /** Slugs of `[!toc]` headings, shared by reference with the frontmatter. */
  hidden: string[];
  slugger: GithubSlugger;
  /**
   * TOC text by slug for badge-holding headings, shared by reference with the
   * frontmatter once the first one is recorded.
   */
  tocText?: Record<string, string>;
}

const FALLBACK_SCOPE = {};
const states = new WeakMap<object, RenderState>();

const stateFor = (ctx: HastContext): RenderState => {
  const scope = ctx.data?.astro ?? ctx.data ?? FALLBACK_SCOPE;
  const existing = states.get(scope);
  if (existing) {
    return existing;
  }
  const state: RenderState = { hidden: [], slugger: new GithubSlugger() };
  states.set(scope, state);
  // Surface the hidden list on the render's frontmatter (Astro's
  // `remarkPluginFrontmatter`) by reference, so slugs pushed later in the
  // document flow through. Assigning a fresh array on state creation also
  // clears a stale list left by a previous render of the same entry.
  const frontmatter = ctx.data?.astro?.frontmatter;
  if (frontmatter) {
    frontmatter[TOC_HIDDEN_KEY] = state.hidden;
    // The TOC text map is added only by a page with a badge in a heading, so
    // a stale one is dropped rather than replaced.
    Reflect.deleteProperty(frontmatter, TOC_TEXT_KEY);
  }
  return state;
};

/** Record a badge-holding heading's TOC text (see {@link TOC_TEXT_KEY}). */
const recordTocText = (
  state: RenderState,
  ctx: HastContext,
  slug: string,
  text: string
): void => {
  if (!state.tocText) {
    state.tocText = {};
    const frontmatter = ctx.data?.astro?.frontmatter;
    if (frontmatter) {
      frontmatter[TOC_TEXT_KEY] = state.tocText;
    }
  }
  state.tocText[slug] = text;
};

/** Whether a heading already carries a usable string `id`. */
const isStringId = (value: HastPropertyValue | undefined): value is string =>
  typeof value === "string";

/** A parsed heading: marker-free children plus what the markers pinned. */
interface StrippedHeading {
  children: HastNode[];
  id?: string;
  /** Characters the marker strip removed from the heading's text content. */
  strippedLength: number;
  toc?: "hide" | "only";
}

/**
 * Strip trailing markers from a heading's last direct text child. Markers only
 * count at the very end of the heading, so a heading ending in inline code,
 * emphasis, or an expression has no marker position — mirroring the scan-time
 * source scanner, which likewise only matches markers that end the raw line.
 */
const stripMarkers = (node: HastNode): StrippedHeading => {
  const children = node.children ?? [];
  const last = children.at(-1);
  const none = { children, strippedLength: 0 };
  if (last?.type !== "text" || last.value === undefined) {
    return none;
  }
  const markers = parseHeadingMarkers(last.value);
  if (markers.id === undefined && markers.toc === undefined) {
    return none;
  }
  const kept =
    markers.text === ""
      ? children.slice(0, -1)
      : [...children.slice(0, -1), { ...last, value: markers.text }];
  // A heading that is nothing but markers (`## [toc]`) keeps them as literal
  // text: with no heading text left there is nothing to annotate, and
  // stripping would leave an invisible empty element with an empty id and a
  // blank TOC entry. The scan-time scanner and the search extractor mirror
  // this rule.
  if (kept.length === 0) {
    return none;
  }
  return {
    children: kept,
    id: markers.id,
    strippedLength: last.value.length - markers.text.length,
    toc: markers.toc,
  };
};

/** A heading's content read for its anchor, past its trailing markers. */
interface HeadingContent {
  /** The children the heading renders: its own empty anchors taken out. */
  children: HastNode[];
  /** The `id` (else `name`) of an anchor taken out: the heading's id. */
  target?: string;
  /** The heading's text with its badges left out, when it holds one. */
  text?: string;
}

/** An empty JSX `<a>` (an `.mdx` heading's own anchor). */
const isEmptyJsxAnchor = (node: HastNode): boolean =>
  node.type === "mdxJsxTextElement" &&
  node.name === "a" &&
  (node.children ?? []).length === 0;

/** True for a raw `</a>`. */
const isRawAnchorClose = (node: HastNode | undefined): boolean =>
  node?.type === "raw" &&
  rawHeadingTag(node.value ?? "").kind === "anchor-close";

/** A heading child's text content; raw HTML has none. */
const textPiece = (node: HastNode, ctx: HastContext): string => {
  if (node.type === "text") {
    return node.value ?? "";
  }
  return node.type === "raw" ? "" : ctx.textContent(node);
};

/** An empty anchor in a heading: how many nodes it spans, and its target. */
interface OwnAnchor {
  span: number;
  target?: string;
}

/**
 * The empty `<a>` that starts at `children[index]`, if one does: a JSX
 * element with no children, a self-closing raw tag, or a raw tag closed by
 * the next node.
 */
const ownAnchorAt = (
  children: readonly HastNode[],
  index: number
): OwnAnchor | undefined => {
  const child = children[index];
  if (child && isEmptyJsxAnchor(child)) {
    return { span: 1, target: jsxAnchorTarget(child.attributes ?? []) };
  }
  const tag =
    child?.type === "raw" ? rawHeadingTag(child.value ?? "") : undefined;
  if (tag?.kind !== "anchor-open") {
    return undefined;
  }
  if (tag.selfClosing) {
    return { span: 1, target: tag.target };
  }
  return isRawAnchorClose(children[index + 1])
    ? { span: 2, target: tag.target }
    : undefined;
};

/**
 * How a heading child moves through a badge: undefined for no badge, else
 * the change it makes to the depth of raw `<Badge>` tags its text sits in
 * (a JSX badge holds its text, so it changes nothing).
 */
const badgeStep = (child: HastNode): number | undefined => {
  if (child.type === "mdxJsxTextElement" && child.name === "Badge") {
    return 0;
  }
  const tag =
    child.type === "raw" ? rawHeadingTag(child.value ?? "") : undefined;
  if (tag?.kind !== "badge") {
    return undefined;
  }
  if (tag.selfClosing) {
    return 0;
  }
  return tag.closing ? -1 : 1;
};

/**
 * Read a heading's children for its anchor:
 *
 * - An empty `<a>` is the heading's own anchor — an export's
 *   `<a href="#x" id="x"></a>`, a wiki's `<a name="x"></a>` — kept beside
 *   the heading's text so links to `#x` land there. Left in, it would nest
 *   inside the self-link (invalid HTML), or stop the self-link from
 *   rendering. It comes out, and its `id` (else `name`) becomes the
 *   heading's id, so `#x` keeps working. A heading with no other content
 *   keeps it.
 * - A `<Badge>` is a label beside the heading, not part of its name: its text
 *   stays out of the heading's id and TOC entry. In `.mdx` it is a JSX
 *   element; in `.md`, raw tags around its text.
 */
const readContent = (
  children: readonly HastNode[],
  ctx: HastContext
): HeadingContent => {
  const kept: HastNode[] = [];
  const pieces: (string | null)[] = [];
  let target: string | undefined;
  let badges = false;
  let badgeDepth = 0;
  // Nodes still to skip: the `</a>` of a raw anchor taken out.
  let skip = 0;
  for (const [index, child] of children.entries()) {
    const anchor = skip > 0 ? undefined : ownAnchorAt(children, index);
    if (skip > 0 || anchor) {
      target ??= anchor?.target;
      skip = anchor ? anchor.span - 1 : skip - 1;
      continue;
    }
    kept.push(child);
    const step = badgeStep(child);
    if (step === undefined) {
      if (badgeDepth === 0) {
        pieces.push(textPiece(child, ctx));
      }
    } else {
      badges = true;
      pieces.push(null);
      badgeDepth = Math.max(0, badgeDepth + step);
    }
  }
  if (kept.length === 0) {
    return { children: [...children] };
  }
  return {
    children: kept,
    target,
    text: badges ? joinHeadingText(pieces) : undefined,
  };
};

/** The heading's marker-free text content, as `heading-ids` reads it. */
const headingText = (
  node: HastNode,
  ctx: HastContext,
  stripped: StrippedHeading
): string => {
  // The marker suffix is a trailing slice of the text content, so the
  // marker-free text is the content minus exactly what the strip removed.
  const fullText = ctx.textContent(node);
  const rawText = stripped.strippedLength
    ? fullText.slice(0, fullText.length - stripped.strippedLength)
    : fullText;
  // `frontmatter`-interpolated MDX headings (`## {frontmatter.title}`) need the
  // resolved value; the helper is the same one `heading-ids` defers to.
  // SAFETY: HastNode is a structural subset of the hast element shape the
  // helper walks (children/type/value), so the node always fits.
  return rawText.includes("frontmatter")
    ? satteriCollectHastText(
        {
          ...node,
          children: stripped.children,
        } as Parameters<typeof satteriCollectHastText>[0],
        ctx.data?.astro?.frontmatter ?? {}
      )
    : rawText;
};

/** The slug for a heading, mirroring Satteri's `heading-ids` exactly. */
const slugFor = (
  node: HastNode,
  ctx: HastContext,
  slugger: GithubSlugger,
  stripped: StrippedHeading,
  content: HeadingContent
): string => {
  const pinned = stripped.id ?? content.target;
  if (pinned !== undefined) {
    // Pinning occupies the id, so a later heading whose auto-slug collides
    // disambiguates (`setup` → `setup-1`) instead of duplicating the anchor.
    occupySlug(slugger, pinned);
    return pinned;
  }
  const existingId = node.properties?.id;
  if (isStringId(existingId)) {
    return existingId;
  }
  return headingSlug(slugger, content.text ?? headingText(node, ctx, stripped));
};

/** The heading's class list with `blume-toc-only` appended. */
const withTocOnlyClass = (
  value: HastPropertyValue | undefined
): (string | number)[] => {
  if (Array.isArray(value)) {
    return [...value, TOC_ONLY_CLASS];
  }
  return isStringId(value) && value !== ""
    ? [value, TOC_ONLY_CLASS]
    : [TOC_ONLY_CLASS];
};

/** True if the heading already carries the `[toc]`-only class (a re-visit). */
const hasTocOnlyClass = (node: HastNode): boolean => {
  const value = node.properties?.className;
  return Array.isArray(value)
    ? value.includes(TOC_ONLY_CLASS)
    : value === TOC_ONLY_CLASS;
};

/**
 * A heading left without its self-link. Marker-free headings mutate in place;
 * a stripped one, one that lost its own anchor, or a `[toc]`-only one needs
 * its children (and class) replaced, so it re-emits as a new element carrying
 * the original children as refs.
 */
const unwrappedHeading = (
  node: HastNode,
  ctx: HastContext,
  slug: string,
  stripped: StrippedHeading,
  content: HeadingContent
): HastNode | undefined => {
  const tocOnly = stripped.toc === "only" || hasTocOnlyClass(node);
  if (
    stripped.strippedLength ||
    content.children.length !== stripped.children.length ||
    (tocOnly && !hasTocOnlyClass(node))
  ) {
    const properties = tocOnly
      ? {
          ...node.properties,
          className: withTocOnlyClass(node.properties?.className),
          id: slug,
        }
      : { ...node.properties, id: slug };
    return {
      children: content.children,
      properties,
      tagName: node.tagName,
      type: "element",
    };
  }
  // Unwrapped headings (h1, an empty slug, or one that already links) still
  // need the id so `heading-ids` adopts it instead of re-slugging.
  if (!isStringId(node.properties?.id)) {
    ctx.setProperty(node, "id", slug);
  }
  return undefined;
};

/**
 * Build the plugin. Always parses markers and assigns ids; `wrap: false` only
 * disables the self-linking anchor wrap on `<h2>`–`<h6>`.
 */
export const headingAnchorPlugin = (
  options: HeadingAnchorOptions = {}
): HeadingAnchorPlugin => ({
  element: {
    filter: HEADINGS,
    visit(node, ctx) {
      const state = stateFor(ctx);
      const stripped = stripMarkers(node);
      const content = readContent(stripped.children, ctx);
      const slug = slugFor(node, ctx, state.slugger, stripped, content);
      if (stripped.toc === "hide") {
        state.hidden.push(slug);
      }
      if (content.text !== undefined) {
        recordTocText(state, ctx, slug, content.text.trim());
      }
      const wrap =
        options.wrap !== false &&
        node.tagName !== undefined &&
        WRAPPED.has(node.tagName) &&
        slug !== "" &&
        stripped.toc !== "only" &&
        !hasTocOnlyClass(node) &&
        !containsAnchor(content.children);
      if (!wrap) {
        return unwrappedHeading(node, ctx, slug, stripped, content);
      }
      // Replacing the heading re-emits its original children as refs inside the
      // new anchor (Satteri passes reused nodes through untouched).
      return {
        children: [
          {
            children: content.children,
            properties: {
              className: ["blume-heading-anchor"],
              href: `#${slug}`,
            },
            tagName: "a",
            type: "element",
          },
        ],
        properties: { ...node.properties, id: slug },
        tagName: node.tagName,
        type: "element",
      };
    },
  },
  name: "blume:heading-anchors",
});
