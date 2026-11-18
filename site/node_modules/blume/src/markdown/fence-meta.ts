/**
 * The shared fence-meta grammar: how the tokens after a code fence's language
 * (```ts title="..." {1,3-5} lineNumbers) split, and which of them carry
 * reserved meaning. Both the Shiki-side meta reader (`code-title.ts`) and the
 * MDAST plugins that rewrite marked fences (`ts2js.ts`) consume this, so the
 * two layers can't drift on token boundaries or keyword lists.
 */

/**
 * Any quoted `key="..."` attr (spaces allowed inside the quotes). The body
 * excludes only the delimiting quote, so `title="foo's file.ts"` (an
 * apostrophe inside double quotes) still matches. The left boundary stops
 * `subtitle="..."` (or any `*title=` attr) from reading as a title.
 */
export const QUOTED_ATTR = /[\w-]+=(?:"[^"]*"|'[^']*')/gu;

/**
 * A Shiki `{1,3-5}` line-range token, braces included. Shiki tolerates
 * whitespace inside the braces (`{1, 3-5}`), so the range is one token even
 * when it contains spaces — split on whitespace alone, `3-5}` would surface
 * as a bare word and be promoted to the block title.
 */
const LINE_RANGE = /\{[^}]*\}/u;

/**
 * One fence-meta token: a quoted attribute, a line range, or a bare word, so
 * a keyword inside a quoted value (`title="enable ts2js later"`) never reads
 * as a bare token and a spaced line range never splits.
 */
const META_TOKEN = new RegExp(
  `${QUOTED_ATTR.source}|${LINE_RANGE.source}|\\S+`,
  "gu"
);

/** Split a raw fence meta string into its tokens. */
export const metaTokens = (meta: string | null | undefined): string[] =>
  meta?.match(META_TOKEN) ?? [];

/**
 * Bare keywords with reserved meaning after the language; never promoted to
 * a block title.
 */
export const RESERVED_META_KEYWORDS: ReadonlySet<string> = new Set([
  "expandable",
  "lineNumbers",
  "ts2js",
  "twoslash",
  "wrap",
]);

/**
 * Bare keywords other docs tools read after the language, which Blume
 * doesn't: Mintlify's `lines` and Docusaurus' `showLineNumbers` (line
 * numbers) and Fern's `wordWrap` on any fence, and rustdoc's and mdBook's test
 * and playground attributes on a Rust one. They do nothing here, so they're
 * never promoted to a block title, and `blume check` warns about each
 * (`BLUME_CODE_FENCE_OPTION`).
 */
const FOREIGN_META_KEYWORDS: ReadonlySet<string> = new Set([
  "lines",
  "wordWrap",
]);

// Docusaurus' line-numbers keyword, with an optional start line
// (`showLineNumbers{3}`).
const SHOW_LINE_NUMBERS = /^showLineNumbers(?:\{\d*\})?$/u;

export const RUST_META_KEYWORDS: ReadonlySet<string> = new Set([
  "compile_fail",
  "edition2015",
  "edition2018",
  "edition2021",
  "edition2024",
  "editable",
  "ignore",
  "no_run",
  "noplayground",
  "should_panic",
]);

/** The fence languages rustdoc's and mdBook's keywords apply to. */
export const RUST_LANGUAGES: ReadonlySet<string> = new Set(["rs", "rust"]);

/** Whether `token` is another tool's keyword in a fence of language `lang`. */
export const isForeignKeyword = (
  token: string,
  lang: string | null | undefined
): boolean =>
  FOREIGN_META_KEYWORDS.has(token) ||
  SHOW_LINE_NUMBERS.test(token) ||
  (RUST_LANGUAGES.has(lang ?? "") && RUST_META_KEYWORDS.has(token));

/** A Shiki `{1,3-5}` line-range token. */
export const isLineRange = (token: string): boolean => token.startsWith("{");
