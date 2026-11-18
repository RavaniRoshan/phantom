import { basename, dirname, relative } from "pathe";
import { glob, isDynamicPattern } from "tinyglobby";

import { diagnosticsFromZod } from "./diagnostics.ts";
import { createModuleLoader } from "./load-module.ts";
import { folderMetaSchema } from "./schema.ts";
import type { FolderMeta } from "./schema.ts";
import { trimChar } from "./trim.ts";
import type { Diagnostic } from "./types.ts";

const META_FILES = [
  "**/meta.ts",
  "**/meta.js",
  "**/meta.mjs",
  // Shared, locale-agnostic folder meta (applies to every locale).
  "**/meta.$.ts",
  "**/meta.$.js",
  "**/meta.$.mjs",
];

/**
 * A meta module's default export before validation: `folderMetaSchema` parses
 * it only after any factory is resolved, so it carries the loader's raw type.
 */
type MetaModuleExport = Awaited<
  ReturnType<ReturnType<typeof createModuleLoader>>
>;

/** A factory-style meta module default-exports a function returning the meta. */
const isMetaFactory = (
  mod: MetaModuleExport
): mod is () => MetaModuleExport | Promise<MetaModuleExport> =>
  typeof mod === "function";

/** Resolve a meta module's default export, calling it if it is a factory. */
const resolveMeta = async (mod: MetaModuleExport) =>
  isMetaFactory(mod) ? await mod() : mod;

/** A filesystem content source to scan for folder meta: its on-disk root and
 * optional route prefix. The prefix is folded into every key so meta lines up
 * with the sidebar group path, which carries the same prefix. `include` and
 * `exclude` are the source's content globs, which scope the scan to the
 * folders the source reads. */
export interface FolderMetaSource {
  root: string;
  prefix?: string;
  include?: readonly string[];
  exclude?: readonly string[];
}

/**
 * The literal directory a glob starts from (`docs/**\/*.md` → `docs`, `""`
 * when it matches from the root): its leading segments up to the first one
 * with glob syntax, the file-name segment excluded.
 */
const globBase = (pattern: string): string => {
  const literal: string[] = [];
  for (const segment of pattern.split("/").slice(0, -1)) {
    if (isDynamicPattern(segment)) {
      break;
    }
    if (segment !== "" && segment !== ".") {
      literal.push(segment);
    }
  }
  return literal.join("/");
};

/** Whether `dir` is `base`, or nested beneath or above it (`""` is the root). */
const onPathOf = (dir: string, base: string): boolean =>
  dir === base ||
  base === "" ||
  dir === "" ||
  dir.startsWith(`${base}/`) ||
  base.startsWith(`${dir}/`);

/**
 * Whether a meta file's directory can configure a sidebar group of the
 * source: it lies on the path of some `include` glob's base — the folders
 * that glob reads, or the ancestors whose groups hold them. Negated globs
 * only narrow what a source reads, so they never qualify a folder.
 */
const withinInclude = (
  dir: string,
  include: readonly string[] | undefined
): boolean =>
  include === undefined ||
  include.some(
    (pattern) => !pattern.startsWith("!") && onPathOf(dir, globBase(pattern))
  );

/**
 * Every folder-meta file under a filesystem source's root: `patterns` (every
 * meta module name, shared `meta.$.*` included, by default), minus the
 * source's `exclude` globs, dependencies, and build output — whether or not
 * its `include` globs reach the file's folder.
 */
const globFolderMetaFiles = (
  source: FolderMetaSource,
  patterns: readonly string[]
): Promise<string[]> =>
  glob([...patterns], {
    absolute: true,
    cwd: source.root,
    // Never descend into dependencies or build output — relevant when the
    // root is the project root (e.g. a `.`-rooted or all-staged project).
    // The source's own `exclude` applies too: a `meta.ts` under an excluded
    // folder (`src/lib/meta.ts` beside `exclude: ["src/**"]`) is application
    // code, not folder meta, and importing it would fail.
    ignore: [
      ...(source.exclude ?? []),
      "**/node_modules/**",
      "**/.blume/**",
      "**/dist/**",
    ],
    onlyFiles: true,
  });

/** Whether the source's `include` globs reach a meta file's folder. */
const isReadMetaFile = (source: FolderMetaSource, file: string): boolean =>
  withinInclude(relative(source.root, dirname(file)), source.include);

