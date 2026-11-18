import { existsSync } from "node:fs";

import { dirname, join } from "pathe";

import { packageDirFrom } from "../astro/render-deps.ts";
import type { Diagnostic } from "../core/types.ts";

/** Whether `root` or one of its ancestors holds a Yarn Plug'n'Play manifest. */
const hasPnpManifest = (root: string): boolean => {
  let dir = root;
  while (true) {
    if (existsSync(join(dir, ".pnp.cjs")) || existsSync(join(dir, ".pnp.js"))) {
      return true;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
};

/**
 * The diagnostic for a project installed with Yarn Plug'n'Play, or null.
 *
 * Plug'n'Play installs no `node_modules`, and the Astro project Blume
 * generates in `.blume/` imports Astro and Blume's dependencies by name, which
 * only a `node_modules` tree resolves — so under PnP the build dies loading
 * `astro/config`, a failure that reads like a bug in Blume. Caught up front
 * instead: when the command runs under the PnP runtime (`process.versions.pnp`,
 * set by `yarn run`), or when a `.pnp.cjs` manifest sits in the project with no
 * `node_modules` copy of Blume beside it.
 */
export const yarnPnpDiagnostic = (
  root: string,
  pnpVersion: string | undefined = process.versions.pnp
): Diagnostic | null => {
  const underPnp =
    pnpVersion !== undefined ||
    (hasPnpManifest(root) && packageDirFrom("blume", root) === null);
  if (!underPnp) {
    return null;
  }
  return {
    code: "BLUME_YARN_PNP",
    message:
      "Yarn Plug'n'Play isn't supported: the Astro project Blume generates in `.blume/` resolves Astro and Blume's dependencies from a `node_modules` folder, which Plug'n'Play doesn't create.",
    severity: "error",
    suggestion:
      "Add `nodeLinker: node-modules` to `.yarnrc.yml`, run `yarn install`, then run this command again.",
  };
};
