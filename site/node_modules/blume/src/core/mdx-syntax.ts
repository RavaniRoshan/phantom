import { readFile } from "node:fs/promises";

import type { Nodes } from "mdast";
import { createMdxMdastHandle, dropHandle, mdxToMdast } from "satteri";

import { MDX_BODY_FEATURES } from "../markdown/features.ts";
import matter from "./frontmatter.ts";
import { expandIncludes, hasIncludeStatements } from "./includes.ts";
import type { LineOrigin } from "./includes.ts";
import { isExpression } from "./mdx-elements.ts";
import { strippedLineOffset } from "./sources/normalize.ts";
import type { SourceEntry } from "./sources/types.ts";
import type { Diagnostic } from "./types.ts";
import { substituteVariables } from "./variables.ts";
import type { ContentVariables } from "./variables.ts";

/**
 * MDX that doesn't parse, found before Astro compiles it. The parse is
 * Sätteri's, with the feature set the renderer uses, so a body that fails it
 * here fails `astro build` too: Astro compiles every `.mdx` file in the
 * collection, drafts and pages the scan dropped included. Parsing only (no
 * plugins, no render) keeps it cheap enough to run on every page.
 *
 * - `BLUME_MDX_SYNTAX` (error): the page's own text doesn't parse, so the
 *   build fails at it.
 * - `BLUME_MDX_SYNTAX` (warning): the page parses, but not once its
 *   `<include>`s are spliced in. Reported in the partial. The render splices a
 *   partial more leniently than this parse reads it, so the page may still
 *   build, with the partial's markup rendered wrong (an HTML comment shown as
 *   text, an unclosed `<img>` taking in what follows it).
 *
 * The same reading locates a build failure Astro reports with no line: an
 * `.mdx` page that throws while it renders (a `{…}` expression reading a name
 * nothing defines), or a partial that breaks the including page's compile.
 */

/** Where MDX stopped reading a text, and why. */
export interface MdxSyntaxError {
  column: number;
  line: number;
  /** Sätteri's message, without its leading position and trailing rule id. */
  reason: string;
}

// Sätteri's message: `line:column: reason (source:rule)`.
const POSITIONED =
  /^(?<line>\d+):(?<column>\d+): (?<reason>[\s\S]*?)(?: \([\w-]+:[\w-]+\))?$/u;
// A position inside the reason (`… for \`<img>\` (2:1)`).
const INNER_POSITION = / \((?<line>\d+):(?<column>\d+)\)/gu;

/**
 * The first MDX syntax error in `text`, a page body with its front matter
 * off, or null when it parses.
 *
 * Only the verdict is needed, so the parse stays native: Sätteri's tree is
 * dropped unread rather than built as JavaScript objects, which costs as much
 * again as the parse itself on every page. A parse error carries its own
 * position, so node positions aren't tracked either.
 */
export const mdxSyntaxError = (text: string): MdxSyntaxError | null => {
  try {
    dropHandle(createMdxMdastHandle(text, MDX_BODY_FEATURES, false));
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const groups = POSITIONED.exec(message)?.groups;
    return {
      column: Number(groups?.column ?? 1),
      line: Number(groups?.line ?? 1),
      reason: groups?.reason ?? message,
    };
  }
};

/** A position in the file the author wrote. */
interface Site {
  column?: number;
  file: string;
  line: number;
}

/** Maps a line and column of the parsed text to the file it came from. */
type SiteOf = (line: number, column?: number) => Site;

/**
 * Where each line of a parsed text came from: the expansion's origins when
 * `<include>`s were spliced, else the page's own file, shifted past its front
 * matter.
 */
const sitesIn =
  (file: string, lineOffset: number, origins?: readonly LineOrigin[]): SiteOf =>
  (line, column) => {
    const origin = origins?.[line - 1];
    return origin
      ? { column, file: origin.file, line: origin.line }
      : { column, file, line: line + lineOffset };
  };

/**
 * The reason with each position inside it moved to the file the diagnostic
 * names: a position from another file (a partial's opening tag, read from
 * the page) is dropped rather than shown as a line it isn't.
 */
const placedReason = (reason: string, at: Site, siteOf: SiteOf): string =>
  reason.replaceAll(INNER_POSITION, (written, line: string, column: string) => {
    const inner = siteOf(Number(line), Number(column));
    return inner.file === at.file ? ` (${inner.line}:${column})` : "";
  });

