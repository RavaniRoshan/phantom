import { nextFenceState } from "./code-fences.ts";
import type { FenceState } from "./code-fences.ts";

/**
 * Content variables: `variables: { version: "2.1.0" }` in `blume.config.ts`
 * makes `{{version}}` in a page read `2.1.0` wherever it appears in the body,
 * code and links included. The syntax is Mintlify's, so migrated pages keep
 * working.
 *
 * Substitution is textual, before any parsing, so a page's HTML, its search
 * entry, its `.md` mirror, and `llms-full.txt` all agree: the MDX pipeline
 * substitutes in a Vite transform ahead of the compiler (an MDX parser would
 * read `{{version}}` as a JavaScript expression), the Markdown pipeline in a
 * plugin over the parsed text, includes as their files are read, and the raw
 * readers through {@link substituteVariables}. Only defined names are
 * replaced; an undefined one in prose is a build error
 * (`BLUME_UNDEFINED_VARIABLE`), and inside code it is left alone, since
 * templating examples (`{{name}}` in a Handlebars snippet) are common there.
 */

/** The variables a site defines, name to value. */
export type ContentVariables = Readonly<Record<string, string>>;

/** A variable name: letters, digits, `_`, and `-` (Mintlify's `api-url`). */
export const VARIABLE_NAME = /^[\w-]+$/u;

/** A `{{name}}` reference, spaces inside the braces allowed. */
const REFERENCE = /\{\{\s*(?<name>[\w-]+)\s*\}\}/gu;

/** Whether a site defines any variables, so the rest can be skipped. */
export const hasVariables = (
  variables?: ContentVariables
): variables is ContentVariables =>
  variables !== undefined && Object.keys(variables).length > 0;

/** `text` with every reference to a defined variable replaced by its value. */
export const substituteVariables = (
  text: string,
  variables?: ContentVariables
): string => {
  if (!(hasVariables(variables) && text.includes("{{"))) {
    return text;
  }
  return text.replaceAll(REFERENCE, (match, name: string) =>
    Object.hasOwn(variables, name) ? (variables[name] ?? match) : match
  );
};

// A leading front matter block: variables apply to the body, not to it.
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u;

/**
 * {@link substituteVariables} over a page's raw source, leaving its front
 * matter as written: the rendered page reads its title and description from
 * the unsubstituted front matter, so the other surfaces must too.
 */
export const substituteVariablesInBody = (
  source: string,
  variables?: ContentVariables
): string => {
  const head = FRONT_MATTER.exec(source)?.[0] ?? "";
  return head + substituteVariables(source.slice(head.length), variables);
};

/** An undefined variable referenced in prose, with its 1-based line. */
export interface UndefinedVariable {
  line: number;
  name: string;
}

// A backtick code span: the same run of backticks opens and closes it.
const CODE_SPAN = /(?<ticks>`+)[^`][\s\S]*?\k<ticks>/gu;

/**
 * The undefined variables `text` references outside code: fenced blocks and
 * inline code spans are skipped, so a templating example never fails a
 * build. Empty when the site defines no variables at all, so a page that
 * shows `{{…}}` literally keeps working until the site opts in.
 */
export const undefinedVariables = (
  text: string,
  variables?: ContentVariables
): UndefinedVariable[] => {
  if (!(hasVariables(variables) && text.includes("{{"))) {
    return [];
  }
  const found: UndefinedVariable[] = [];
  let fence: FenceState = null;
  for (const [index, line] of text.split("\n").entries()) {
    const wasInFence = fence !== null;
    fence = nextFenceState(line, fence);
    if (wasInFence || fence !== null) {
      continue;
    }
    for (const match of line.replaceAll(CODE_SPAN, "").matchAll(REFERENCE)) {
      const name = match.groups?.name ?? "";
      if (!Object.hasOwn(variables, name)) {
        found.push({ line: index + 1, name });
      }
    }
  }
  return found;
};
