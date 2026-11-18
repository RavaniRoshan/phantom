import type { Nodes } from "mdast";
import { markdownToMdast, mdxToMdast } from "satteri";

import {
  MARKDOWN_BODY_FEATURES,
  MDX_BODY_FEATURES,
} from "../markdown/features.ts";
import { isKnownLanguage, normalizeFence } from "../markdown/fence-language.ts";
import {
  metaTokens,
  RUST_LANGUAGES,
  RUST_META_KEYWORDS,
} from "../markdown/fence-meta.ts";
import { strippedLineOffset } from "./sources/normalize.ts";
import type { SourceEntry } from "./sources/types.ts";
import type { Diagnostic } from "./types.ts";

type Code = Extract<Nodes, { type: "code" }>;

/**
 * Fence languages that render without a Shiki grammar on purpose: `math`,
 * which Astro never highlights, and `package-install`, which `.mdx` turns
 * into install tabs (and the docs describe as a plain block in `.md`).
 */
const BLUME_LANGUAGES: ReadonlySet<string> = new Set([
  "math",
  "package-install",
]);

/** A fence problem at a line of the parsed text, before it's placed in a file. */
interface Finding {
  code: string;
  line: number;
  message: string;
  suggestion: string;
}

/** A fence option another docs tool reads and Blume doesn't. */
interface ForeignOption {
  /** Matches the option's token in the fence's info string. */
  pattern: RegExp;
  /** The fence languages the option belongs to; any language when unset. */
  languages?: ReadonlySet<string>;
  /** What comes of the option, since Blume ignores it. */
  effect: string;
  /** The Blume spelling, given the option's quoted value. */
  instead: (value: string) => string;
}

/** `hl_lines="2 4-5"` → `{2,4-5}`: MkDocs separates lines with spaces. */
const lineRange = (value: string): string =>
  `{${value
    .trim()
    .split(/[\s,]+/u)
    .join(",")}}`;

const FOREIGN_OPTIONS: readonly ForeignOption[] = [
  {
    effect: "the block highlights no lines",
    instead: (value) =>
      `Put the lines in braces after the language instead: \`${lineRange(value)}\`.`,
    pattern: /^hl_lines=["'](?<value>[^"']*)["']$/u,
  },
  {
    effect: "the block shows no line numbers",
    instead: (value) =>
      `Write \`lineNumbers\` after the language instead.${
        value.trim() === "1" ? "" : " Blume numbers every block from 1."
      }`,
    pattern: /^linenums=["'](?<value>[^"']*)["']$/u,
  },
  {
    effect: "the block shows no line numbers",
    instead: () => "Write `lineNumbers` after the language instead.",
    pattern: /^showLineNumbers(?:\{\d*\})?$/u,
  },
  {
    // Mintlify's. Like `showLineNumbers` and `wordWrap`, it never joins the
    // title (see `markdown/fence-meta.ts`).
    effect: "the block shows no line numbers",
    instead: () =>
      'Write `lineNumbers` after the language instead. To keep the word in the block\'s title, set the title with `title="…"`.',
    pattern: /^lines$/u,
  },
  {
    effect: "the block doesn't wrap its long lines",
    instead: () => "Write `wrap` after the language instead.",
    pattern: /^wordWrap$/u,
  },
  {
    effect: "the block has no title",
    instead: (value) => `Write \`title="${value}"\` instead.`,
    pattern: /^filename=["'](?<value>[^"']*)["']$/u,
  },
  {
    // rustdoc's and mdBook's, on a Rust fence. They never join the title.
    effect:
      "it does nothing: Blume shows a code block as static text, and never compiles, tests, or runs it",
    instead: () => "Remove it.",
    languages: RUST_LANGUAGES,
    pattern: new RegExp(`^(?:${[...RUST_META_KEYWORDS].join("|")})$`, "u"),
  },
];

/** The option `token` is in a fence whose language is `lang`, if any. */
const foreignOption = (
  token: string,
  lang: string
): { option: ForeignOption; value: string } | null => {
  for (const option of FOREIGN_OPTIONS) {
    const match = option.pattern.exec(token);
    if (match && (option.languages?.has(lang) ?? true)) {
      return { option, value: match.groups?.value ?? "" };
    }
  }
  return null;
};

/** Whether a fence's language renders as the author meant: highlighted, or plain on purpose. */
const rendersLanguage = (lang: string): boolean =>
  isKnownLanguage(lang) || BLUME_LANGUAGES.has(lang);

/** A fence's language and option tokens, as the renderer reads them. */
const fenceParts = (
  lang: string | null | undefined,
  meta: string | null | undefined
) => {
  const fence = normalizeFence(lang, meta) ?? {
    lang: lang ?? "",
    meta: meta ?? null,
  };
  return { lang: fence.lang, meta: fence.meta, tokens: metaTokens(fence.meta) };
};

