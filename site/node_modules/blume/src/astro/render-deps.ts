import { existsSync, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { isBuiltin } from "node:module";

import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "pathe";

import { packageRoot } from "../core/package-root.ts";

/**
 * The two places an installer can put Blume's dependencies:
 *   - `<blume>/node_modules` — deps nested under the package (workspace source,
 *     or npm nesting them away from a conflicting hoisted copy)
 *   - `dirname(<blume>)`     — deps as siblings in the store (isolated/pnpm)
 *
 * `packageRoot()` resolves to Blume's real on-disk path (Node follows the
 * install symlink), so its parent is the store's package directory where the
 * isolated linker places the siblings.
 */
export const depsCandidates = (pkgDir: string): string[] => [
  join(pkgDir, "node_modules"),
  dirname(pkgDir),
];

/** First dependency candidate containing the package dir `segments`, or null. */
export const candidateHolding = (
  pkgDir: string,
  ...segments: string[]
): string | null =>
  depsCandidates(pkgDir).find((dir) => existsSync(join(dir, ...segments))) ??
  null;

const holdsAstro = (dir: string): boolean => existsSync(join(dir, "astro"));
const holdsMdx = (dir: string): boolean =>
  existsSync(join(dir, "@astrojs", "mdx"));

/**
 * Locate the directory that holds Blume's installed dependencies (Astro and its
 * integrations).
 *
 * With a clean hoisted install this is moot — the deps sit in a `node_modules`
 * the generated `.blume/` already walks up into. But under isolated linkers
 * (Bun's `isolated` mode, pnpm) Blume's deps are NOT hoisted into the project;
 * they live beside the Blume package in a virtual store, invisible to the
 * upward walk from `.blume/` — so probe the {@link depsCandidates}.
 *
 * Astro alone is a bad probe: an npm split install (an `overrides` pin plus an
 * incremental install) hoists `astro` to the project root while Blume's other
 * deps stay nested, and probing for astro then picks the root directory — one
 * that holds none of them. Prefer a candidate with the full set (astro beside
 * `@astrojs/mdx`, the integration every generated runtime declares), then one
 * with the integrations (astro hoisted away — the rest of Blume's deps sit
 * there too), then one with astro alone.
 */
export const blumeDepsDir = (pkgDir: string = packageRoot()): string | null => {
  const candidates = depsCandidates(pkgDir);
  return (
    candidates.find((dir) => holdsAstro(dir) && holdsMdx(dir)) ??
    candidates.find(holdsMdx) ??
    candidates.find(holdsAstro) ??
    null
  );
};

/**
 * The package a bare specifier names (`@scope/name` or `name`, whatever
 * subpath follows), or null for a Node builtin.
 */
export const packageNameOf = (specifier: string): string | null => {
  if (isBuiltin(specifier)) {
    return null;
  }
  const [first = "", second] = specifier.split("/");
  if (!first.startsWith("@")) {
    return first || null;
  }
  return second ? `${first}/${second}` : null;
};

/**
 * The directory an import of package `name` loads from when resolved from
 * `fromDir`: the first `node_modules/<name>` up the physical ancestors — the
 * walk Node itself performs — as a real path, or null when none holds it.
 */
export const packageDirFrom = (
  name: string,
  fromDir: string
): string | null => {
  let dir = normalize(fromDir);
  while (true) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return normalize(realpathSync(candidate));
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
};

/** Whether `child` is `parent` or sits somewhere under it. */
const isWithin = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path === "" || !(path.startsWith("..") || isAbsolute(path));
};

/**
 * Point `link` at the package directory `target`, replacing a link to anything
 * else and leaving a real directory alone. The link is relative, so it keeps
 * working when the project moves as a whole (a server build shipped with its
 * `node_modules`); without symlink privilege on Windows it falls back to a
 * junction, which must be absolute.
 */
