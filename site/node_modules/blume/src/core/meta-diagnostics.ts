import { readFile } from "node:fs/promises";

import { closestMatch } from "./closest-match.ts";
import { locatePath } from "./diagnostics.ts";
import type { DiscoveredFolderMeta, UnreadFolderMeta } from "./meta.ts";
import { folderChildKeys, pageKey } from "./navigation.ts";
import type { Diagnostic, PageRecord } from "./types.ts";

/**
 * Folder-meta diagnostics that need the project's pages: a `pages` entry that
 * names no child of its folder, and a `meta.ts` Blume found but doesn't read
 * although its folder is a sidebar group. Both would otherwise do nothing
 * without a word.
 */

/**
 * The group path a folder-meta key configures: the key without the version
 * and locale directories `discoverFolderMeta` hoists in front of it, since
 * pages' nav paths carry neither.
 */
const groupPathOf = (
  key: string,
  versionDirs: ReadonlySet<string>,
  localeDirs: ReadonlySet<string>
): string => {
  const parts = key.split("/");
  if (versionDirs.has(parts[0] ?? "")) {
    parts.shift();
  }
  if (localeDirs.has(parts[0] ?? "")) {
    parts.shift();
  }
  return parts.join("/");
};

/**
 * The child a mistyped entry most likely means: the entry spelled as a file
 * name (`01-quickstart.mdx` for `quickstart`), or a near miss.
 */
const likelyChild = (
  entry: string,
  children: ReadonlySet<string>
): string | undefined => {
  const key = pageKey(entry);
  return key !== entry && children.has(key)
    ? key
    : closestMatch(entry, [...children]);
};

const SLUG_HINT =
  "List each child by its slug: the file or folder name without its extension, numeric prefix, or parentheses.";

/** Warn about each `pages` entry that names no child of the meta's folder. */
const unknownPageDiagnostics = async (
  file: string,
  pages: readonly string[],
  group: string,
  children: ReadonlySet<string>
): Promise<Diagnostic[]> => {
  const unknown = pages.flatMap((entry, index) =>
    children.has(entry) ? [] : [{ entry, index }]
  );
  if (unknown.length === 0) {
    return [];
  }
  const source = await readFile(file, "utf-8");
  const where = group ? `"${group}"` : "the content root";
  return unknown.map(({ entry, index }) => {
    const position = locatePath(source, ["pages", index]);
    const match = likelyChild(entry, children);
    return {
      code: "BLUME_META_UNKNOWN_PAGE",
      column: position?.column,
      file,
      line: position?.line,
      message: `pages lists "${entry}", but no page or folder in ${where} has that slug, so the entry orders nothing.`,
      severity: "warning",
      suggestion: match ? `Did you mean "${match}"? ${SLUG_HINT}` : SLUG_HINT,
    } satisfies Diagnostic;
  });
};

/** Warn about a meta file outside every `include` glob whose folder has pages. */
const unreadDiagnostic = (
  { dir, file }: UnreadFolderMeta,
  group: string
): Diagnostic => ({
  code: "BLUME_META_OUTSIDE_INCLUDE",
  file,
  message: `This meta file is in the "${group}" sidebar group's folder, but no include glob of its content source reaches that folder, so Blume doesn't read it.`,
  severity: "warning",
  suggestion: `Add an include glob that reaches the folder, such as "${dir}/**/*.{md,mdx}".`,
});

/** Folder-meta diagnostics against every page the sources produced. */
export const folderMetaDiagnostics = async (
  discovered: DiscoveredFolderMeta,
  pages: readonly PageRecord[],
  options: {
    localeDirs?: readonly string[];
    versionDirs?: readonly string[];
  } = {}
): Promise<Diagnostic[]> => {
  const children = folderChildKeys(pages.map((page) => page.navPath));
  const versionDirs = new Set(options.versionDirs);
  const localeDirs = new Set(options.localeDirs);
  const groupOf = (key: string): string =>
    groupPathOf(key, versionDirs, localeDirs);

  const listed = await Promise.all(
    [...discovered.meta, ...discovered.shared].flatMap(([key, meta]) => {
      const file = discovered.files.get(meta);
      const group = groupOf(key);
      return file && meta.pages
        ? [
            unknownPageDiagnostics(
              file,
              meta.pages,
              group,
              children.get(group) ?? new Set()
            ),
          ]
        : [];
    })
  );
  // A meta file outside the include globs is only worth a word when its
  // folder is a sidebar group some page lives in, like a reference's tag
  // folder; elsewhere it's likely application code that shares the name.
  const unread = discovered.unread.flatMap((entry) => {
    const group = groupOf(entry.key);
    return children.has(group) ? [unreadDiagnostic(entry, group)] : [];
  });
  return [...listed.flat(), ...unread];
};
