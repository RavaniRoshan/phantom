import type { ArgsDef } from "citty";

import { closestMatch } from "../core/closest-match.ts";
import type { Diagnostic } from "../core/types.ts";

/** A flag the command doesn't declare, with the declared one it most resembles. */
export interface UnknownFlag {
  /** The flag as typed, without any `=value`. */
  flag: string;
  /** The closest declared flag (`--isolated` for `--isolatd`), if one is close. */
  suggestion?: string;
}

/** What a declared option spelling means for the token that follows it. */
interface KnownFlag {
  /** Whether it's a boolean switch, which `--no-<name>` turns off. */
  boolean: boolean;
  /**
   * How the flags a command takes list it: `--kebab-name`, or `--no-<name>`
   * for a boolean that's on by default, since that's the form anyone types.
   */
  display: string;
  /** The canonical kebab-case name, which typos are matched against. */
  name: string;
  /** Whether it reads the next token as its value (`--port 4000`). */
  takesValue: boolean;
}

/** `budgetJs` → `budget-js`; a name already in kebab case is unchanged. */
const kebabCase = (name: string): string =>
  name.replaceAll(/(?<upper>[A-Z])/gu, (letter) => `-${letter.toLowerCase()}`);

/** `budget-js` → `budgetJs`; a name already in camel case is unchanged. */
const camelCase = (name: string): string =>
  name.replaceAll(/-(?<letter>[a-z])/gu, (match) =>
    match.slice(1).toUpperCase()
  );

const aliasesOf = (alias: string | string[] | undefined): string[] => {
  if (alias === undefined) {
    return [];
  }
  return Array.isArray(alias) ? alias : [alias];
};

/**
 * Every spelling citty accepts for each declared option — the name, its camel
 * and kebab forms, and its aliases — mapped to what that option is. Positional
 * arguments aren't flags and don't appear.
 */
const knownFlags = (argsDef: ArgsDef): Map<string, KnownFlag> => {
  const flags = new Map<string, KnownFlag>();
  for (const [name, def] of Object.entries(argsDef)) {
    if (def.type === "positional") {
      continue;
    }
    const kebab = kebabCase(name);
    const boolean = def.type === "boolean";
    const onByDefault = boolean && "default" in def && def.default === true;
    const flag = {
      boolean,
      display: onByDefault ? `--no-${kebab}` : `--${kebab}`,
      name: kebab,
      takesValue: def.type === "string" || def.type === "enum",
    };
    for (const spelling of [
      name,
      kebabCase(name),
      camelCase(name),
      ...aliasesOf("alias" in def ? def.alias : undefined),
    ]) {
      flags.set(spelling, flag);
    }
  }
  return flags;
};

/** A `--name`, `--no-name`, `--name=value`, or `-n` token, taken apart. */
interface FlagToken {
  /** Whether it carries its value inline (`--port=4000`). */
  hasValue: boolean;
  /** `--name` rather than `-n`. */
  long: boolean;
  /** The name as typed, without dashes or `=value`. */
  name: string;
  /** The negated flag's name, for a `--no-name` token. */
  negated: string | undefined;
}

const parseToken = (arg: string): FlagToken => {
  const long = arg.startsWith("--");
  const [name = ""] = arg.slice(long ? 2 : 1).split("=");
  return {
    hasValue: arg.includes("="),
    long,
    name,
    negated: long && name.startsWith("no-") ? name.slice(3) : undefined,
  };
};

/**
 * How many tokens after this one a declared flag consumes — one for a string
 * flag's separate value (`--port 4000`, read whatever it looks like, as
 * citty's parser does), none otherwise — or undefined when the token names no
 * declared flag. A negation never reads a value; grouped single-letter
 * booleans (`-ab`) are declared when every letter is.
 */
