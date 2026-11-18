import type { Nodes, Paragraph } from "mdast";
import { markdownToMdast, mdxToMdast } from "satteri";

import {
  CALLOUT_ALIASES,
  CALLOUT_TYPES,
  calloutTypeFor,
} from "../markdown/directives.ts";
import {
  MARKDOWN_BODY_FEATURES,
  MDX_BODY_FEATURES,
} from "../markdown/features.ts";
import { strippedLineOffset } from "./sources/normalize.ts";
import type { SourceEntry } from "./sources/types.ts";
import type { Diagnostic } from "./types.ts";

type ContainerDirective = Extract<Nodes, { type: "containerDirective" }>;

// A line that may open a container directive: a colon fence and a name, after
// any quote or list indentation.
const CONTAINER_OPENING = /^[\t >]*:{3,}(?<name>[a-z][\w-]*)/gimu;

// A colon fence followed by text that opens no directive: text after a space
// (`::: card`), or a character no name starts with (`:::{.x}`). Such a line
// either closes a container and loses its text, or is a spaced opener.
const FENCE_WITH_TEXT = /^[\t >]*:{3,}(?:[\t ]+\S|[^\s:a-z])/imu;

// A container's closing line: the colon fence and whatever follows it.
const CLOSING_LINE =
  /^[\t >]*(?<written>(?<fence>:{3,})[\t ]*(?<text>.*?))\s*$/u;

// A container opener with text after its name, and after any `[label]` or
// `{attributes}`: `:::tip Some title`. Sätteri drops that text.
const OPENING_TEXT =
  /^[\t >]*(?<written>(?<fence>:{3,})(?<name>[a-z][\w-]*)(?<label>\[[^\]\n]*\])?(?<attributes>\{[^}\n]*\})?[\t ]+(?<text>\S.*?))\s*$/iu;
const OPENING_TEXT_LINE =
  /^[\t >]*:{3,}[a-z][\w-]*(?:\[[^\]\n]*\])?(?:\{[^}\n]*\})?[\t ]+\S/imu;

// A markdown-it style opener, `::: tip Title`, which is no directive at all.
const SPACED_OPENING =
  /^[\t >]*(?<written>(?<fence>:{3,})[\t ]+(?<name>[a-z][\w-]*)(?<title>.*?))\s*$/iu;

// A container opener's colon fence and name, after any quote or list
// indentation, as one line of a `.md` paragraph holds it.
const MD_OPENING = /^[\t >]*(?<written>:{3,}(?<name>[a-z][\w-]*))/iu;
const MD_OPENING_LINE = /^[\t >]*:{3,}[a-z]/imu;

const codeList = (names: Iterable<string>): string =>
  [...names].map((name) => `\`${name}\``).join(", ");

const CALLOUT_NAMES = `${codeList(CALLOUT_TYPES)} (or the aliases ${codeList(Object.keys(CALLOUT_ALIASES))})`;

/** A directive problem at a line of the parsed text, before it's placed in a file. */
interface Finding {
  code: string;
  line: number;
  message: string;
  suggestion: string;
}

const unknownContainer = (node: ContainerDirective): Finding[] =>
  calloutTypeFor(node.name) === null
    ? [
        {
          code: "BLUME_UNKNOWN_DIRECTIVE",
          line: node.position?.start.line ?? 1,
          message: `\`:::${node.name}\` isn't a callout type, so the page shows its \`:::\` lines as written around its content.`,
          suggestion: `Use a callout type — ${CALLOUT_NAMES} — or remove the \`:::\` lines to keep the content as plain prose.`,
        },
      ]
    : [];

/**
 * Text after the colons of a container's closing fence. Sätteri closes a
 * container on any line that starts with at least its fence's colons and
 * drops the rest of that line (micromark's directive grammar, which
 * `remark-directive` uses, keeps such a line as content), so a `::: card`
 * inside a `:::warning` ends the callout early and `card` never reaches the
 * page. A container left unclosed ends with its content rather than on a
 * fence line of its own.
 */
