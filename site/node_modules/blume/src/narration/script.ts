/**
 * Narration's reading script: what "Listen to this page" says, in order, and
 * where each spoken sentence sits in the page's text.
 *
 * One walker serves both sides. `blume build` runs it over the built HTML
 * (parsed with node-html-parser) to generate a clip per sentence, and the
 * player runs it over the live `<article>` to highlight the sentence being
 * read. Both see the same markup and apply the same rules, so they agree on
 * every block's text; the sentence split is only ever computed once per
 * engine (by the build for generated audio, by the browser for its own
 * voices), so an ICU difference between Node and the browser can't move a
 * highlight.
 *
 * The rules follow what reads well aloud: the title, description, headings,
 * and prose are read in order; callouts, steps, tabs, and collapsible
 * sections are announced with a short spoken cue; code, tables, media,
 * diagrams, math, API field tables, and anything marked
 * `data-blume-narration="skip"` are left out.
 */

/**
 * The slice of a DOM-like tree the walker reads. The browser DOM and
 * node-html-parser both satisfy it through a small adapter, so the walker
 * never touches either API directly.
 */
export interface NarrationTree<N> {
  /** An element's attribute, or `null` when it is absent. */
  attr: (node: N, name: string) => string | null;
  children: (node: N) => readonly N[];
  /** An element's lowercase tag name; `null` for text and other nodes. */
  tag: (node: N) => string | null;
  /** A text node's decoded text; `null` for elements and other nodes. */
  text: (node: N) => string | null;
}

/**
 * The spoken cues, already localized for the page. `{n}` in `step` is the
 * step's number and `{title}` in `tab` is the tab's label. An empty string
 * silences that cue.
 */
export interface NarrationCues {
  danger: string;
  info: string;
  note: string;
  section: string;
  step: string;
  success: string;
  tab: string;
  tip: string;
  warning: string;
}

/**
 * A run of text read as one unit: a paragraph, heading, list item, or any
 * other block. `nodes` are the text nodes it was read from; `nodeOf[i]` and
 * `offsetOf[i]` locate character `i` of `text` in them, so a sentence's
 * `[start, end)` maps back to a DOM range for highlighting.
 */
export interface NarrationBlock<N> {
  nodeOf: number[];
  nodes: N[];
  offsetOf: number[];
  text: string;
}

/** One step of the reading order: a spoken cue, or a block of page text. */
export type NarrationItem =
  | { block: number; kind: "block" }
  | { kind: "cue"; text: string };

/** What {@link extractNarration} reads from a page. */
export interface NarrationExtract<N> {
  blocks: NarrationBlock<N>[];
  items: NarrationItem[];
}

/**
 * One spoken unit. A sentence carries its block and its `[start, end)` in
 * that block's text; a cue carries `block: null`. `text` is what is spoken.
 */
export interface NarrationSegment {
  block: number | null;
  end: number;
  start: number;
  text: string;
}

/**
 * The per-page manifest `blume build` writes for generated narration. The
 * player aligns `blocks` (the build's block texts) with the live page by
 * text, then plays one clip per segment. A sentence names its block and range;
 * a cue carries its spoken `text` instead.
 */
export interface NarrationManifest {
  blocks: string[];
  segments: NarrationManifestSegment[];
  version: 1;
}

/** One clip of a {@link NarrationManifest}: a sentence or a cue. */
export type NarrationManifestSegment =
  | { audio: string; block: number; end: number; start: number }
  | { audio: string; text: string };

/**
 * A page needs at least this many spoken characters (title and description
 * included) to offer narration: roughly 50 English words. Shorter pages, and
 * pages that are mostly code, tables, or API fields, get no player.
 */
export const NARRATION_MIN_CHARS = 280;

/**
 * Sentences longer than this are split at a clause, then a word boundary.
 * Browser speech engines drop an utterance that runs past about 15 seconds,
 * and shorter clips also keep the highlight moving.
 */
export const NARRATION_MAX_SEGMENT_CHARS = 220;

/** The attribute that keeps an element (and everything in it) out of narration. */
export const NARRATION_SKIP_ATTRIBUTE = "data-blume-narration";