const linkPackageDir = async (link: string, target: string): Promise<void> => {
  await mkdir(dirname(link), { recursive: true });
  // A relative link resolves from its folder's real path, which differs from
  // the logical one under a symlinked parent (macOS's `/var` → `/private/var`),
  // so the relative target is computed from the real path.
  const from = normalize(await realpath(dirname(link)));
  let existing: Awaited<ReturnType<typeof lstat>> | null;
  try {
    existing = await lstat(link);
  } catch {
    existing = null;
  }
  if (existing) {
    if (!existing.isSymbolicLink()) {
      return;
    }
    try {
      // Both sides in one separator style: Windows hands back `\\` paths.
      if (resolve(from, await readlink(link)) === normalize(target)) {
        return;
      }
    } catch {
      // An unreadable link is replaced below.
    }
    await rm(link, { force: true });
  }
  try {
    await symlink(relative(from, target), link, "dir");
  } catch {
    await symlink(target, link, "junction");
  }
};

/** The package names a `node_modules` directory holds, scoped ones included. */
const packageNames = async (modulesDir: string): Promise<string[]> => {
  const entries = await readdir(modulesDir);
  const grouped = await Promise.all(
    entries
      .filter((entry) => !entry.startsWith("."))
      .map(async (entry) => {
        if (!entry.startsWith("@")) {
          return [entry];
        }
        const scoped = await readdir(join(modulesDir, entry));
        return scoped.map((name) => `${entry}/${name}`);
      })
  );
  return grouped.flat();
};

/**
 * Give a server-side build output its own `node_modules`: one link per package
 * its bundles import by bare name, each to the copy the importing module
 * resolves. A render bundle mixes code from Blume, Astro, and the adapters
 * into one set of chunks, and its bare imports resolve by walking up from the
 * chunk — so without these links the copy the package manager happened to
 * hoist wins, not the one the importer declared. A root `js-yaml@4` (pulled in
 * by the Netlify or Cloudflare adapter) then breaks Blume's `js-yaml@5`
 * import, a Yarn-hoisted `cookie@0.7` breaks Astro's `cookie@2` import, and
 * under pnpm the server bundle can't reach Blume's dependencies at all.
 *
 * Under an isolated linker the links also cover the rest of Blume's own
 * dependencies, which the upward walk can't reach from the output, so a
 * specifier the build never saw (loaded by a dependency at runtime) still
 * resolves as it did before.
 */
export const linkRenderDeps = async (
  dir: string,
  imported: ReadonlyMap<string, string>,
  pkgDir: string = packageRoot()
): Promise<void> => {
  const modulesDir = join(dir, "node_modules");
  // An earlier release linked the whole directory here; per-package links
  // need a real directory in its place.
  try {
    const existing = await lstat(modulesDir);
    if (existing.isSymbolicLink()) {
      await rm(modulesDir, { force: true });
    }
  } catch {
    // Nothing there yet.
  }
  const links = new Map(imported);
  const depsDir = blumeDepsDir(pkgDir);
  if (
    depsDir &&
    !(basename(depsDir) === "node_modules" && isWithin(dirname(depsDir), dir))
  ) {
    for (const name of await packageNames(depsDir)) {
      if (!links.has(name)) {
        links.set(name, normalize(realpathSync(join(depsDir, name))));
      }
    }
  }
  await Promise.all(
    [...links].map(([name, target]) =>
      linkPackageDir(join(modulesDir, name), target)
    )
  );
};

/** The Vite environment a hook runs in (`client`, `ssr`, `prerender`). */
interface PluginEnvironment {
  name: string;
}

/** What `this.resolve` returns: the resolved id, and whether it's external. */
interface ResolvedModule {
  external?: boolean | "absolute" | "relative";
  id: string;
}

/** The `resolveId` hook options this plugin forwards to `this.resolve`. */
interface ResolveIdOptions {
  attributes?: Record<string, string>;
  isEntry?: boolean;
  kind?: string;
}

/** The slice of the plugin context the `resolveId` hook uses. */
interface ResolveContext {
  environment?: PluginEnvironment;
  resolve: (
    source: string,
    importer: string | undefined,
    options: ResolveIdOptions & { skipSelf: boolean }
  ) => Promise<ResolvedModule | null>;
}