const unknownLanguage = (node: Code, line: number): Finding[] => {
  const { lang } = fenceParts(node.lang, node.meta);
  if (!lang || rendersLanguage(lang)) {
    return [];
  }
  return [
    {
      code: "BLUME_UNKNOWN_CODE_LANGUAGE",
      line,
      message: `\`${lang}\` isn't a language Blume can highlight, so the code block renders as plain text.`,
      suggestion:
        'Use a Shiki language id or alias (https://shiki.style/languages), or `text` for plain text. Options like a title go after the language, as in `text title="notes.txt"`.',
    },
  ];
};

const foreignOptions = (node: Code, line: number): Finding[] => {
  const { lang, tokens } = fenceParts(node.lang, node.meta);
  // A fence with options and no language reads its first option as the
  // language, so that token counts too.
  return [node.lang ?? "", ...tokens].flatMap((token) => {
    const found = foreignOption(token, lang);
    if (!found) {
      return [];
    }
    return [
      {
        code: "BLUME_CODE_FENCE_OPTION",
        line,
        message: `\`${token}\` isn't a Blume code block option, so ${found.option.effect}.`,
        suggestion: found.option.instead(found.value),
      },
    ];
  });
};

// A fence opener's info string: the text after a run of three or more
// backticks or tildes. Matched anywhere in a line, so it also sees fences in
// list items and quotes (and fence-like inline code, which the parse below
// sorts out).
const FENCE_INFO = /(?:`{3,}|~{3,})[\t ]*(?<info>[^`\n]*)/gu;

/** Whether a fence's info string holds anything these checks report. */
const suspectInfo = (info: string): boolean => {
  const [lang, ...rest] = info.trim().split(/\s+/u);
  if (!lang) {
    return false;
  }
  const parts = fenceParts(lang, rest.join(" ") || null);
  return (
    !rendersLanguage(parts.lang) ||
    [lang, ...parts.tokens].some(
      (token) => foreignOption(token, parts.lang) !== null
    )
  );
};

const parse = (text: string, format: "md" | "mdx"): Nodes | null => {
  try {
    return format === "mdx"
      ? mdxToMdast(text, { features: MDX_BODY_FEATURES })
      : markdownToMdast(text, { features: MARKDOWN_BODY_FEATURES });
  } catch {
    return null;
  }
};

/**
 * The fence problems in a page body, in source order. The body is parsed as
 * the renderer reads it, so a fence shown inside another code block never
 * counts. A page is parsed only when an info string looks like one of these
 * problems, so pages without one cost a scan. A body MDX can't parse fails to
 * render anyway, with its own error.
 */
const fenceFindings = (text: string, format: "md" | "mdx"): Finding[] => {
  const suspect = [...text.matchAll(FENCE_INFO)].some((match) =>
    suspectInfo(match.groups?.info ?? "")
  );
  const tree = suspect ? parse(text, format) : null;
  if (!tree) {
    return [];
  }
  const found: Finding[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === "code") {
      const line = node.position?.start.line ?? 1;
      found.push(...unknownLanguage(node, line), ...foreignOptions(node, line));
    }
    if ("children" in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  walk(tree);
  return found;
};

/**
 * Warn about code fences that don't render as their author meant:
 *
 * - `BLUME_UNKNOWN_CODE_LANGUAGE`: a language Shiki doesn't know, so the block
 *   renders as plain text. Shiki itself only logs a console line naming the
 *   language, with no page or line.
 * - `BLUME_CODE_FENCE_OPTION`: an option another docs tool reads, like MkDocs'
 *   `hl_lines="2 3"`, Docusaurus' `showLineNumbers`, Mintlify's `lines`, or
 *   rustdoc's `no_run`, which Blume ignores. None of them becomes part of the
 *   block's title. The suggestion gives the Blume spelling, or says to remove
 *   an option Blume has no use for.
 *
 * Lines point into the file the author wrote, a partial's own file for a
 * fence an `<include>` brought in.
 */
export const codeFenceDiagnostics = (
  entry: SourceEntry,
  sourceName: string
): Diagnostic[] => {
  const page = entry.sourcePath ?? `${sourceName}:${entry.ref}`;
  const offset =
    entry.bodyLineOffset ?? strippedLineOffset(entry.raw, entry.body.text);
  return fenceFindings(
    entry.expanded?.text ?? entry.body.text,
    entry.body.format
  ).map(({ line, ...finding }) => {
    const origin = entry.expanded?.origins[line - 1];
    return {
      ...finding,
      file: origin?.file ?? page,
      line: origin?.line ?? line + offset,
      severity: "warning",
    };
  });
};