// Inline elements continue the current block; every other element starts and
// ends one, so a paragraph's text never runs into the heading after it. The
// replaced and form elements are inline too: an icon or a button mid-sentence
// is skipped without splitting the sentence around it.
const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "audio",
  "button",
  "canvas",
  "embed",
  "iframe",
  "img",
  "input",
  "math",
  "noscript",
  "object",
  "picture",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

// Content that doesn't read well aloud, or isn't content at all.
const SKIPPED_TAGS = new Set([
  "audio",
  "blume-diff",
  "blume-mermaid",
  "button",
  "canvas",
  "dialog",
  "embed",
  "figure",
  "iframe",
  "img",
  "input",
  "math",
  "nav",
  "noscript",
  "object",
  "picture",
  "pre",
  "script",
  "select",
  "style",
  "svg",
  "table",
  "template",
  "textarea",
  "video",
]);

// Classes whose text is for screen readers or renderers, not for listening:
// visually hidden hints, and KaTeX's glyph layer (its MathML is `math`).
const SKIPPED_CLASSES = ["sr-only", "katex"];

const CALLOUT_KINDS = new Set([
  "danger",
  "info",
  "note",
  "success",
  "tip",
  "warning",
]);

const isCalloutKind = (
  kind: string
): kind is "danger" | "info" | "note" | "success" | "tip" | "warning" =>
  CALLOUT_KINDS.has(kind);

const WHITESPACE = /\s/u;

const hasClass = (classes: string | null, name: string): boolean =>
  classes !== null && classes.split(/\s+/u).includes(name);

const isSkipped = <N>(
  tree: NarrationTree<N>,
  node: N,
  tag: string
): boolean => {
  if (SKIPPED_TAGS.has(tag)) {
    return true;
  }
  if (tree.attr(node, NARRATION_SKIP_ATTRIBUTE) === "skip") {
    return true;
  }
  if (tree.attr(node, "aria-hidden") === "true") {
    return true;
  }
  const classes = tree.attr(node, "class");
  return SKIPPED_CLASSES.some((name) => hasClass(classes, name));
};

/** The spoken cue that introduces an element, or `null` for none. */
const cueFor = <N>(
  tree: NarrationTree<N>,
  node: N,
  tag: string,
  cues: NarrationCues,
  stepNumber: number
): string | null => {
  const callout = tree.attr(node, "data-blume-callout");
  if (callout !== null) {
    return isCalloutKind(callout) ? cues[callout] : cues.note;
  }
  if (tree.attr(node, "data-blume-step") !== null) {
    return cues.step.replaceAll("{n}", String(stepNumber));
  }
  if (tree.attr(node, "data-blume-tab-panel") !== null) {
    const title = tree.attr(node, "data-title");
    return title ? cues.tab.replaceAll("{title}", title) : null;
  }
  return tag === "details" ? cues.section : null;
};

/**
 * Walk `root` and return its reading order: each block of text, with the
 * cues that introduce callouts, steps, tabs, and collapsible sections.
 * Whitespace collapses to single spaces, as it renders.
 */