const declaredWidth = (
  token: FlagToken,
  flags: Map<string, KnownFlag>
): number | undefined => {
  const known =
    flags.get(token.name) ??
    (token.negated === undefined ? undefined : flags.get(token.negated));
  if (known) {
    return known.takesValue && !token.hasValue && token.negated === undefined
      ? 1
      : 0;
  }
  const grouped =
    !token.long &&
    token.name.length > 1 &&
    [...token.name].every((letter) => flags.get(letter)?.takesValue === false);
  return grouped ? 0 : undefined;
};

/**
 * An undeclared token as reported, with the declared flag it most resembles.
 * A mistyped negation keeps its `no-` in the suggestion (`--no-instal` →
 * `--no-install`), so the fix doesn't flip what was asked for; negating a flag
 * that takes a value means nothing, so those suggest the flag itself.
 */
const describeUnknown = (
  token: FlagToken,
  flags: Map<string, KnownFlag>
): UnknownFlag => {
  const unknown: UnknownFlag = {
    flag: `${token.long ? "--" : "-"}${token.name}`,
  };
  const names = [...new Set([...flags.values()].map((flag) => flag.name))];
  const match = closestMatch(token.negated ?? token.name, names);
  if (match) {
    const negate = token.negated !== undefined && flags.get(match)?.boolean;
    unknown.suggestion = negate ? `--no-${match}` : `--${match}`;
  }
  return unknown;
};

/**
 * The flags in `rawArgs` that the command's `args` don't declare. citty itself
 * accepts any flag and drops the ones it doesn't know, so a typo like
 * `--isolatd` would silently run a different command than the one intended.
 *
 * Mirrors what citty accepts: every spelling from {@link knownFlags}, a
 * `--no-<flag>` negation of any of them, `--flag=value`, a declared string
 * flag's separate value token, grouped single-letter boolean aliases, and
 * everything after a bare `--`. `accepted` names extra flags the command
 * handles itself (the removed `blume build --adapter`, which gets its own
 * migration message).
 */
export const unknownFlags = (
  rawArgs: readonly string[],
  argsDef: ArgsDef,
  accepted: readonly string[] = []
): UnknownFlag[] => {
  const flags = knownFlags(argsDef);
  const unknown: UnknownFlag[] = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index] ?? "";
    if (arg === "--") {
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      continue;
    }
    const token = parseToken(arg);
    const width = declaredWidth(token, flags);
    if (width !== undefined) {
      index += width;
    } else if (!accepted.includes(token.negated ?? token.name)) {
      unknown.push(describeUnknown(token, flags));
    }
  }
  return unknown;
};

/**
 * Flags a command reads from its raw arguments itself instead of declaring
 * them, keyed by command name. `blume build` answers the Blume 1 `--adapter`,
 * `--output`, and `--base` with the `deployment` setting that replaced each,
 * which says more than "unknown option" would.
 */
export const COMMAND_HANDLED_FLAGS = new Map([
  ["build", ["adapter", "output", "base"]],
]);

/**
 * The error for a command run with flags it doesn't declare: each unknown
 * flag (with its likely intended spelling), then every flag the command does
 * take, so the fix is on screen without a trip to `--help`.
 */
export const unknownFlagsDiagnostic = (
  command: string,
  unknown: readonly UnknownFlag[],
  argsDef: ArgsDef
): Diagnostic => {
  const listed = unknown
    .map(({ flag, suggestion }) =>
      suggestion ? `${flag} (did you mean ${suggestion}?)` : flag
    )
    .join(", ");
  const declared = [
    ...new Set([...knownFlags(argsDef).values()].map((flag) => flag.display)),
  ].toSorted();
  const takes =
    declared.length > 0
      ? `It takes ${declared.join(", ")}.`
      : "It takes no options.";
  return {
    code: "BLUME_UNKNOWN_OPTION",
    message: `blume ${command} doesn't know ${unknown.length === 1 ? "the option" : "the options"} ${listed}.`,
    severity: "error",
    suggestion: `${takes} Run \`blume ${command} --help\` for what each does.`,
  };
};
