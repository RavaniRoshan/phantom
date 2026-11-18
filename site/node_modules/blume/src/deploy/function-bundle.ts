import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";

import { init, parse } from "es-module-lexer";
import { dirname, join, relative } from "pathe";
import { z } from "zod";

import {
  commandsFor,
  detectProjectPackageManager,
} from "../cli/init/scaffold.ts";
import { packageRoot } from "../core/package-root.ts";

/**
 * Post-build audit of a Vercel serverless function bundle.
 *
 * The Vercel adapter traces the server entry with `@vercel/nft` and copies
 * every file it reaches into `.vercel/output/functions/_render.func`. A bare
 * import the trace cannot resolve — a package that isn't reachable by walking
 * `node_modules` up from the chunk that imports it — is dropped *silently*,
 * and the deployed function dies on its first request with
 * `ERR_MODULE_NOT_FOUND` (Vercel reports it as `FUNCTION_INVOCATION_FAILED`).
 * Under an isolated linker (pnpm, Bun's `isolated` mode) that is exactly the
 * shape of Blume's own runtime dependencies: the SSR build leaves them
 * external, and they live under `blume`'s store directory, not the project
 * root. Nothing before deploy surfaces it — the build is green, a warm-cache
 * preview is green — so the bundle is re-checked here with Node's own
 * resolution rule: a package is present when some `node_modules/<name>` on
 * the walk from the importing chunk up to the function root exists.
 */

/** A bare package import the function bundle cannot satisfy. */
export interface MissingPackage {
  /** Function-relative paths of the chunks that import the package. */
  importers: string[];
  name: string;
}

/** One function directory's audit result. */
export interface FunctionBundleAudit {
  /** Absolute path of the `*.func` directory. */
  dir: string;
  missing: MissingPackage[];
}

const BUILTINS = new Set(builtinModules);

/** Specifier prefixes that never name an installed package. */
const NON_PACKAGE_PREFIXES = ["node:", "astro:", "virtual:", "data:", "\0"];

/**
 * The package a bare specifier resolves through (`@scope/name` or `name`), or
 * null for relative/absolute paths, Node builtins, and virtual ids.
 */
export const packageName = (specifier: string): string | null => {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    NON_PACKAGE_PREFIXES.some((prefix) => specifier.startsWith(prefix)) ||
    BUILTINS.has(specifier)
  ) {
    return null;
  }
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null;
  }
  return segments[0] || null;
};

/**
 * Fallback static specifiers for a module the lexer rejects: a side-effect
 * `import "x"` or an `import`/`export … from "x"` clause. Only `import` takes
 * the bare-string form — `export "x"` is not syntax, so a runtime message
 * quoting `export 'ALL'` must not match.
 */
const STATIC_IMPORT =
  /(?:^|[;\s}])(?:import\s*["'](?<bare>[^"'\n]+)["']|(?:import|export)\s*[\w$*{},\s]*?\s*from\s*["'](?<from>[^"'\n]+)["'])/gu;

/** Fallback dynamic `import("…")` specifiers. */
const DYNAMIC_IMPORT = /\bimport\(\s*["'](?<dynamic>[^"'\n]+)["']\s*\)/gu;

/**
 * Textual best effort for a module `es-module-lexer` cannot parse: every
 * quoted specifier in import position, string contents included.
 */
const scannedSpecifiers = (source: string): string[] => {
  const specifiers: string[] = [];
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(pattern)) {
      const groups = match.groups ?? {};
      specifiers.push(groups.bare ?? groups.from ?? groups.dynamic ?? "");
    }
  }
  return specifiers;
};

/**
 * Every specifier a module's syntax imports, read with `es-module-lexer` so
 * text inside string literals never counts. That matters for Blume's data
 * chunks: the MCP snapshot is `JSON.parse("…")` over every page's Markdown,
 * and a code sample there reading `import { config } from 'dotenv'` is prose
 * to a bundle audit, not a module the function needs. `import.meta` carries no
 * specifier and a template-literal `import(\`pkg/${x}\`)` is a glob the
 * bundler already resolved, so neither names a package.
 */
const lexedSpecifiers = (source: string, name: string): string[] => {
  const [imports] = parse(source, name);
  const specifiers: string[] = [];
  for (const entry of imports) {
    if (entry.type === "dynamic" && entry.glob) {
      continue;
    }
    if (entry.specifier) {
      specifiers.push(entry.specifier);
    }
  }
  return specifiers;
};

/**
 * Every bare package name a module's source imports. A module the lexer
 * rejects (an unterminated string, an invalid escape in a specifier) falls
 * back to the textual scan rather than going unaudited.
 */
export const importedPackages = async (
  source: string,
  name = "module"
): Promise<string[]> => {
  await init();
  let specifiers: string[];
  try {
    specifiers = lexedSpecifiers(source, name);
  } catch {
    specifiers = scannedSpecifiers(source);
  }
  const names = new Set<string>();
  for (const specifier of specifiers) {
    const packageId = packageName(specifier);
    if (packageId) {
      names.add(packageId);
    }
  }
  return [...names];
};

/** Whether `node_modules/<name>` exists on the walk from `from` up to `root`. */
const resolvable = (name: string, from: string, root: string): boolean => {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, "node_modules", name, "package.json"))) {
      return true;
    }
    if (dir === root) {
      return false;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
};

const MODULE_FILE = /\.(?:m?js|cjs)$/u;

