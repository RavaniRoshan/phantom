import type { ArgsDef, CommandDef, CommandMeta } from "citty";

import { BlumeError } from "../core/diagnostics.ts";
import { reportInternalError } from "./internal-error.ts";
import { reportDiagnostics } from "./log.ts";
import {
  COMMAND_HANDLED_FLAGS,
  unknownFlags,
  unknownFlagsDiagnostic,
} from "./unknown-flags.ts";

/**
 * Wrap a command so its module is imported only when citty needs its `args`
 * or runs it. `meta` stays static (from `command-meta.ts`), so rendering root
 * usage, matching an unknown name, and `blume <cmd> --help` for *another*
 * command never touch this one's dependency graph.
 *
 * `load` imports the command's module and `key` names its export, so the call
 * site stays a plain `() => import("./commands/x.ts")`.
 *
 * Only `args`, `setup`, `run`, and `cleanup` are forwarded: no Blume command
 * declares `default`, `plugins`, or nested `subCommands`.
 *
 * Two behaviors every command shares live here rather than in each command:
 * `setup` rejects flags the command doesn't declare (citty accepts and drops
 * them, so `blume build --isolatd` would run a real, non-isolated build), and
 * `run` reports a {@link BlumeError} a command lets escape — a config that
 * fails validation, say — as its diagnostic instead of citty's raw stack dump.
 */
export const lazyCommand = <Args extends ArgsDef, Key extends string>(
  meta: CommandMeta,
  load: () => Promise<Record<Key, CommandDef<Args>>>,
  key: Key
): CommandDef<Args> => {
  const command = async () => {
    const module = await load();
    return module[key];
  };
  const name = meta.name ?? key;
  return {
    args: async () => {
      const { args } = await command();
      // SAFETY: every Blume command passes `args` to `defineCommand` as a plain
      // object literal (the "command registry" test checks it); citty's
      // `Resolvable` widening is the only reason the type also admits a thunk
      // or a promise here.
      return args as Args;
    },
    cleanup: async (context) => {
      const loaded = await command();
      await loaded.cleanup?.(context);
    },
    meta,
    run: async (context) => {
      const loaded = await command();
      try {
        await loaded.run?.(context);
      } catch (error) {
        if (error instanceof BlumeError) {
          reportDiagnostics([error.diagnostic], process.cwd());
        } else {
          reportInternalError(error);
        }
        process.exit(1);
      }
    },
    setup: async (context) => {
      const loaded = await command();
      // SAFETY: as for `args` above, every command's `args` is a plain object.
      const argsDef = (loaded.args ?? {}) as ArgsDef;
      const unknown = unknownFlags(
        context.rawArgs,
        argsDef,
        COMMAND_HANDLED_FLAGS.get(name)
      );
      if (unknown.length > 0) {
        reportDiagnostics([unknownFlagsDiagnostic(name, unknown, argsDef)]);
        process.exit(1);
      }
      await loaded.setup?.(context);
    },
  };
};