/** The Vite plugin {@link prerenderDepsPlugin} returns. */
export interface PrerenderDepsPlugin {
  apply: "build";
  configResolved: (config: { root: string }) => void;
  enforce: "pre";
  name: string;
  resolveId: {
    filter: { id: RegExp };
    handler: (
      this: ResolveContext,
      source: string,
      importer: string | undefined,
      options: ResolveIdOptions
    ) => Promise<ResolvedModule | null>;
  };
  writeBundle: (
    this: { environment?: PluginEnvironment } | undefined,
    options: { dir?: string }
  ) => Promise<void>;
}

/**
 * A specifier that could name a package: not relative, absolute, virtual
 * (`\0`), or carrying a scheme or drive letter (`node:`, `virtual:`, `C:`).
 */
const BARE_SPECIFIER = /^[^\0./\\][^:]*$/u;

/**
 * The directory a module id's imports resolve from, or undefined for an id
 * that isn't a file (a virtual module).
 */
const importerDir = (importer: string | undefined): string | undefined => {
  const [path = ""] = (importer ?? "").split("?");
  return isAbsolute(path) ? dirname(path) : undefined;
};

/**
 * Vite plugin that makes a server-side build's externalized imports resolve
 * to the copies their importers declared, for the static prerender bundle
 * Astro imports to write the HTML and for a server build's output alike.
 *
 * While each server-side environment (`ssr`, `prerender`) builds, it records
 * every import Vite leaves external together with the package directory that
 * import resolves to from the module that makes it. Once the environment's
 * bundle is written, {@link linkRenderDeps} gives the output directory a
 * `node_modules` of links to exactly those directories. Astro deletes the
 * prerender output once generation finishes — `fs.rm` unlinks the links
 * without following them — while a server build ships its links, relative so
 * they survive the project moving as a whole, and a deploy adapter's file
 * trace follows them to the real files.
 *
 * Outside an environment-aware build (a direct call, as in the tests) only a
 * `.prerender` output is handled. The client build is never touched.
 */
export const prerenderDepsPlugin = (
  pkgDir: string = packageRoot()
): PrerenderDepsPlugin => {
  const imported = new Map<string, Map<string, string>>();
  let root: string | undefined;

  const record = (
    environment: string,
    source: string,
    importer: string | undefined
  ): void => {
    const name = packageNameOf(source);
    const packages = imported.get(environment) ?? new Map<string, string>();
    imported.set(environment, packages);
    if (!name || packages.has(name)) {
      return;
    }
    const from = importerDir(importer) ?? root;
    const target = from === undefined ? null : packageDirFrom(name, from);
    if (target) {
      packages.set(name, target);
    }
  };

  return {
    apply: "build",
    configResolved: (config) => {
      ({ root } = config);
    },
    enforce: "pre",
    name: "blume:prerender-deps",
    resolveId: {
      filter: { id: BARE_SPECIFIER },
      async handler(source, importer, options) {
        const environment = this.environment?.name;
        if (environment === undefined || environment === "client") {
          return null;
        }
        const resolved = await this.resolve(source, importer, {
          ...options,
          skipSelf: true,
        });
        if (resolved?.external) {
          record(environment, source, importer);
        }
        return resolved;
      },
    },
    async writeBundle(options) {
      const environment = this?.environment?.name;
      const { dir } = options;
      const serverSide =
        environment === undefined
          ? dir !== undefined && basename(dir) === ".prerender"
          : environment !== "client";
      if (!dir || !serverSide) {
        return;
      }
      const packages = imported.get(environment ?? "");
      // A bundle that leaves no package import external loads nothing from
      // `node_modules` at runtime, so it gets none. The Cloudflare adapter
      // bundles the Worker whole, and a copy of its output that follows the
      // links (a CI artifact) would otherwise upload every one of Blume's
      // dependencies as a Worker module.
      if (environment !== undefined && !packages?.size) {
        return;
      }
      await linkRenderDeps(dir, packages ?? new Map<string, string>(), pkgDir);
    },
  };
};
