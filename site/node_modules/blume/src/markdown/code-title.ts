/**
 * Code-fence meta. A Shiki transformer reads the tokens after the language and
 * promotes them to attributes on the rendered `<pre>`:
 *
 * - a title — the bare words (```ts blume.config.ts, ```js Install the
 *   client) or `title="..."` — becomes `data-title`; the theme's code header
 *   shows it, falling back to the language label.
 * - the `lineNumbers` keyword (```ts file.ts lineNumbers) becomes
 *   `data-line-numbers`; the theme renders a counter-driven line-number gutter.
 * - the `wrap` keyword becomes `data-wrap`: this block's long lines wrap
 *   instead of scrolling, as `markdown.code.wrap` does for every block.
 * - the `expandable` keyword becomes `data-expandable` on a block of
 *   {@link EXPANDABLE_MIN_LINES} lines or more: the theme shows its first
 *   {@link EXPANDABLE_VISIBLE_LINES} lines, and the page script adds a toggle
 *   that shows the rest in full. A shorter block renders as it is.
 */

import {
  isForeignKeyword,
  isLineRange,
  metaTokens,
  QUOTED_ATTR,
  RESERVED_META_KEYWORDS,
} from "./fence-meta.ts";

/** The lines a collapsed `expandable` block shows. */
export const EXPANDABLE_VISIBLE_LINES = 10;

/**
 * The lines a block needs before `expandable` collapses it: a few more than it
 * shows, so the toggle never hides a line or two behind a click.
 */
export const EXPANDABLE_MIN_LINES = 16;

/** The slice of Shiki's transformer `this` context Blume reads. */
interface CodeMetaContext {
  options: { lang?: string; meta?: { __raw?: string } };
  /** The block's code, as highlighted. */
  source?: string;
}

/** The `<pre>` hast node a Shiki `pre` hook receives. */
interface PreNode {
  properties: Record<string, boolean | number | string | undefined>;
}

/** A Shiki-compatible transformer, typed structurally to avoid a Shiki dep. */
export interface CodeTitleTransformer {
  name: string;
  pre: (this: CodeMetaContext, node: PreNode) => void;
}

const TITLE_ATTR = /(?:^|\s)title=(?:"(?<dq>[^"]*)"|'(?<sq>[^']*)')/u;

// The bare words are the title (```ts blume.config.ts, ```js Install the
// client): every token that isn't a Shiki line range (`{1,3-5}`), a
// `key=value` attr, a reserved keyword, or another tool's keyword for a
// fence in `lang` (```rust ignore).
const isTitleToken = (token: string, lang: string | undefined): boolean =>
  token.length > 0 &&
  !isLineRange(token) &&
  !token.includes("=") &&
  !RESERVED_META_KEYWORDS.has(token) &&
  !isForeignKeyword(token, lang);

// A title wrapped in one pair of brackets (```ts [file.ts], the Docus and
// VitePress code-group spelling) shows without them.
const BRACKETED_TITLE = /^\[(?<inner>[^\]]+)\]$/u;

/**
 * The title a fence's meta string promotes to `data-title`, if any. `lang` is
 * the fence's language, which decides the other tools' keywords it drops.
 */
export const parseCodeTitle = (
  raw: string | undefined,
  lang?: string
): string | undefined => {
  if (!raw) {
    return undefined;
  }
  // Blank every *other* quoted attr first, so a `title="…"` embedded in
  // another attribute's value (`caption='set title="X" here'`) can't be
  // promoted to the block title.
  const scrubbed = raw.replace(QUOTED_ATTR, (attr) =>
    attr.startsWith("title=") ? attr : " "
  );
  const explicit = scrubbed.match(TITLE_ATTR);
  const attrTitle = explicit?.groups?.dq ?? explicit?.groups?.sq;
  if (attrTitle) {
    return attrTitle;
  }
  // The shared tokenizer keeps a quoted attr (rejected below by its `=`) and
  // a spaced line range (`{1, 3-5}`) whole, so neither can shed a fragment
  // that reads as a bare title.
  const title = metaTokens(raw)
    .filter((token) => isTitleToken(token, lang))
    .join(" ");
  return BRACKETED_TITLE.exec(title)?.groups?.inner ?? (title || undefined);
};

// The shared tokenizer keeps a quoted attr whole, so a keyword inside a
// quoted value (`title="enable lineNumbers later"`) is never a token of its own.
const hasKeyword = (raw: string | undefined, keyword: string): boolean =>
  metaTokens(raw).includes(keyword);

/** How many lines a block's code runs to, a trailing newline aside. */
export const lineCount = (source = ""): number =>
  source === "" ? 0 : source.replace(/\r?\n$/u, "").split(/\r?\n/u).length;

/** Build the transformer. Runs after Shiki's built-in `data-language` hook. */
export const codeTitleTransformer = (): CodeTitleTransformer => ({
  name: "blume:code-meta",
  pre(node) {
    const raw = this.options.meta?.__raw;
    const title = parseCodeTitle(raw, this.options.lang);
    if (title) {
      node.properties.dataTitle = title;
    }
    if (hasKeyword(raw, "lineNumbers")) {
      node.properties.dataLineNumbers = true;
    }
    if (hasKeyword(raw, "wrap")) {
      node.properties.dataWrap = true;
    }
    if (
      hasKeyword(raw, "expandable") &&
      lineCount(this.source) >= EXPANDABLE_MIN_LINES
    ) {
      node.properties.dataExpandable = true;
    }
  },
});