// What fixes the common failures, by what the reason says.
const EXPRESSION_REASON = /could not parse expression/iu;
const COMMENT_REASON = /to create a comment in MDX/u;
const LINK_REASON = /to create a link in MDX/u;

/** How to fix a syntax error, read from its reason. */
const syntaxSuggestion = (reason: string): string => {
  if (EXPRESSION_REASON.test(reason)) {
    return "In .mdx, `{` starts a JavaScript expression. To show a brace as text, escape it (`\\{`) or put the text in inline code.";
  }
  if (COMMENT_REASON.test(reason)) {
    return "Write the comment as `{/* … */}`.";
  }
  if (LINK_REASON.test(reason)) {
    return "Write the link as `[text](https://…)`.";
  }
  return "MDX reads HTML as JSX: close every element (`<br />`, `<img … />`) and match each closing tag. A page that needs no components can be a .md file instead.";
};

/**
 * The `BLUME_MDX_SYNTAX` diagnostic for `error`, read from a text whose lines
 * `siteOf` places.
 */
export const mdxSyntaxDiagnostic = (
  error: MdxSyntaxError,
  siteOf: SiteOf,
  options: { includedIn?: string; severity: Diagnostic["severity"] }
): Diagnostic => {
  const at = siteOf(error.line, error.column);
  const reason = placedReason(error.reason, at, siteOf);
  return {
    code: "BLUME_MDX_SYNTAX",
    column: at.column,
    file: at.file,
    line: at.line,
    message: options.includedIn
      ? `MDX can't parse this file once ${options.includedIn} includes it: ${reason}.`
      : `MDX can't parse this page: ${reason}.`,
    severity: options.severity,
    suggestion: syntaxSuggestion(reason),
  };
};

/** What the scan learned from parsing an `.mdx` entry. */
export interface MdxSyntaxCheck {
  diagnostics: Diagnostic[];
  /** Whether the page's own text fails to parse, so its build would fail. */
  unparsable: boolean;
}

/**
 * Parse an `.mdx` entry's body, and its include-expanded text when it has
 * one (see the module comment). The body is read as the build reads it: with
 * the site's variables substituted, which the scan has already done when
 * there was no expansion to do it in.
 */
export const mdxSyntaxCheck = (
  entry: SourceEntry,
  sourceName: string,
  variables?: ContentVariables
): MdxSyntaxCheck => {
  if (entry.body.format !== "mdx") {
    return { diagnostics: [], unparsable: false };
  }
  // Where the parsed text's lines sit in the files, worked out only for a
  // page that fails: counting the lines of its front matter means splitting
  // its whole file, which every page that parses would pay for.
  const siteOf = (origins?: readonly LineOrigin[]): SiteOf =>
    sitesIn(
      entry.sourcePath ?? `${sourceName}:${entry.ref}`,
      entry.bodyLineOffset ?? strippedLineOffset(entry.raw, entry.body.text),
      origins
    );
  const { expanded } = entry;
  const body = expanded
    ? substituteVariables(entry.body.text, variables)
    : entry.body.text;
  const own = mdxSyntaxError(body);
  if (own) {
    return {
      diagnostics: [mdxSyntaxDiagnostic(own, siteOf(), { severity: "error" })],
      unparsable: true,
    };
  }
  const spliced = expanded ? mdxSyntaxError(expanded.text) : null;
  if (!(expanded && spliced)) {
    return { diagnostics: [], unparsable: false };
  }
  return {
    diagnostics: [
      mdxSyntaxDiagnostic(spliced, siteOf(expanded.origins), {
        includedIn: entry.ref,
        severity: "warning",
      }),
    ],
    unparsable: false,
  };
};

/** A page as the build failure locator reads it. */
export interface FailedPage {
  /** The owning source's content root, which bounds its includes. */
  contentRoot?: string;
  /** How a message names the page: its path from the project root. */
  name: string;
  sourcePath: string;
  variables?: ContentVariables;
}

/** A page's text as the build compiled it, and where its lines came from. */
interface CompiledText {
  siteOf: SiteOf;
  text: string;
  /** The same text before variables were substituted, line for line. */
  written: string;
}

/**
 * Read a page the way the build compiled it: front matter off, includes
 * spliced, variables substituted.
 */
