import { defineCommand } from "citty";
import { relative } from "pathe";

import { BlumeError } from "../../core/diagnostics.ts";
import { eject } from "../../registry/eject.ts";
import { commandMeta } from "../command-meta.ts";
import { refuseIfDevRunning } from "../dev-lock.ts";
import { isEjectedProject, updatePackageScripts } from "../eject-scripts.ts";
import { commandsFor, detectProjectPackageManager } from "../init/scaffold.ts";
import { logger, reportDiagnostics } from "../log.ts";

/**
 * Eject the project, reporting a config or `components.ts` error as the same
 * diagnostic other commands print (a Blume 1 config, say) instead of a stack.
 */
const ejectOrExit = async (
  root: string
): Promise<Awaited<ReturnType<typeof eject>>> => {
  try {
    return await eject(root);
  } catch (error) {
    if (error instanceof BlumeError) {
      reportDiagnostics([error.diagnostic], root);
      process.exit(1);
    }
    throw error;
  }
};

export const ejectCommand = defineCommand({
  args: {
    force: {
      description:
        "Eject again over an already-ejected app, overwriting astro.config.mjs and src/.",
      type: "boolean",
    },
    yes: { description: "Skip the confirmation prompt.", type: "boolean" },
  },
  meta: commandMeta.eject,
  async run({ args }) {
    const root = process.cwd();
    refuseIfDevRunning(root, "ejecting");

    // A second eject rewrites the app from blume.config.ts, discarding every
    // edit made to it since the first, so it takes an explicit --force.
    if (isEjectedProject(root) && !args.force) {
      logger.error(
        "This project is already ejected: ejecting again would overwrite astro.config.mjs and src/ with a fresh copy, discarding your edits to them. Pass --force to overwrite them anyway."
      );
      process.exit(1);
    }

    if (!args.yes) {
      logger.warn(
        "Eject is one-way: it writes astro.config.mjs, src/, and (if absent) tsconfig.json, rewrites your package.json scripts, adds the packages the Astro app imports to its dependencies, and removes .blume. An existing tsconfig.json is left untouched."
      );
      logger.info("Re-run with --yes to proceed.");
      return;
    }

    const { dependencies, files, warnings } = await ejectOrExit(root);
    const added = await updatePackageScripts(root, dependencies);

    // The same surface as the generated-runtime path (prepare.ts): one warn
    // per generation warning, e.g. a Scalar reference spec that wasn't found.
    for (const warning of warnings) {
      logger.warn(warning);
    }

    logger.success(`Ejected ${files.length} file(s):`);
    for (const file of files) {
      process.stdout.write(`  ${relative(root, file)}\n`);
    }
    // Print run commands matching the project's package manager (lockfile
    // detection, since eject runs inside an existing project).
    const pm = await detectProjectPackageManager(root);
    const { build, dev, install } = commandsFor(pm);
    // Newly added dependencies aren't installed yet, so install comes first.
    const run = added.length > 0 ? [install, dev, build] : [dev, build];
    const addedNote =
      added.length > 0 ? `Added to package.json: ${added.join(", ")}.\n\n` : "";
    logger.box(
      `Your project is now a standalone Astro app.\n\n${addedNote}${run.map((command) => `  ${command}`).join("\n")}\n\nThe blume package remains importable.`
    );
  },
});
