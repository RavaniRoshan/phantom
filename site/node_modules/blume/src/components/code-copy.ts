/**
 * What a code block's copy button puts on the clipboard. Most blocks copy as
 * shown. A terminal session (` ```console `, ` ```shellsession `) shows
 * prompts and output around its commands, and pasting that into a terminal
 * runs the `$` and the output as commands, so it copies only the commands,
 * prompts stripped, one per line.
 */

/** Shiki's terminal-session language and its alias. */
const SESSION_LANGUAGES: ReadonlySet<string> = new Set([
  "console",
  "shellsession",
]);

/**
 * A command line: an optional prefix (`(venv)`, `user@host:~`,
 * `[user@host dir]`), a prompt character, a space, then the command. The
 * prefixes are the ones Shiki's session grammar reads, with a virtualenv's
 * `(venv)` allowed on its own as Pygments' does. Shiki's `>` and Greek
 * prompts are left out: a `>` line in a transcript is usually output (npm
 * prints its scripts that way) or a continuation, handled below.
 */
const PROMPT =
  /^(?:\(\S+\)\s*)?(?:(?:sh\S*?|\w\S+[:@]\S+(?:\s+\S+)?|\[\S+?[:@][^\n]+?\].*?)\s*)?[#$%❯➜]\s+(?<command>.*)$/u;

/** The `> ` a shell prints before each continuation of a `\`-ended line. */
const CONTINUATION_PROMPT = /^> /u;

/**
 * The commands of a terminal session, prompts stripped and output dropped. A
 * line after one ending in `\` continues its command. A session with no
 * prompt at all copies as written: it's commands alone.
 */
const sessionCommands = (text: string): string => {
  const commands: string[] = [];
  let continuing = false;
  for (const line of text.split("\n")) {
    const command: string | undefined = continuing
      ? line.replace(CONTINUATION_PROMPT, "")
      : PROMPT.exec(line)?.groups?.command;
    if (command) {
      commands.push(command);
    }
    continuing = command?.trimEnd().endsWith("\\") ?? false;
  }
  return commands.length > 0 ? commands.join("\n") : text;
};

/** The text to copy from a block of `language` that reads `text`. */
export const copyableCode = (text: string, language = ""): string =>
  SESSION_LANGUAGES.has(language.toLowerCase()) ? sessionCommands(text) : text;
