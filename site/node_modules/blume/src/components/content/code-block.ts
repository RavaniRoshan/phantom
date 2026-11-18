/**
 * The highlighting half of the `<CodeBlock>` content component, kept in a
 * sibling `.ts` (like `badge-color.ts`) so it is unit-testable.
 */
import { highlightCode } from "../../markdown/index.ts";
import type { CodeThemes } from "../../markdown/index.ts";

/** The props `<CodeBlock>` highlights from. */
export interface CodeBlockSource {
  code?: string;
  icons?: boolean;
  lang?: string;
  title?: string;
}

/**
 * The highlighted HTML for a `<CodeBlock>`, or null when it has no `code`.
 * Fern and Mintlify wrap a fenced block in `<CodeBlock>…</CodeBlock>`; the
 * fence inside is already highlighted by the Markdown pipeline, so a
 * `CodeBlock` without `code` renders its children as written rather than
 * failing the page on the missing string.
 */
export const codeBlockHtml = async (
  { code, icons, lang = "txt", title }: CodeBlockSource,
  themes?: CodeThemes
): Promise<string | null> =>
  code === undefined
    ? null
    : await highlightCode(code.replace(/\n+$/u, ""), lang, {
        icons,
        themes,
        title,
      });