const closingText = (
  node: ContainerDirective,
  lines: readonly string[]
): Finding[] => {
  const start = node.position?.start.line ?? 1;
  const end = node.position?.end.line ?? start;
  const content = node.children.at(-1)?.position?.end.line ?? start;
  const groups =
    end > content ? CLOSING_LINE.exec(lines[end - 1] ?? "")?.groups : undefined;
  if (!(groups?.text && groups.fence && groups.written)) {
    return [];
  }
  const longer = ":".repeat(groups.fence.length + 1);
  return [
    {
      code: "BLUME_DIRECTIVE_CLOSING_TEXT",
      line: end,
      message: `\`${groups.written}\` closes the \`:::${node.name}\` container above it, so \`${groups.text}\` never reaches the page.`,
      suggestion: `Give the container a longer fence than this line's — \`${longer}${node.name}\`, closed by \`${longer}\` — to keep the line inside it as text, or remove \`${groups.text}\` from the line.`,
    },
  ];
};

/**
 * Text after a callout opener's name (`:::tip Some title`). Sätteri ends the
 * name at the space and drops the rest of the line, so the callout renders
 * untitled and the text never shows. Docusaurus and the markdown-it
 * containers VitePress uses read that text as the title, which is where the
 * spelling comes from. Only callouts count: any other container renders its
 * opening line as written (see `markdown/directives.ts`), text and all.
 */
const openingText = (
  node: ContainerDirective,
  lines: readonly string[]
): Finding[] => {
  const line = node.position?.start.line ?? 1;
  const groups = OPENING_TEXT.exec(lines[line - 1] ?? "")?.groups;
  if (
    !(groups?.fence && groups.name && groups.text && groups.written) ||
    calloutTypeFor(node.name) === null
  ) {
    return [];
  }
  const opener = `${groups.fence}${groups.name}`;
  return [
    {
      code: "BLUME_DIRECTIVE_OPENING_TEXT",
      line,
      message: `\`${groups.written}\` opens a \`${groups.name}\` callout, but the text after its name, \`${groups.text}\`, never reaches the page.`,
      suggestion:
        groups.label || groups.attributes
          ? `Move \`${groups.text}\` into the callout's title, or onto the next line as its text.`
          : `Put the title in brackets: \`${opener}[${groups.text}]\`.`,
    },
  ];
};

/**
 * Callout openers written with a space after the colons (`::: tip`, the
 * markdown-it spelling VitePress, VuePress, and Docusaurus v2 use). That is
 * never a directive, so the line and its whole block render as plain text.
 * Only paragraph lines count, so an example in a code block stays quiet.
 */
const spacedOpenings = (
  node: Paragraph,
  lines: readonly string[]
): Finding[] => {
  const start = node.position?.start.line ?? 1;
  const end = node.position?.end.line ?? start;
  return lines.slice(start - 1, end).flatMap((text, index) => {
    const groups = SPACED_OPENING.exec(text)?.groups;
    if (
      !(groups?.fence && groups.name && groups.written) ||
      calloutTypeFor(groups.name) === null
    ) {
      return [];
    }
    const opener = `${groups.fence}${groups.name}`;
    const title = groups.title?.trim();
    return [
      {
        code: "BLUME_DIRECTIVE_SPACED_NAME",
        line: start + index,
        message: `\`${groups.written}\` has a space between its colons and its name, so it isn't a callout and the page shows it as text.`,
        suggestion: title
          ? `Remove the space and put the title in brackets: \`${opener}[${title}]\`.`
          : `Remove the space: \`${opener}\`.`,
      },
    ];
  });
};

/**
 * The directive problems in an `.mdx` body, in source order. The body is
 * parsed as the renderer reads it, so a fence in a code block never counts. A
 * page is parsed only when a line looks like one of these problems, so pages
 * without one cost a scan. A body MDX can't parse fails to render anyway, with
 * its own error.
 */
