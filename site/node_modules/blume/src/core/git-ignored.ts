import { execFileSync } from "node:child_process";

import { isAbsolute, relative } from "pathe";

import { gitEnv, gitRepositoryRoot, realPath } from "./last-modified.ts";

/**
 * The paths among `paths` that git ignores: a `.gitignore` rule matches them
 * and the index doesn't track them, so they never reach the repository.
 * Generated pages are the usual case, like a TypeDoc build written into a
 * gitignored folder under the content root. One `git check-ignore` reads
 * every path. Empty when git is unavailable or `root` isn't in a repository.
 */
export const gitIgnoredPaths = (root: string, paths: string[]): Set<string> => {
  const gitRoot = paths.length > 0 ? gitRepositoryRoot(root) : null;
  if (gitRoot === null) {
    return new Set();
  }
  // Git names paths by their real location (see `realPath`), and a path
  // outside the repository would fail the whole call, so only the paths
  // inside it are asked about, by their repository-relative spelling.
  const top = realPath(gitRoot);
  const byRepoPath = new Map<string, string>();
  for (const path of paths) {
    const rel = relative(top, realPath(path));
    if (!(rel.startsWith("..") || isAbsolute(rel))) {
      byRepoPath.set(rel, path);
    }
  }
  try {
    const output = execFileSync(
      // oxlint-disable-next-line sonarjs/no-os-command-from-path -- git is a required dev-tool dependency resolved from PATH
      "git",
      ["-C", top, "check-ignore", "-z", "--stdin"],
      {
        encoding: "utf-8",
        env: gitEnv(),
        input: [...byRepoPath.keys()].map((rel) => `${rel}\0`).join(""),
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["pipe", "pipe", "ignore"],
      }
    );
    return new Set(
      output.split("\0").flatMap((rel) => {
        const path = byRepoPath.get(rel);
        return path === undefined ? [] : [path];
      })
    );
  } catch {
    // `check-ignore` exits 1 when no path is ignored.
    return new Set();
  }
};
