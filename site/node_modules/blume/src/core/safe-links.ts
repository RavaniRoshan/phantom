import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

import { isSafeHref } from "./safe-href.ts";
import { escapeMarkdownText } from "./sources/lower.ts";

/** A link (or link definition) whose destination isn't safe. */
export interface UnsafeLinkSpan {
  /** End offset in the source, exclusive. */
  end: number;
  /** Start offset in the source. */
  start: number;
  /**
   * What replaces it: the link's label, escaped so it can't form a link
   * again; empty for a definition.
   */
  text: string;
}

/**
 * The unsafe links in a parsed Markdown tree, in source order: inline and
 * reference links (autolinks included) and link definitions whose parsed
 * destination fails {@link isSafeHref}. The parsed `url` is what a browser
 * would get, character references and all, so `java&#115;cript:` is caught.
 */
export const unsafeLinkSpans = (tree: Root): UnsafeLinkSpan[] => {
  const spans: UnsafeLinkSpan[] = [];
  const visit = (node: Nodes): void => {
    if (
      (node.type === "link" || node.type === "definition") &&
      !isSafeHref(node.url)
    ) {
      // fromMarkdown stamps every node's position.
      const start = node.position?.start.offset ?? 0;
      const end = node.position?.end.offset ?? 0;
      spans.push({
        end,
        start,
        text: node.type === "link" ? escapeMarkdownText(toString(node)) : "",
      });
      return;
    }
    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(tree);
  return spans;
};

/**
 * Markdown with every unsafe link reduced to its label text and every unsafe
 * link definition removed. Everything else — safe links, raw HTML, code —
 * passes through as written. The Markdown is read as GitHub-flavored, the way
 * the site renders it: a link inside a footnote definition or a table cell is
 * only a link to a GFM parser.
 */
export const neutralizeUnsafeLinks = (markdown: string): string => {
  const spans = unsafeLinkSpans(
    fromMarkdown(markdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    })
  );
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += markdown.slice(cursor, span.start) + span.text;
    cursor = span.end;
  }
  return out + markdown.slice(cursor);
};
