import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import { join } from "pathe";

/** A `.gitignore` line, normalized for comparison (trailing slashes dropped). */
const gitignoreKey = (line: string): string => line.trim().replace(/\/+$/u, "");

/**
 * Ensure `.gitignore` ignores each of `entries`, appending any that are missing
 * (creating the file when absent). Trailing-slash differences (`dist` vs
 * `dist/`) count as already present. Returns the entries actually added.
 */
export const ensureGitignore = async (
  root: string,
  entries: string[]
): Promise<string[]> => {
  const path = join(root, ".gitignore");
  const existing = existsSync(path) ? await readFile(path, "utf-8") : "";
  const present = new Set(
    existing.split("\n").flatMap((line) => {
      const key = gitignoreKey(line);
      return key ? [key] : [];
    })
  );
  const added = entries.filter((entry) => !present.has(gitignoreKey(entry)));
  if (added.length === 0) {
    return [];
  }
  const gap = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${existing}${gap}${added.join("\n")}\n`, "utf-8");
  return added;
};
