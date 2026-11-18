/**
 * A pinned heading id (`## Heading [#a--b]`, `{#a--b}`) is used verbatim, but
 * the parse that reads it applies smart punctuation (Astro's `smartypants`,
 * on by default) to the whole heading first: `--` became `–`, `...` became
 * `…`, and quotes curled, so the id rendered as `a–b` while every link
 * written to it says `#a--b`. Smart punctuation leaves a backslash-escaped
 * character alone, so before a source is parsed, the punctuation in each
 * heading's trailing markers is escaped where the author wrote it, and the
 * parse reads the id as typed. An id with a typed `–` keeps it.
 *
 * The page render, each `<include>` splice, and the scan-time heading reader
 * all escape their source this way, so the rendered id and the anchor index
 * `blume validate` checks against agree.
 */

import type { Heading, Nodes } from "mdast";
import { markdownToMdast, mdxToMdast } from "satteri";
import type { SourceFormat } from "satteri";

import {
  MARKDOWN_BODY_FEATURES,
  MDX_BODY_FEATURES,
} from "../markdown/features.ts";
import { parseHeadingMarkers } from "./heading-markers.ts";

/** What smart punctuation rewrites: dashes, an ellipsis, and quotes. */
const SMART_INPUT = /--|\.\.\.|['"]/u;

/**
 * A run that opens a pinned id, up to whitespace or a closing bracket. The
 * runs never overlap, so finding them all stays linear.
 */
const PIN_RUN = /[[{]#[^\s\]}]*/gu;

/** A backslash escape (kept as is), or a character smart punctuation reads. */
const PUNCTUATION = /\\[\s\S]|[-.'"]/gu;

const escapePunctuation = (text: string): string =>
  text.replaceAll(PUNCTUATION, (match) =>
    match.length === 1 ? `\\${match}` : match
  );

/** Whether any pinned id in the source holds something smart punctuation rewrites. */
const hasPunctuatedPin = (source: string): boolean => {
  for (const [run] of source.matchAll(PIN_RUN)) {
    if (SMART_INPUT.test(run)) {
      return true;
    }
  }
  return false;
};

/** One replacement in the source: `text` in place of `from`…`end`. */
interface Edit {
  end: number;
  from: number;
  text: string;
}

/**
 * The escape a heading's trailing markers need, if any. Markers only count at
 * the end of a heading's last text node (see `markdown/heading-anchors.ts`),
 * and a heading that is nothing but markers keeps them as literal text, so
 * neither is touched here either.
 */
const pinEdit = (heading: Heading, source: string): Edit | undefined => {
  const last = heading.children.at(-1);
  const start = last?.position?.start.offset;
  const end = last?.position?.end.offset;
  if (last?.type !== "text" || start === undefined || end === undefined) {
    return undefined;
  }
  const parsed = parseHeadingMarkers(last.value);
  if (
    parsed.id === undefined ||
    (parsed.text === "" && heading.children.length === 1)
  ) {
    return undefined;
  }
  // The same markers, read where the author wrote them.
  const written = parseHeadingMarkers(source.slice(start, end));
  const from = start + written.text.length;
  const markers = source.slice(from, end);
  if (written.id === undefined || !SMART_INPUT.test(markers)) {
    return undefined;
  }
  return { end, from, text: escapePunctuation(markers) };
};

/** Collect the edits for every heading under `node`, in source order. */
const collectEdits = (node: Nodes, source: string, edits: Edit[]): void => {
  if (node.type === "heading") {
    const edit = pinEdit(node, source);
    if (edit) {
      edits.push(edit);
    }
    return;
  }
  if ("children" in node) {
    for (const child of node.children) {
      collectEdits(child, source, edits);
    }
  }
};

const parse = (source: string, format: SourceFormat): Nodes | undefined => {
  try {
    return format === "mdx"
      ? mdxToMdast(source, { features: MDX_BODY_FEATURES })
      : markdownToMdast(source, { features: MARKDOWN_BODY_FEATURES });
  } catch {
    // A source MDX can't parse fails its own render, with its own error.
    return undefined;
  }
};

/**
 * `source` with the smart-punctuation characters in each heading's pinned id
 * backslash-escaped, so a parse with smart punctuation reads the id as
 * written. `source` must be the whole text the parse will read, link
 * definitions included: they decide which brackets are links. A source
 * without such a pin is returned as is, unparsed.
 */
export const escapePinnedIds = (
  source: string,
  format: SourceFormat
): string => {
  const tree = hasPunctuatedPin(source) ? parse(source, format) : undefined;
  if (!tree) {
    return source;
  }
  const edits: Edit[] = [];
  collectEdits(tree, source, edits);
  let escaped = "";
  let at = 0;
  for (const edit of edits) {
    escaped += source.slice(at, edit.from) + edit.text;
    at = edit.end;
  }
  return escaped + source.slice(at);
};
