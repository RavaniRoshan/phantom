/**
 * Smart punctuation (Astro's `smartypants`, on by default) curls quotes and
 * turns `--`, `---`, and `...` into dashes and an ellipsis as a page parses.
 * That suits prose, but a `<Prompt>`'s body is never shown: it's copied into
 * an AI tool as Markdown, where `lang=“ts”` and `–force` are broken code. This
 * plugin puts back the punctuation the author typed in the body's text.
 *
 * Each text node is compared with its own source: a typographic mark the
 * source doesn't contain came from smart punctuation, so it goes back to the
 * ASCII it was made from. A mark the author typed (or wrote as an entity)
 * stays.
 */

import type { MdastNode } from "./mdast.ts";

/** Each group of marks smart punctuation makes, and the ASCII it makes them from. */
const MARKS: readonly { ascii: string; marks: readonly string[] }[] = [
  { ascii: '"', marks: ["“", "”"] },
  { ascii: "'", marks: ["‘", "’"] },
  { ascii: "---", marks: ["—"] },
  { ascii: "--", marks: ["–"] },
  { ascii: "...", marks: ["…"] },
];

const ANY_MARK = /[“”‘’—–…]/u;

/** A character reference (`&rsquo;`, `&#8217;`), which can spell any mark. */
const ENTITY = /&[#\da-z]+;/iu;

/** The text as the author typed it, given the source it was parsed from. */
export const restorePunctuation = (value: string, source: string): string => {
  if (!ANY_MARK.test(value) || ENTITY.test(source)) {
    return value;
  }
  let restored = value;
  for (const { ascii, marks } of MARKS) {
    if (!marks.some((mark) => source.includes(mark))) {
      for (const mark of marks) {
        restored = restored.replaceAll(mark, ascii);
      }
    }
  }
  return restored;
};

/** The node slice the plugin reads. */
interface PromptNode extends MdastNode {
  children?: PromptNode[];
  name?: string | null;
  position?: { end: { offset?: number }; start: { offset?: number } };
  value?: string;
}

/** The visitor context slice the plugin reads and writes through. */
interface PromptContext {
  readonly source: string;
  setProperty: (node: PromptNode, key: "value", value: string) => void;
}

/** Restore every text node under `node`. */
const restoreTexts = (node: PromptNode, ctx: PromptContext): void => {
  for (const child of node.children ?? []) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (
      child.type === "text" &&
      child.value !== undefined &&
      start !== undefined &&
      end !== undefined
    ) {
      const value = restorePunctuation(
        child.value,
        ctx.source.slice(start, end)
      );
      if (value !== child.value) {
        ctx.setProperty(child, "value", value);
      }
    }
    restoreTexts(child, ctx);
  }
};

const visit = (node: PromptNode, ctx: PromptContext): void => {
  if (node.name === "Prompt") {
    restoreTexts(node, ctx);
  }
};

/** Satteri MDAST plugin that undoes smart punctuation in `<Prompt>` bodies. */
export const promptTextPlugin = () => ({
  mdxJsxFlowElement: visit,
  mdxJsxTextElement: visit,
  name: "blume-prompt-text",
  options: { position: true },
});