/**
 * The folder-meta files a filesystem source contributes: `patterns` (every
 * meta module name, shared `meta.$.*` included, by default) under the source's
 * root, minus its `exclude` globs, dependencies, and build output, and only in
 * folders its `include` globs reach. `blume translate` finds the meta files it
 * translates through this too, so it covers exactly the ones the scan reads.
 */
export const findFolderMetaFiles = async (
  source: FolderMetaSource,
  patterns: readonly string[] = META_FILES
): Promise<string[]> => {
  const found = await globFolderMetaFiles(source, patterns);
  return found.filter((file) => isReadMetaFile(source, file));
};

/**
 * The folder-meta key for a directory. Mirrors the sidebar group path: the
 * source's route prefix (`docs`) followed by the directory relative to the
 * source root (`provider`) — so `docs/provider/meta.ts` under a `prefix: "docs"`
 * source keys to `docs/provider`, exactly the group path navigation builds.
 */
const metaKeyFor = (prefix: string | undefined, dir: string): string => {
  const clean = prefix ? trimChar(prefix, "/") : "";
  if (!clean) {
    return dir;
  }
  return dir ? `${clean}/${dir}` : clean;
};

/** Folder meta by key: per-locale `meta.*` files, and shared `meta.$.*` ones. */
export interface FolderMetaMaps {
  meta: Map<string, FolderMeta>;
  shared: Map<string, FolderMeta>;
}

/** A folder-meta file Blume found but doesn't read, and the key it would have. */
export interface UnreadFolderMeta {
  /** Its folder, relative to the source root. */
  dir: string;
  file: string;
  key: string;
}

/** What {@link discoverFolderMeta} found across the sources. */
export interface DiscoveredFolderMeta extends FolderMetaMaps {
  diagnostics: Diagnostic[];
  /** The file each meta in `meta` and `shared` was read from. */
  files: Map<FolderMeta, string>;
  /** Meta files under a source root that no source's `include` globs reach. */
  unread: UnreadFolderMeta[];
}

/**
 * Discover `meta.{ts,js,mjs}` files across the given filesystem sources. Keys are
 * the source's route prefix joined with the directory relative to that source's
 * root (`""`/the prefix itself for a source's root directory), so meta matches
 * the prefixed sidebar group path. A bare string is shorthand for a single,
 * unprefixed source (the default project layout). `meta.$.*` files are returned
 * in `shared` — folder meta that applies to that directory in every locale (a
 * locale-specific `meta.*` overrides it). Each file default-exports an object or
 * a (sync/async) function returning one.
 *
 * `localeDirs` names the top-level locale directories of a `dir`-parser i18n
 * project. Navigation looks locale meta up as `locale/<group path>` where the
 * group path starts with the source prefix, so a locale directory found at a
 * source root is hoisted in front of the prefix (`docs/fr/guides/meta.ts` keys
 * to `fr/docs/guides`, not `docs/fr/guides`).
 *
 * `versionDirs` names the archived-version snapshot directories, which sit
 * outermost on disk — a locale directory inside a snapshot is one level deeper.
 * Both are hoisted, version first (`v1.0/fr/guides/meta.ts` keys to
 * `v1.0/fr/<prefix>/guides`), matching navigation's version-aware meta prefix.
 */
