import { spawn } from "node:child_process";
import { once } from "node:events";

import { commandsFor } from "./scaffold.ts";
import type { PackageManager } from "./scaffold.ts";

/** How `installDependencies` ended, plus the command to print on failure. */
export interface InstallOutcome {
  /** The install command that ran (`bun install`, `npm install`, …). */
  command: string;
  /**
   * Why the install failed: the package manager's exit code with whatever it
   * printed, or the spawn error when the binary isn't on PATH. Absent on
   * success.
   */
  failure?: string;
}

export interface InstallOptions {
  /**
   * Capture the package manager's output instead of streaming it to the
   * terminal. Interactive runs capture it behind a spinner and show it only
   * on failure; non-interactive runs stream it as-is.
   */
  quiet: boolean;
}

/**
 * Run the package manager's install in a freshly scaffolded project so
 * `blume dev` works as soon as `init` returns. Never throws: a missing binary
 * or a non-zero exit resolves with a `failure`, so the caller can keep the
 * scaffolded files and print the exact command to retry by hand.
 */
export const installDependencies = async (
  root: string,
  pm: PackageManager,
  { quiet }: InstallOptions
): Promise<InstallOutcome> => {
  const command = commandsFor(pm).install;
  const child = spawn(pm, ["install"], {
    cwd: root,
    env: process.env,
    // npm, pnpm and yarn are `.cmd` shims on Windows, which Node only runs
    // through a shell; bun is a real executable everywhere.
    shell: process.platform === "win32",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
  try {
    // `once` rejects when the child emits `error` (e.g. ENOENT) before `close`.
    // SAFETY: `close` is emitted with `(code, signal)`, so the first element
    // is the exit code, or null when a signal ended the process.
    const [code] = (await once(child, "close")) as [number | null];
    if (code === 0) {
      return { command };
    }
    const output = Buffer.concat(chunks).toString("utf-8").trim();
    return {
      command,
      failure: [`${command} exited with code ${code}`, output]
        .filter(Boolean)
        .join("\n"),
    };
  } catch (error) {
    // SAFETY: a spawn failure is an ErrnoException; only its message is shown.
    return { command, failure: (error as Error).message };
  }
};
