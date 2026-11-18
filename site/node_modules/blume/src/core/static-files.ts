import { statSync } from "node:fs";

import { join } from "pathe";

/**
 * Whether a root-relative path names a file the site serves outside its pages,
 * as a static host answers it: a file in `public/`, a `public/` folder's
 * `index.html` (`/demo` and `/demo/` for `public/demo/index.html`), or one of
 * the files Blume generates (`generated`, base-less paths like `/llms.txt`;
 * see `deploy/generated-files.ts`). `publicDir` is `null` when the project has
 * no `public/` folder, which ships no files then. Paths come decoded, without
 * `deployment.base`, which a host mounts `public/` under.
 */
export const staticFileResolver = (
  publicDir: string | null,
  generated: Iterable<string> = []
): ((path: string) => boolean) => {
  const files = new Set(generated);
  return (path) => {
    const folder = path.endsWith("/");
    const trimmed = folder ? path.slice(0, -1) : path;
    if (files.has(trimmed)) {
      return true;
    }
    if (publicDir === null) {
      return false;
    }
    const target = join(publicDir, trimmed);
    const stat = statSync(target, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      return (
        statSync(join(target, "index.html"), {
          throwIfNoEntry: false,
        })?.isFile() === true
      );
    }
    // A host answers `/spec.pdf/` with a 404: only a folder takes the slash.
    return !folder && stat?.isFile() === true;
  };
};
