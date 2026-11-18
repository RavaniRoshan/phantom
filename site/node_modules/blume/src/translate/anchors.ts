import { scanBody } from "../core/sources/normalize.ts";

/**
 * Keep heading anchors identical across languages. A translated heading slugs
 * to a different id (`## Ordering` → `#ordering`, `## Reihenfolge` →
 * `#reihenfolge`), so a `/guide#ordering` link — which the runtime keeps
 * inside the reader's locale — would land at the top of the translated page.
 * After a translation validates, every heading whose rendered id would differ
 * from its source counterpart gets the source id pinned as a trailing
 * `[#id]` marker, so the anchor index (and every `#fragment` link) agrees in
 * every locale. Headings the translation already pins are left alone: the
 * agent is told to copy markers verbatim, and a hand-authored pin is the
 * translator's choice.
 *
 * Headings pair positionally, so the translation must mirror the source's
 * heading structure (the prompt demands exactly that); when it doesn't, no
 * pins are added and the text is returned unchanged with a reason.
 */

export interface PinResult {
  /** Number of headings that received a pin. */
  pinned: number;
  /** Why no pins were added, when the structures don't line up. */
  skipped?: string;
  text: string;
}

/** An ATX heading's optional closing hash run, which a marker must precede. */
const ATX_CLOSE = /\s+#+$/u;

const structureOf = (headings: readonly { depth: number }[]): string =>
  headings.map((heading) => heading.depth).join(",");

/** Append `[#id]` to a heading line, ahead of any closing `##` and line end. */
const pinLine = (line: string, id: string): string => {
  const eol = line.endsWith("\r") ? "\r" : "";
  const body = line.slice(0, line.length - eol.length).trimEnd();
  const close = body.match(ATX_CLOSE)?.[0] ?? "";
  const head = body.slice(0, body.length - close.length);
  return `${head} [#${id}]${close}${eol}`;
};

export const pinHeadingAnchors = (
  sourceText: string,
  translatedText: string
): PinResult => {
  const source = scanBody(sourceText);
  const translated = scanBody(translatedText);
  if (structureOf(source.headings) !== structureOf(translated.headings)) {
    return {
      pinned: 0,
      skipped: `heading structure differs (source has ${source.headings.length} headings, translation has ${translated.headings.length})`,
      text: translatedText,
    };
  }

  const lines = translatedText.split("\n");
  let pinned = 0;
  for (const [index, heading] of translated.headings.entries()) {
    const site = translated.sites[index];
    const sourceId = source.headings[index]?.slug;
    if (
      !site ||
      site.pinned ||
      sourceId === undefined ||
      heading.slug === sourceId
    ) {
      continue;
    }
    lines[site.line - 1] = pinLine(lines[site.line - 1] ?? "", sourceId);
    pinned += 1;
  }
  if (pinned === 0) {
    return { pinned, text: translatedText };
  }

  // The pins must reproduce the source ids exactly once rendered; anything
  // else (a heading the line-based rewrite couldn't reach) keeps the text as
  // the agent wrote it rather than shipping a half-pinned page.
  const text = lines.join("\n");
  const rendered = scanBody(text).headings.map((heading) => heading.slug);
  const expected = source.headings.map((heading) => heading.slug);
  if (rendered.join("\n") !== expected.join("\n")) {
    return {
      pinned: 0,
      skipped: "pinned anchors did not reproduce the source heading ids",
      text: translatedText,
    };
  }
  return { pinned, text };
};
