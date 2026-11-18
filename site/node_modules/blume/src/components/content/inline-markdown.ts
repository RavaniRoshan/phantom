import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";
import { defineMdastPlugin } from "satteri";

/**
 * Shared helpers for components that render a short Markdown prop (a caption,
 * a description, a tooltip label) into inline HTML injected via `set:html`.
 * Previously copied verbatim into Prompt, Frame, and Tooltip.
 */

/**
 * Neutralize raw HTML in a Markdown-rendered text prop: each raw HTML node
 * the parser finds (an inline tag, a block, a comment) renders as its literal
 * text instead. Deciding in the tree rather than escaping `<`/`>` in the
 * source keeps what only looks like HTML intact — a code span's
 * `` `Array<string>` `` and an autolink's `<https://…>` — and `&` entity
 * references keep resolving (`&copy;` renders as ©).
 */
export const rawHtmlAsTextPlugin = defineMdastPlugin({
  html(node, ctx) {
    ctx.replaceNode(node, { type: "text", value: node.value });
  },
  name: "blume-raw-html-as-text",
});

/**
 * Unwrap the `<p>` a block-level Markdown render wraps around single-line
 * content, so it can sit inside inline markup. Only a *single* paragraph is
 * unwrapped: the content must not contain its own `</p>`, or
 * `<p>a</p>\n<p>b</p>` would "unwrap" to `a</p>\n<p>b` — unbalanced HTML
 * injected via `set:html`.
 */
const SINGLE_PARAGRAPH = /^<p>(?<content>(?:(?!<\/p>)[\s\S])*)<\/p>$/u;

export const unwrapParagraph = (html: string): string => {
  const trimmed = html.trim();
  return SINGLE_PARAGRAPH.exec(trimmed)?.groups?.content ?? trimmed;
};

/** Render Markdown to HTML, its raw HTML shown as text. */
const renderMarkdown = async (value: string): Promise<string> => {
  const processor = await createSatteriMarkdownProcessor({
    mdastPlugins: [rawHtmlAsTextPlugin],
  });
  const rendered = await processor.render(value);
  return rendered.code;
};

/**
 * Render a short Markdown text prop to inline HTML, its raw HTML shown as
 * text (see {@link rawHtmlAsTextPlugin}) and a single paragraph unwrapped.
 */
export const renderInlineMarkdown = async (value: string): Promise<string> =>
  unwrapParagraph(await renderMarkdown(value));

// What inline Markdown a title can hold starts with: a backslash escape, a
// code span, emphasis or strikethrough, or a link.
const INLINE_SYNTAX = /[\\`*_~[]/u;

/**
 * A title prop (a callout's, an accordion item's) as inline HTML, with its
 * Markdown rendered — `` `code` ``, `**bold**`, `[links](/x)` — and its raw
 * HTML shown as text. Undefined when the title renders as written instead:
 * when it holds none of that syntax, so a plain title keeps the exact text it
 * always rendered, and when it doesn't render as one paragraph (`1. Install`
 * is no list).
 */
export const renderInlineTitle = async (
  value: string
): Promise<string | undefined> => {
  if (!INLINE_SYNTAX.test(value)) {
    return undefined;
  }
  const html = await renderMarkdown(value);
  return SINGLE_PARAGRAPH.exec(html.trim())?.groups?.content;
};
