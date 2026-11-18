/**
 * A code fence's language, read the way authors coming from other docs tools
 * write it. Shiki matches language ids exactly, so two common spellings used
 * to fall back to plain text with only a console line:
 *
 * - a capitalized id (```` ```JSON ````, ```` ```Dockerfile ````): Shiki's ids
 *   and aliases are all lowercase, so the id is lowercased when that names a
 *   language and the spelling as written doesn't.
 * - a line range glued to the id (```` ```js{2} ````, the VitePress and
 *   VuePress form): the range moves into the fence meta, ahead of any meta
 *   already there, where the line-highlight transformer reads it.
 * - a line range glued to a bracketed title (```` ```ts [file.ts]{2} ````,
 *   the Docus form): a space splits it off, so the title is the bracketed
 *   word alone and the range stays a range.
 *
 * Every other fence keeps its language and meta exactly as written.
 */

import { bundledLanguages } from "shiki/langs";

import type { MdastNode } from "./mdast.ts";

/** The ids Shiki renders without a grammar: plain text and ANSI output. */
const PLAIN_LANGUAGES: ReadonlySet<string> = new Set([
  "ansi",
  "plain",
  "plaintext",
  "text",
  "txt",
]);

/** Whether Shiki highlights `lang` as written: a bundled id, alias, or plain. */
export const isKnownLanguage = (lang: string): boolean =>
  PLAIN_LANGUAGES.has(lang) || Object.hasOwn(bundledLanguages, lang);

/** A language id with a line range glued on: `js{2}`, `ts{1,3-5}`. */
const GLUED_RANGE = /^(?<lang>[^{]+)(?<range>\{[^}]*\})$/u;

/** A bracketed title with a line range glued on: `[file.ts]{2}`. */
const GLUED_TITLE_RANGE =
  /(?<=^|\s)(?<title>\[[^\]]*\])(?<range>\{[^}]*\})(?=\s|$)/u;

/** A fence's language and meta, after {@link normalizeFence}. */
export interface Fence {
  lang: string;
  meta: string | null;
}

/**
 * The language and meta a fence means, or null when it means what it says.
 * A range glued to the language moves into the meta and one glued to a
 * bracketed title splits off it, then a capitalized language that only names
 * a known language in lowercase is lowercased.
 */
export const normalizeFence = (
  lang: string | null | undefined,
  meta: string | null | undefined
): Fence | null => {
  if (!lang) {
    return null;
  }
  const glued = GLUED_RANGE.exec(lang)?.groups;
  const id = glued?.lang ?? lang;
  const fenceMeta =
    (glued?.range
      ? [glued.range, meta].filter(Boolean).join(" ")
      : meta
    )?.replace(GLUED_TITLE_RANGE, "$<title> $<range>") ?? null;
  const lower = id.toLowerCase();
  const language = !isKnownLanguage(id) && isKnownLanguage(lower) ? lower : id;
  return language === lang && fenceMeta === (meta ?? null)
    ? null
    : { lang: language, meta: fenceMeta };
};

/** The code node slice the plugin reads. */
interface CodeNode extends MdastNode {
  lang?: string | null;
  meta?: string | null;
}

/** The visitor context slice the plugin writes through. */
interface FenceContext {
  setProperty: (
    node: CodeNode,
    key: "lang" | "meta",
    value: string | null
  ) => void;
}

/**
 * Satteri MDAST plugin applying {@link normalizeFence} to every fence. It runs
 * before the plugins that read a fence's language (`package-install`, `ts2js`,
 * mermaid) and before Shiki, so all of them see the normalized fence.
 */
export const fenceLanguagePlugin = () => ({
  code(node: CodeNode, ctx: FenceContext) {
    const fence = normalizeFence(node.lang, node.meta);
    if (!fence) {
      return;
    }
    ctx.setProperty(node, "lang", fence.lang);
    ctx.setProperty(node, "meta", fence.meta);
  },
  name: "blume-fence-language",
});