export const extractNarration = <N>(
  root: N,
  tree: NarrationTree<N>,
  cues: NarrationCues
): NarrationExtract<N> => {
  const blocks: NarrationBlock<N>[] = [];
  const items: NarrationItem[] = [];

  let text = "";
  let nodes: N[] = [];
  let nodeOf: number[] = [];
  let offsetOf: number[] = [];
  let pendingSpace = false;
  // Cues wait here until their element yields text: a tab of nothing but
  // code, or a step holding only a snippet, isn't announced into silence.
  let pendingCues: string[] = [];

  const flush = (): void => {
    if (text) {
      for (const cue of pendingCues) {
        items.push({ kind: "cue", text: cue });
      }
      pendingCues = [];
      items.push({ block: blocks.length, kind: "block" });
      blocks.push({ nodeOf, nodes, offsetOf, text });
    }
    text = "";
    nodes = [];
    nodeOf = [];
    offsetOf = [];
    pendingSpace = false;
  };

  const append = (node: N, value: string): void => {
    let index = -1;
    for (let offset = 0; offset < value.length; offset += 1) {
      const char = value.charAt(offset);
      if (WHITESPACE.test(char)) {
        pendingSpace = text.length > 0;
        continue;
      }
      if (index === -1) {
        index = nodes.length;
        nodes.push(node);
      }
      // A collapsed run of whitespace maps to the character after it, so a
      // range that starts on the space starts on the word instead.
      if (pendingSpace) {
        text += " ";
        nodeOf.push(index);
        offsetOf.push(offset);
        pendingSpace = false;
      }
      text += char;
      nodeOf.push(index);
      offsetOf.push(offset);
    }
  };

  const visit = (node: N, stepNumber: number): void => {
    const value = tree.text(node);
    if (value !== null) {
      append(node, value);
      return;
    }
    const tag = tree.tag(node);
    if (tag === "br") {
      pendingSpace = text.length > 0;
      return;
    }
    // A node with no tag (a parsed document's root) is transparent.
    const inline = tag === null || INLINE_TAGS.has(tag);
    if (tag !== null && isSkipped(tree, node, tag)) {
      if (!inline) {
        flush();
      }
      return;
    }
    if (!inline) {
      flush();
    }
    const cue = tag === null ? null : cueFor(tree, node, tag, cues, stepNumber);
    const cueSlot = pendingCues.length;
    if (cue) {
      pendingCues.push(cue);
    }
    // Steps are numbered among their siblings, the way the CSS counter that
    // draws their markers counts them.
    let steps = 0;
    for (const child of tree.children(node)) {
      if (tree.attr(child, "data-blume-step") !== null) {
        steps += 1;
      }
      visit(child, steps);
    }
    if (!inline) {
      flush();
    }
    // Still pending: nothing inside was read, so drop the cue.
    pendingCues = pendingCues.slice(0, cueSlot);
  };

  visit(root, 0);
  flush();
  return { blocks, items };
};

const CLAUSE_BREAK = /[,;:–—]\s/gu;

/**
 * Split `[start, end)` of `text` into pieces no longer than `max`: after the
 * last clause mark that leaves a piece at least 40% of `max` long, else at
 * the last space, else hard at `max`.
 */
const splitLong = (
  text: string,
  start: number,
  end: number,
  max: number
): [number, number][] => {
  const pieces: [number, number][] = [];
  let from = start;
  while (end - from > max) {
    const window = text.slice(from, from + max);
    const floor = Math.floor(max * 0.4);
    let cut = -1;
    for (const match of window.matchAll(CLAUSE_BREAK)) {
      if (match.index >= floor) {
        cut = match.index + 1;
      }
    }
    if (cut === -1) {
      const space = window.lastIndexOf(" ");
      cut = space >= floor ? space : max;
    }
    pieces.push([from, from + cut]);
    from += cut;
    while (from < end && text.charAt(from) === " ") {
      from += 1;
    }
  }
  pieces.push([from, end]);
  return pieces;
};

/**
 * The sentence spans of `text`. ICU can end a sentence at an ASCII `.`, `?`,
 * or `!` with no space after it, which splits inline code like
 * `?install=windows` in two; a break that isn't followed by whitespace is
 * merged back into one sentence.
 * Full-width terminators (`。`, `？`) end a sentence without a space and keep
 * their breaks.
 */
const sentenceSpans = (
  segmenter: Intl.Segmenter,
  text: string
): [number, number][] => {
  const spans: [number, number][] = [];
  let merge = false;
  for (const { index, segment } of segmenter.segment(text)) {
    const end = index + segment.length;
    const last = spans.at(-1);
    if (merge && last) {
      last[1] = end;
    } else {
      spans.push([index, end]);
    }
    merge = end < text.length && /[.?!]$/u.test(segment);
  }
  return spans;
};

/**
 * Split an extract into spoken segments: a cue as it is, and each block into
 * its sentences for `lang` (long ones broken further, see
 * {@link NARRATION_MAX_SEGMENT_CHARS}).
 */
