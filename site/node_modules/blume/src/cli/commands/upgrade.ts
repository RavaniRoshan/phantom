import { defineCommand } from "citty";
import { join } from "pathe";

import { AGENTS, launchInstalledAgent } from "../../audit/agent.ts";
import type { AgentKind } from "../../audit/agent.ts";
import { formatDiagnostic } from "../../core/diagnostics.ts";
import { packageRoot } from "../../core/package-root.ts";
import { getBlumeVersion } from "../../core/version.ts";
import {
  UPGRADE_GUIDE_FILE,
  UPGRADE_GUIDE_URL,
  bumpBlumeDependency,
  collectUpgradeFindings,
  isOutsideBlumeProject,
  manualBumpAdvice,
  upgradePrompt,
} from "../../upgrade/upgrade.ts";
import { commandMeta } from "../command-meta.ts";
import { installDependencies } from "../init/install.ts";
import { commandsFor, detectProjectPackageManager } from "../init/scaffold.ts";
import { reportInternalError } from "../internal-error.ts";
import { logger } from "../log.ts";

/**
 * `blume upgrade` — move a project to this version of Blume. Run it through the
 * package runner (`npx blume@latest upgrade`), since a project on the previous
 * major doesn't have the command yet: it bumps `blume` in `package.json`,
 * installs, then checks the config, `components.ts`, and each page's front
 * matter against this version and lists what's left, or hands the list to
 * Claude Code or Codex the way
 * `blume audit --claude` does. Status lines go straight to stderr, like the
 * audit's: consola drops info-level lines in test and CI environments.
 */
export const upgradeCommand = defineCommand({
  args: {
    claude: {
      description: "Hand the remaining changes to Claude Code.",
      type: "boolean",
    },
    codex: {
      description: "Hand the remaining changes to Codex.",
      type: "boolean",
    },
    install: {
      default: true,
      description: "Install dependencies after bumping blume.",
      negativeDescription: "Bump package.json without installing.",
      type: "boolean",
    },
  },
  meta: commandMeta.upgrade,
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
    const version = getBlumeVersion();

    try {
      const bump = await bumpBlumeDependency(root, version);
      // With neither a config nor a `blume` dependency there is nothing to
      // check: the defaults would always pass and report the folder ready.
      if (isOutsideBlumeProject(root, bump)) {
        logger.error(
          "No blume.config.ts or `blume` dependency here. Run `blume upgrade` from the folder with blume.config.ts — in a monorepo, the package that depends on blume."
        );
        process.exit(1);
      }
      const pm = await detectProjectPackageManager(root);
      // A local install puts no `blume` on PATH, so every command this
      // prints (or hands the agent) runs through the project's runner.
      const runner = commandsFor(pm).exec;
      if (bump.status === "bumped") {
        process.stderr.write(
          `  Bumped blume ${bump.from} → ${bump.to} in package.json.\n`
        );
        if (args.install) {
          const outcome = await installDependencies(root, pm, {
            quiet: false,
          });
          if (outcome.failure) {
            logger.warn(
              `Installing failed; run \`${outcome.command}\` yourself.\n${outcome.failure}`
            );
          }
        }
      } else if (bump.status === "missing") {
        logger.warn(
          `No \`blume\` dependency in ./package.json; add blume@^${version} to the package that uses it.`
        );
      } else if (bump.status === "manual") {
        logger.warn(manualBumpAdvice(bump.range, version));
      }

      const findings = await collectUpgradeFindings(root);
      if (findings.length === 0) {
        // Until the range the bump couldn't rewrite moves, the project still
        // installs the old Blume, so it isn't ready yet.
        if (bump.status === "manual") {
          process.stderr.write(
            `  The config, components.ts, and pages check out for Blume ${version}. Update blume's version as above, reinstall, then run \`${runner} blume build\` to confirm.\n`
          );
          process.exit(1);
        }
        process.stderr.write(
          `  Ready for Blume ${version}: the config, components.ts, and pages check out. Run \`${runner} blume build\` to confirm.\n`
        );
        return;
      }
      process.stderr.write(
        `\n${findings.map((finding) => formatDiagnostic(finding, root)).join("\n\n")}\n\n`
      );

      if (!agent) {
        process.stderr.write(
          `  Each change is covered in the upgrade guide: ${UPGRADE_GUIDE_URL}\n  Rerun with --codex or --claude to hand them to a coding agent.\n`
        );
        process.exit(1);
      }

      const cli = AGENTS[agent];
      process.stderr.write(`  Handing the upgrade to ${cli.name}…\n\n`);
      const prompt = upgradePrompt({
        findings,
        guidePath: join(packageRoot(), UPGRADE_GUIDE_FILE),
        root,
        runner,
        version,
      });
      const code = await launchInstalledAgent(cli.bin, prompt);
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