const directiveFindings = (text: string): Finding[] => {
  const suspect =
    FENCE_WITH_TEXT.test(text) ||
    OPENING_TEXT_LINE.test(text) ||
    [...text.matchAll(CONTAINER_OPENING)].some(
      (match) => calloutTypeFor(match.groups?.name ?? "") === null
    );
  if (!suspect) {
    return [];
  }
  let tree: Nodes;
  try {
    tree = mdxToMdast(text, { features: MDX_BODY_FEATURES });
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const found: Finding[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === "containerDirective") {
      found.push(
        ...unknownContainer(node),
        ...openingText(node, lines),
        ...closingText(node, lines)
      );
    } else if (node.type === "paragraph") {
      found.push(...spacedOpenings(node, lines));
    }
    if ("children" in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  walk(tree);
  return found.toSorted((a, b) => a.line - b.line);
};

/**
 * Container directive openers on the lines of an `.md` paragraph (`:::note`).
 * A `.md` page renders no directives, so the opener, its content, and its
 * closing `:::` show as text. A directive in a code block is no paragraph.
 */
const mdOpenings = (node: Paragraph, lines: readonly string[]): Finding[] => {
  const start = node.position?.start.line ?? 1;
  const end = node.position?.end.line ?? start;
  return lines.slice(start - 1, end).flatMap((text, index) => {
    const groups = MD_OPENING.exec(text)?.groups;
    if (!(groups?.name && groups.written)) {
      return [];
    }
    const callout = calloutTypeFor(groups.name);
    return [
      {
        code: "BLUME_MD_DIRECTIVE",
        line: start + index,
        message: `\`${groups.written}\` opens a directive, which Blume renders only in .mdx, so this .md page shows it and its closing \`:::\` as text.`,
        suggestion: callout
          ? `Rename the page to .mdx to render it as a \`${callout}\` callout.`
          : `Rename the page to .mdx and use a callout type — ${CALLOUT_NAMES} — or remove the \`:::\` lines to keep the content as plain prose.`,
      },
    ];
  });
};

/**
 * The directives in an `.md` body, in source order, read the way the
 * renderer reads the page: as paragraphs, since `.md` has no directives. A
 * page is parsed only when a line looks like an opener.
 */
const mdDirectiveFindings = (text: string): Finding[] => {
  if (!MD_OPENING_LINE.test(text)) {
    return [];
  }
  const tree: Nodes = markdownToMdast(text, {
    features: MARKDOWN_BODY_FEATURES,
  });
  const lines = text.split("\n");
  const found: Finding[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === "paragraph") {
      found.push(...mdOpenings(node, lines));
    } else if ("children" in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  walk(tree);
  return found;
};

/**
 * Warn about the `:::` directives in an entry that don't render as their
 * author meant. In `.mdx`:
 *
 * - `BLUME_UNKNOWN_DIRECTIVE`: a `:::name` container that isn't a callout.
 *   The page keeps its content — the body renders between the literal `:::`
 *   lines (see `markdown/directives.ts`) — but a typo like `:::warnig`, or a
 *   `:::details` carried over from another docs tool, should read as the
 *   mistake it is rather than as a finished page.
 * - `BLUME_DIRECTIVE_OPENING_TEXT`: a callout opener with text after its
 *   name, which the page drops (`:::tip Some title`).
 * - `BLUME_DIRECTIVE_CLOSING_TEXT`: a closing fence with text after it, which
 *   the page drops (`::: card` inside a `:::warning`).
 * - `BLUME_DIRECTIVE_SPACED_NAME`: a spaced callout opener (`::: tip`), which
 *   the page shows as text.
 *
 * In `.md`, which renders no directives:
 *
 * - `BLUME_MD_DIRECTIVE`: a `:::name` opener, which the page shows as text.
 *
 * Lines point into the file the author wrote, a partial's own file for a
 * directive an `<include>` brought in.
 */
export const directiveDiagnostics = (
  entry: SourceEntry,
  sourceName: string
): Diagnostic[] => {
  const page = entry.sourcePath ?? `${sourceName}:${entry.ref}`;
  const offset =
    entry.bodyLineOffset ?? strippedLineOffset(entry.raw, entry.body.text);
  const text = entry.expanded?.text ?? entry.body.text;
  const findings =
    entry.body.format === "mdx"
      ? directiveFindings(text)
      : mdDirectiveFindings(text);
  return findings.map(({ line, ...finding }) => {
    const origin = entry.expanded?.origins[line - 1];
    return {
      ...finding,
      file: origin?.file ?? page,
      line: origin?.line ?? line + offset,
      severity: "warning",
    };
  });
};
