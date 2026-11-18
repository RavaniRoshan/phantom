import { defineCommand } from "citty";
import { join } from "pathe";

import { AGENTS, launchInstalledAgent } from "../../audit/agent.ts";
import type { AgentKind } from "../../audit/agent.ts";
import { packageRoot } from "../../core/package-root.ts";
import { getBlumeVersion } from "../../core/version.ts";
import {
  MIGRATE_SKILL_DIR,
  MIGRATE_SOURCES,
  MIGRATE_SOURCE_NAMES,
  detectMigrateSource,
  isMigrateSource,
  migratePrompt,
} from "../../migrate/migrate.ts";
import type { MigrateSourceId } from "../../migrate/migrate.ts";
import { commandMeta } from "../command-meta.ts";
import { reportInternalError } from "../internal-error.ts";
import { logger } from "../log.ts";

/**
 * `blume migrate [source]` — move a docs site from another framework to Blume
 * with a coding agent. Run it through the package runner (`npx blume migrate
 * fumadocs --claude`) in the site being migrated: it names the source (or
 * detects it), then opens Claude Code or Codex on the `blume-migrate` skill
 * bundled in this package, the way `blume audit --claude` hands off its
 * findings. The judgment stays in the skill; the command is the front door.
 * Status lines go straight to stderr: consola drops info-level lines in test
 * and CI environments.
 */
export const migrateCommand = defineCommand({
  args: {
    claude: {
      description: "Run the migration with Claude Code.",
      type: "boolean",
    },
    codex: {
      description: "Run the migration with Codex.",
      type: "boolean",
    },
    source: {
      description: `The framework to migrate from: ${MIGRATE_SOURCES.join(" | ")}. Detected when omitted.`,
      required: false,
      type: "positional",
    },
  },
  meta: commandMeta.migrate,
  async run({ args }) {
    const root = process.cwd();
    // SAFETY: AGENTS is a closed record keyed by AgentKind, so its keys are
    // exactly the agent kinds.
    const agents = (Object.keys(AGENTS) as AgentKind[]).filter(
      (kind) => args[kind]
    );
    if (agents.length > 1) {
      logger.error("Pass at most one of --codex or --claude.");
      process.exit(1);
    }
    const [agent] = agents;
    if (args.source && !isMigrateSource(args.source)) {
      logger.error(
        `Unknown source "${args.source}" (use ${MIGRATE_SOURCES.join(" | ")}). Leave it out to detect the framework, or to migrate from one not listed.`
      );
      process.exit(1);
    }

    try {
      const detected = await detectMigrateSource(root);
      const named: MigrateSourceId | null =
        args.source && isMigrateSource(args.source) ? args.source : null;
      const source = named ?? detected?.source ?? null;
      process.stderr.write(
        source
          ? `  Migrating from ${MIGRATE_SOURCE_NAMES[source]}${named ? "" : ` (detected from ${detected?.evidence})`}.\n`
          : "  Couldn't detect the docs framework; the agent will inventory the repo first.\n"
      );
      // A named source wins, but a repo that looks like another framework is
      // worth a second look before an agent rewrites it on the wrong mappings.
      if (named && detected && detected.source !== named) {
        process.stderr.write(
          `  Warning: this looks like a ${MIGRATE_SOURCE_NAMES[detected.source]} project (${detected.evidence}); migrating from ${MIGRATE_SOURCE_NAMES[named]} as named.\n`
        );
      }
      const skillDir = join(packageRoot(), MIGRATE_SKILL_DIR);

      // Without an agent flag the command is the pointer for any other agent:
      // the bundled skill's path (which lives in a throwaway cache under npx),
      // plus the install line that puts the skill where agents look for it.
      if (!agent) {
        process.stderr.write(
          `  blume migrate runs the migration with a coding agent: rerun with --codex or --claude.\n  Using another agent? Point it at ${join(skillDir, "SKILL.md")},\n  or install the skill where your agent looks for skills: npx skills add haydenbleasel/blume --skill blume-migrate\n`
        );
        return;
      }

      const cli = AGENTS[agent];
      process.stderr.write(`  Handing the migration to ${cli.name}…\n\n`);
      const code = await launchInstalledAgent(
        cli.bin,
        migratePrompt({
          detected,
          skillDir,
          source,
          version: getBlumeVersion(),
        })
      );
      if (code === null) {
        logger.error(
          `${cli.name} (\`${cli.bin}\`) was not found on PATH. Install it with \`${cli.install}\`.`
        );
        process.exit(1);
      }
      if (code !== 0) {
        process.exit(code);
      }
    } catch (error) {
      reportInternalError(error);
      process.exit(1);
    }
  },
});
