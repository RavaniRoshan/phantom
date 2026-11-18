/**
 * Questions about a code block. A code block's Ask button opens the assistant
 * with the block attached (`blume:open-assistant` with `detail.code`); the
 * question goes out with the code folded in as a fenced block after the
 * reader's words, which is how the model sees it, and the conversation shows
 * the two apart again.
 */

/** A code block the reader asked about. */
export interface CodeAttachment {
  /** The fence language (`ts`), or empty when the block has none. */
  language: string;
  source: string;
  /** The block's title (`server.ts`), when it has one. */
  title?: string;
}

/** The most code one question carries, well inside the route's budget. */
export const MAX_ATTACHED_CODE = 6000;

/** A user message, split into the reader's words and any attached code. */
export interface SplitQuestion {
  code?: { language: string; source: string };
  text: string;
}

/** A fence longer than any backtick run in the code, so the code can't close it. */
const fenceFor = (source: string): string => {
  const longest = Math.max(
    2,
    ...[...source.matchAll(/`+/gu)].map(([run]) => run.length)
  );
  return "`".repeat(longest + 1);
};

/** The question as sent: the reader's words, then the code as a fenced block. */
export const withCode = (question: string, code: CodeAttachment): string => {
  const source =
    code.source.length > MAX_ATTACHED_CODE
      ? `${code.source.slice(0, MAX_ATTACHED_CODE)}\n…`
      : code.source.replace(/\n+$/u, "");
  const fence = fenceFor(source);
  return `${question}\n\n${fence}${code.language}\n${source}\n${fence}`;
};

const TRAILING_FENCE =
  /\n\n(?<fence>`{3,})(?<language>[^\n`]*)\n(?<source>[\s\S]*)\n\k<fence>$/u;

/** A user message split back into the words and the attached code. */
export const splitCode = (content: string): SplitQuestion => {
  const match = TRAILING_FENCE.exec(content);
  if (!match?.groups) {
    return { text: content };
  }
  return {
    code: {
      language: match.groups.language ?? "",
      source: match.groups.source ?? "",
    },
    text: content.slice(0, match.index),
  };
};