/** The one `.vc-config.json` field the audit reads; the rest passes through. */
const vcConfigSchema = z.looseObject({ handler: z.string().optional() });

/** Every JavaScript module under `dir`, skipping any `node_modules`. */
const listModules = async (dir: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        // oxlint-disable-next-line no-await-in-loop -- sequential walk keeps ordering deterministic
        files.push(...(await listModules(path)));
      }
    } else if (entry.isFile() && MODULE_FILE.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
};

/**
 * Audit one function directory: read its `.vc-config.json` handler, scan
 * every module beside the handler (the adapter's `dist/server` tree) for bare
 * imports, and report the packages no `node_modules` on the walk up to the
 * function root provides. A function without a handler has nothing to check.
 */
export const auditFunctionBundle = async (
  funcDir: string
): Promise<MissingPackage[]> => {
  const configPath = join(funcDir, ".vc-config.json");
  if (!existsSync(configPath)) {
    return [];
  }
  const config = vcConfigSchema.safeParse(
    JSON.parse(await readFile(configPath, "utf-8"))
  );
  if (!config.success || !config.data.handler) {
    return [];
  }
  const serverDir = dirname(join(funcDir, config.data.handler));
  if (!existsSync(serverDir)) {
    return [];
  }
  const missing = new Map<string, string[]>();
  for (const file of await listModules(serverDir)) {
    // oxlint-disable-next-line no-await-in-loop -- sequential read keeps the importer lists ordered
    const source = await readFile(file, "utf-8");
    // oxlint-disable-next-line no-await-in-loop -- the lexer runs per file, in the same order
    for (const name of await importedPackages(source, file)) {
      if (resolvable(name, dirname(file), funcDir)) {
        continue;
      }
      const importers = missing.get(name) ?? [];
      importers.push(relative(funcDir, file));
      missing.set(name, importers);
    }
  }
  return [...missing]
    .map(([name, importers]) => ({ importers, name }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
};

/**
 * Audit every function in a Vercel Build Output tree (`.vercel/output`).
 * Functions with nothing missing are omitted; an output tree without a
 * `functions/` directory (a static build) yields nothing.
 */
export const auditVercelFunctions = async (
  outputDir: string
): Promise<FunctionBundleAudit[]> => {
  const functionsDir = join(outputDir, "functions");
  if (!existsSync(functionsDir)) {
    return [];
  }
  const audits: FunctionBundleAudit[] = [];
  const entries = await readdir(functionsDir, { withFileTypes: true });
  for (const entry of entries.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!(entry.isDirectory() && entry.name.endsWith(".func"))) {
      continue;
    }
    const dir = join(functionsDir, entry.name);
    // oxlint-disable-next-line no-await-in-loop -- sequential audit keeps the report ordered
    const missing = await auditFunctionBundle(dir);
    if (missing.length > 0) {
      audits.push({ dir, missing });
    }
  }
  return audits;
};

/** Blume's own runtime dependency names, from its published `package.json`. */
export const blumeDependencyNames = (): Set<string> => {
  const manifest: { dependencies?: Record<string, string> } = JSON.parse(
    readFileSync(join(packageRoot(), "package.json"), "utf-8")
  );
  return new Set(Object.keys(manifest.dependencies ?? {}));
};

/** What a build should do about an audit: nothing, warn, or fail. */
export interface FunctionBundleVerdict {
  /**
   * A missing package is one of Blume's own dependencies — the runtime Blume
   * generated imports it, so the function is certain to crash. Anything else
   * (a project's own external import) is reported but left to the author.
   */
  fatal: boolean;
  message: string;
}

/**
 * The command that adds a dev dependency with the project's package manager
 * (`pnpm add -D`, `npm install -D`, …), for the fix a verdict prints. The
 * missing packages are an isolated-linker problem, so the project is often
 * not on npm at all.
 */
export const addDevDependencyCommand = async (root: string): Promise<string> =>
  `${commandsFor(await detectProjectPackageManager(root)).add} -D`;

/**
 * Describe a function's missing packages and how to fix them. Vercel's trace
 * only reaches packages resolvable from the project root, so the remedy is a
 * root-level dependency entry for each — the same mirror rule Blume's native
 * dependencies (`sharp`, `takumi-js`) already follow — added with
 * `addDevCommand` (see {@link addDevDependencyCommand}).
 */
export const functionBundleVerdict = (
  audit: FunctionBundleAudit,
  root: string,
  ownDependencies: ReadonlySet<string>,
  addDevCommand = "npm install -D"
): FunctionBundleVerdict => {
  const names = audit.missing.map((entry) => entry.name);
  const lines = audit.missing.map(
    (entry) => `  - ${entry.name} (imported by ${entry.importers.join(", ")})`
  );
  const fatal = names.some((name) => ownDependencies.has(name));
  const message = [
    `The Vercel function bundle at ${relative(root, audit.dir) || audit.dir} is missing packages its server code imports, so the deployed function would fail on every request with ERR_MODULE_NOT_FOUND:`,
    ...lines,
    "Vercel's dependency trace only includes packages resolvable from the project root; under an isolated linker (pnpm, Bun's isolated mode) Blume's own dependencies are not. Add them to the project's package.json so the trace can find them:",
    `  ${addDevCommand} ${names.join(" ")}`,
  ].join("\n");
  return { fatal, message };
};