export const discoverFolderMeta = async (
  sources: string | FolderMetaSource[],
  options: {
    localeDirs?: readonly string[];
    versionDirs?: readonly string[];
  } = {}
): Promise<DiscoveredFolderMeta> => {
  const list: FolderMetaSource[] = Array.isArray(sources)
    ? sources
    : [{ root: sources }];
  // Locale folders match case-insensitively, like content does (`pt-br/` for
  // a configured `pt-BR`), and key under the configured casing, which is what
  // navigation looks meta up by.
  const localeDirs = new Map(
    (options.localeDirs ?? []).map((code) => [code.toLowerCase(), code])
  );
  const versionDirs = new Set(options.versionDirs);

  const load = createModuleLoader();
  const meta = new Map<string, FolderMeta>();
  const shared = new Map<string, FolderMeta>();
  const files = new Map<FolderMeta, string>();
  const unread: UnreadFolderMeta[] = [];
  const diagnostics: Diagnostic[] = [];

  // A version snapshot dir is outermost, with a locale dir one level deeper;
  // both are hoisted in front of the (prefixed) group path, in that order —
  // the lookup key reads `version/locale/prefix/dir`.
  const keyOf = (source: FolderMetaSource, file: string): string => {
    const dir = relative(source.root, dirname(file));
    const [head, ...tail] = dir.split("/");
    const version = head && versionDirs.has(head) ? head : "";
    const afterVersion = version ? tail : [head ?? "", ...tail];
    const [localeHead, ...localeTail] = afterVersion;
    const locale = localeHead
      ? (localeDirs.get(localeHead.toLowerCase()) ?? "")
      : "";
    const rest = (locale ? localeTail : afterVersion).filter(Boolean).join("/");
    return [version, locale, metaKeyFor(source.prefix, rest)]
      .filter(Boolean)
      .join("/");
  };

  // Scan every source under its own root so a source rooted outside
  // `content.root` still contributes its folder meta.
  const perSource = await Promise.all(
    list.map(async (source) => {
      const found = await globFolderMetaFiles(source, META_FILES);
      // Files outside every `include` glob are never imported; they're kept
      // by key so a scan that finds pages in their group can say so.
      for (const file of found) {
        if (!isReadMetaFile(source, file)) {
          unread.push({
            dir: relative(source.root, dirname(file)),
            file,
            key: keyOf(source, file),
          });
        }
      }
      const loaded = await Promise.all(
        found
          .filter((file) => isReadMetaFile(source, file))
          .map(
            async (
              file
            ): Promise<
              | { ok: true; file: string; value: unknown }
              | { ok: false; file: string; error: Error }
            > => {
              try {
                return {
                  file,
                  ok: true,
                  value: await resolveMeta(await load(file)),
                };
              } catch (error) {
                // SAFETY: jiti surfaces load/evaluate failures as Error
                // instances, and only `message` is read downstream.
                return { error: error as Error, file, ok: false };
              }
            }
          )
      );
      return { loaded, source };
    })
  );

  for (const { loaded, source } of perSource) {
    for (const entry of loaded) {
      const key = keyOf(source, entry.file);

      if (!entry.ok) {
        diagnostics.push({
          code: "BLUME_META_LOAD_FAILED",
          file: entry.file,
          message: `Could not load meta file: ${entry.error.message}`,
          severity: "error",
        });
        continue;
      }

      const result = folderMetaSchema.safeParse(entry.value);
      if (result.success) {
        const target = basename(entry.file).startsWith("meta.$.")
          ? shared
          : meta;
        target.set(key, result.data);
        files.set(result.data, entry.file);
      } else {
        diagnostics.push(
          ...diagnosticsFromZod(result.error, {
            code: "BLUME_META_INVALID",
            file: entry.file,
          })
        );
      }
    }
  }

  // Sources sharing a root partition it with `include` globs, so a file one
  // source skips may be another's: only a file no source reads is unread.
  const read = new Set(
    perSource.flatMap(({ loaded }) => loaded.map((entry) => entry.file))
  );
  return {
    diagnostics,
    files,
    meta,
    shared,
    unread: unread.filter((entry) => !read.has(entry.file)),
  };
};

/**
 * Lay the folder meta content sources derive (the OpenAPI source's tag
 * titles and order) beneath the user's `meta.ts` and `meta.$.ts` files, field
 * by field: a user file's own keys win, and the generated ones fill the rest,
 * so a `meta.ts` that only renames a tag group keeps its generated `order`.
 * Generated meta is locale-agnostic, keyed like `meta.$.*`, so it also sits
 * beneath a locale's own `meta.ts` (`fr/reference/pets` over
 * `reference/pets`). It doesn't reach into an archived version's snapshot,
 * whose groups read only meta keyed under the version.
 */
export const withGeneratedFolderMeta = (
  user: FolderMetaMaps,
  generated: Map<string, FolderMeta>,
  localeDirs: readonly string[] = []
): FolderMetaMaps => {
  const locales = new Set(localeDirs);
  const beneath = (key: string, meta: FolderMeta): FolderMeta => {
    const [head, ...rest] = key.split("/");
    const generatedMeta = generated.get(
      head !== undefined && locales.has(head) ? rest.join("/") : key
    );
    return generatedMeta ? { ...generatedMeta, ...meta } : meta;
  };
  return {
    meta: new Map(
      [...user.meta].map(([key, meta]) => [key, beneath(key, meta)])
    ),
    shared: new Map([
      ...generated,
      ...[...user.shared].map(([key, meta]): [string, FolderMeta] => [
        key,
        { ...generated.get(key), ...meta },
      ]),
    ]),
  };
};