const compiledText = async (page: FailedPage): Promise<CompiledText> => {
  const raw = await readFile(page.sourcePath, "utf-8");
  const body = matter(raw).content;
  const offset = strippedLineOffset(raw, body);
  const expansion =
    page.contentRoot && hasIncludeStatements(body)
      ? await expandIncludes(body, {
          contentRoot: page.contentRoot,
          lineOffset: offset,
          sourcePath: page.sourcePath,
        })
      : null;
  const written = expansion?.text ?? body;
  return {
    siteOf: sitesIn(page.sourcePath, offset, expansion?.origins),
    text: substituteVariables(written, page.variables),
    written,
  };
};

/**
 * Whether an expression's source reads `name` as a variable: as a word of its
 * own, not a property (`user.name` reads `user`), though a spread
 * (`...rest`) reads what it spreads.
 */
const readsName = (expression: string, name: string): boolean =>
  new RegExp(
    String.raw`(?<![\w$.])${name.replaceAll("$", String.raw`\$`)}(?![\w$])`,
    "u"
  ).test(expression.replaceAll("...", "   "));

/** The expressions a node holds: its own, or its JSX attributes'. */
const expressionsOf = (node: Nodes): string[] => {
  if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
    return [node.value];
  }
  if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
    return node.attributes.flatMap((attribute) => {
      if (attribute.type === "mdxJsxExpressionAttribute") {
        return [attribute.value];
      }
      return isExpression(attribute.value) ? [attribute.value.value] : [];
    });
  }
  return [];
};

/** A `{…}` expression, and the node that holds it. */
interface FoundExpression {
  expression: string;
  /** The expression's own node, or the element whose attribute holds it. */
  node: Nodes;
}

/** The first `{…}` expression in `text` that reads `name`. */
const expressionReading = (
  text: string,
  name: string
): FoundExpression | null => {
  let tree: Nodes;
  try {
    tree = mdxToMdast(text, { features: MDX_BODY_FEATURES });
  } catch {
    return null;
  }
  const visit = (node: Nodes): FoundExpression | null => {
    const expression = expressionsOf(node).find((source) =>
      readsName(source, name)
    );
    if (expression !== undefined) {
      return { expression: `{${expression.trim()}}`, node };
    }
    if ("children" in node) {
      for (const child of node.children) {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };
  return visit(tree);
};

/** What a build failure in an `.mdx` page said about itself. */
export type MdxFailure =
  | { kind: "syntax" }
  | { kind: "undefined-name"; name: string };

/** Where a build failure happened in the files the author wrote. */
export interface MdxFailureSite extends Site {
  /** For a syntax failure, the parse's own diagnostic. */
  diagnostic?: Diagnostic;
  /** For an undefined name, the expression that reads it, braces included. */
  expression?: string;
}

/**
 * Locate a build failure Astro reported against an `.mdx` page with no line:
 * the expression that reads an undefined name, or the syntax error that
 * stopped the compile (which, when the page's own text parsed, sits in a
 * partial it includes). Null when the page can't be read or the cause can't
 * be found in it.
 */
export const locateMdxFailure = async (
  page: FailedPage,
  failure: MdxFailure
): Promise<MdxFailureSite | null> => {
  let compiled: CompiledText;
  try {
    compiled = await compiledText(page);
  } catch {
    return null;
  }
  const { siteOf, text, written } = compiled;
  if (failure.kind === "undefined-name") {
    const found = expressionReading(text, failure.name);
    const start = found?.node.position?.start;
    if (!(found && start)) {
      return null;
    }
    // A substituted variable earlier on the line moves the column, so it's
    // read from the line as written when the expression is there.
    const at =
      written.split("\n")[start.line - 1]?.indexOf(found.expression) ?? -1;
    return {
      ...siteOf(start.line, at === -1 ? start.column : at + 1),
      expression: found.expression,
    };
  }
  const error = mdxSyntaxError(text);
  if (!error) {
    return null;
  }
  const diagnostic = mdxSyntaxDiagnostic(error, siteOf, {
    includedIn:
      siteOf(error.line).file === page.sourcePath ? undefined : page.name,
    severity: "error",
  });
  return {
    column: diagnostic.column,
    diagnostic,
    file: diagnostic.file ?? page.sourcePath,
    line: diagnostic.line ?? 1,
  };
};
