import { existsSync } from "node:fs";

import { dirname, join } from "pathe";

/**
 * Walk up from `start` until a directory containing a `package.json` is found.
 *
 * Exported for testing; call sites should use {@link packageRoot}.
 */
export const findPackageRoot = (start: string): string => {
  let dir = start;
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("blume: unable to locate the package root");
    }
    dir = parent;
  }
  return dir;
};

let cached: string | undefined;

/**
 * Absolute path to the installed Blume package root (the directory holding its
 * `package.json`), found by walking up from this module.
 *
 * Anchoring here — rather than at a fixed offset from `import.meta` — keeps the
 * package's own `src/`, assets, and `node_modules` locatable whether the code
 * runs from source under Bun (`src/...`) or from the published, bundled CLI
 * (`dist/cli/*.js`). The two layouts sit at different depths, so a relative
 * `../..` resolves to different places; locating `package.json` does not.
 */
export const packageRoot = (): string => {
  cached ??= findPackageRoot(import.meta.dirname);
  return cached;
};
