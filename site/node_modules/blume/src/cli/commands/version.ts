import { defineCommand } from "citty";

import { loadConfig } from "../../core/config.ts";
import { BlumeError } from "../../core/diagnostics.ts";
import { CutError, cutVersion } from "../../core/version-cut.ts";
import type { CutResult } from "../../core/version-cut.ts";
import { commandMeta } from "../command-meta.ts";
import { reportInternalError } from "../internal-error.ts";
import { logger, reportDiagnostics } from "../log.ts";

/** `blume version` with no id: list the configured versions. */
const listVersions = async (root: string): Promise<void> => {
  const { config } = await loadConfig(root);
  if (!config.versions) {
    logger.info(
      "Versioning is not configured. Cut the first version with `blume version <id>` (e.g. `blume version v1.0`)."
    );
    return;
  }
  const { current, archived } = config.versions;
  process.stdout.write(
    `  ${current.label} (current)${current.badge ? ` — ${current.badge}` : ""}\n`
  );
  for (const version of archived) {
    process.stdout.write(`  ${version.label ?? version.id} — ${version.id}/\n`);
  }
};

/** Report what a cut did, including how its id reached the config (or didn't). */
const reportCut = (id: string, result: CutResult): void => {
  logger.success(`Snapshot ${result.dir} (${result.copied} file(s) copied)`);
  const totalRewrites = result.rewritten.reduce(
    (sum, entry) => sum + entry.count,
    0
  );
  if (totalRewrites > 0) {
    logger.info(
      `Rewrote root-absolute links in ${result.rewritten.length} page(s) (${totalRewrites} line(s)).`
    );
  }
  if (result.versionsAdded) {
    logger.success(
      `Turned on versioning in blume.config.ts with "${id}" archived; the live docs are labeled "Latest" in the switcher until you rename versions.current.label.`
    );
  } else if (result.configUpdated) {
    logger.success(`Added "${id}" to versions.archived in blume.config.ts`);
  } else if (result.configSnippet) {
    // A warning, not info: until it's pasted, the snapshot builds as ordinary
    // content — every page twice — and consola drops info lines under CI.
    logger.warn(
      `blume.config.ts couldn't be updated automatically, so "${id}" isn't registered yet and its pages build as ordinary content until it is. ${result.configSnippet}`
    );
  }
  logger.info(
    "Archived versions are frozen — future edits belong in the live tree. Restart `blume dev` to pick up the snapshot."
  );
};

export const versionCommand = defineCommand({
  args: {
    force: {
      description: "Overwrite an existing snapshot directory.",
      type: "boolean",
    },
    id: {
      description: 'Version id to cut (e.g. "v1.0").',
      required: false,
      type: "positional",
    },
  },
  meta: commandMeta.version,
  async run({ args }) {
    const root = process.cwd();
    try {
      if (args.id) {
        reportCut(
          args.id,
          await cutVersion(root, args.id, { force: args.force })
        );
      } else {
        await listVersions(root);
      }
    } catch (error) {
      if (error instanceof CutError) {
        logger.error(error.message);
        process.exit(1);
      }
      if (error instanceof BlumeError) {
        reportDiagnostics([error.diagnostic], root);
        process.exit(1);
      }
      reportInternalError(error);
      process.exit(1);
    }
  },
});