export const segmentNarration = <N>(
  extract: NarrationExtract<N>,
  lang: string,
  max: number = NARRATION_MAX_SEGMENT_CHARS
): NarrationSegment[] => {
  const segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
  const segments: NarrationSegment[] = [];
  for (const item of extract.items) {
    if (item.kind === "cue") {
      segments.push({ block: null, end: 0, start: 0, text: item.text });
      continue;
    }
    const text = extract.blocks[item.block]?.text ?? "";
    // A sentence span carries its trailing space (ICU attaches whitespace to
    // the sentence it follows, and a block never starts with one), so only
    // the end needs trimming.
    for (const [start, spanEnd] of sentenceSpans(segmenter, text)) {
      let end = spanEnd;
      while (end > start && text.charAt(end - 1) === " ") {
        end -= 1;
      }
      for (const [from, to] of splitLong(text, start, end, max)) {
        segments.push({
          block: item.block,
          end: to,
          start: from,
          text: text.slice(from, to),
        });
      }
    }
  }
  return segments;
};

/** How many characters the page's blocks will speak, cues excluded. */
export const narrationLength = <N>(extract: NarrationExtract<N>): number =>
  extract.blocks.reduce((total, block) => total + block.text.length, 0);

/** Whether a page has enough prose to offer narration. */
export const isNarratable = <N>(extract: NarrationExtract<N>): boolean =>
  narrationLength(extract) >= NARRATION_MIN_CHARS;

const DENSE_SCRIPT_LANGS = new Set(["ja", "ko", "zh"]);

/**
 * Characters read per second at 1x: about 170 words a minute for
 * space-separated scripts, and a slower character rate where a character is a
 * word or more. Estimates only; neither engine reports durations up front.
 */
export const narrationCharsPerSecond = (lang: string): number => {
  const [primary = ""] = lang.toLowerCase().replaceAll("_", "-").split("-");
  return DENSE_SCRIPT_LANGS.has(primary) ? 7 : 15;
};

/** The page's estimated listening time at 1x, in whole minutes (at least 1). */
export const narrationMinutes = (chars: number, lang: string): number =>
  Math.max(1, Math.round(chars / narrationCharsPerSecond(lang) / 60));

/**
 * Map each manifest block onto the live page's blocks by exact text, in
 * order, skipping page blocks the build didn't see (a script may have added
 * some). A manifest block with no match maps to `-1`: its sentences still
 * play, without a highlight.
 */
export const alignBlocks = (
  manifestBlocks: readonly string[],
  pageBlocks: readonly string[]
): number[] => {
  const aligned: number[] = [];
  let next = 0;
  for (const text of manifestBlocks) {
    const found = pageBlocks.indexOf(text, next);
    aligned.push(found);
    if (found !== -1) {
      next = found + 1;
    }
  }
  return aligned;
};

const isString = (value: unknown): value is string => typeof value === "string";

const isManifestSegment = (
  value: unknown
): value is NarrationManifestSegment => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("audio" in value) || typeof value.audio !== "string") {
    return false;
  }
  if ("text" in value && typeof value.text === "string") {
    return true;
  }
  return (
    "block" in value &&
    "start" in value &&
    "end" in value &&
    Number.isInteger(value.block) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end)
  );
};

const CUE_KEYS = [
  "danger",
  "info",
  "note",
  "section",
  "step",
  "success",
  "tab",
  "tip",
  "warning",
] as const;

/** Whether a value (the player's `data-cues` JSON) is a full set of cues. */
export const isNarrationCues = (value: unknown): value is NarrationCues => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const fields = new Map<string, unknown>(Object.entries(value));
  return CUE_KEYS.every((key) => isString(fields.get(key)));
};

/** Whether a fetched manifest has the shape the player plays. */
export const isNarrationManifest = (
  value: unknown
): value is NarrationManifest => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "version" in value &&
    value.version === 1 &&
    "blocks" in value &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isString) &&
    "segments" in value &&
    Array.isArray(value.segments) &&
    value.segments.every(isManifestSegment)
  );
};
