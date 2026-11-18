import { existsSync, readFileSync } from "node:fs";

import { basename, dirname, isAbsolute, join, relative, resolve } from "pathe";
import ts from "typescript";
import { z } from "zod";

import { locateMdxFailure } from "../core/mdx-syntax.ts";
import type { MdxFailure, MdxFailureSite } from "../core/mdx-syntax.ts";
import type { BlumeProject } from "../core/project-graph.ts";
import type { Diagnostic } from "../core/types.ts";

/**
 * The fields of an `astro build` rejection the report reads. Rolldown bundles
 * every plugin failure (an MDX compile error, say) into one error whose
 * `errors` holds each; a failure carries `loc` where the compiler pinned it,
 * or only `id`, the module that failed.
 */
const buildErrorSchema = z.looseObject({
  errors: z.array(z.instanceof(Error)).optional(),
  id: z.string().optional(),
  loc: z
    .looseObject({
      column: z.number().optional(),
      file: z.string().optional(),
      line: z.number().optional(),
    })
    .optional(),
});

/**
 * The diagnostic a `BlumeError` thrown inside the build carries, such as a
 * failed hosted search sync in `astro:build:done`. The hook runs Blume's
 * source rather than the CLI bundle, so its error is another copy of the class
 * that the command's `instanceof BlumeError` doesn't recognize.
 */
const blumeErrorSchema = z.looseObject({
  diagnostic: z.object({
    code: z.string(),
    column: z.number().optional(),
    docsUrl: z.string().optional(),
    file: z.string().optional(),
    line: z.number().optional(),
    message: z.string(),
    severity: z.enum(["error", "info", "warning"]),
    suggestion: z.string().optional(),
  }),
});

/**
 * Finds where in an `.mdx` page's files a failure Astro reported with no line
 * happened (see `locateMdxFailure`).
 */
export type MdxFailureLocator = (
  file: string,
  failure: MdxFailure
) => Promise<MdxFailureSite | null>;

/** What the report reads besides the error. */
export interface BuildFailureContext {
  locate?: MdxFailureLocator;
  /** The project root, where the build reads `tsconfig.json`. */
  root?: string;
}

// The message for a name nothing defines, in V8 (Node) and JavaScriptCore (Bun).
const UNDEFINED_NAME = [
  /^(?<name>[\w$]+) is not defined$/u,
  /^Can't find variable: (?<name>[\w$]+)$/u,
];
// A compiler message that opens with where it failed.
const POSITIONED = /^\d+:\d+: /u;

/**
 * A `{…}` expression in an `.mdx` page that reads a name nothing defines: the
 * page compiles, then throws while it renders. Placed at the expression when
 * the page (or a partial it includes) shows where.
 */
const undefinedNameDiagnostic = (
  name: string,
  file: string,
  site: MdxFailureSite | null
): Diagnostic => {
  const escape =
    "show the braces as text: escape each opening brace (`\\{`) or put it in inline code";
  // `{{name}}` is a Blume variable the site doesn't define.
  const variable = site?.expression === `{{${name}}}`;
  return {
    code: "BLUME_MDX_UNDEFINED_NAME",
    column: site?.column,
    file: site?.file ?? file,
    line: site?.line,
    message: site?.expression
      ? `\`${site.expression}\` reads \`${name}\`, which isn't defined, so the page fails to render. In .mdx, \`{…}\` is a JavaScript expression.`
      : `\`${name}\` isn't defined, so the page fails to render. In .mdx, \`{…}\` is a JavaScript expression, and one reads it.`,
    severity: "error",
    suggestion: variable
      ? `Define \`${name}\` under \`variables\` in blume.config.ts, or ${escape}.`
      : `To ${escape}. For a value every page shares, define a variable in blume.config.ts and write \`{{name}}\`.`,
  };
};

// Vite's message for an `extends` or `references` entry it can't resolve. It
// names an `extends` package as written, and a path resolved.
const TSCONFIG_NOT_FOUND = /Tsconfig not found (?<target>\S+?)\.?$/mu;

const tsconfigLinksSchema = z.object({
  extends: z.union([z.string(), z.array(z.string())]).optional(),
  references: z.array(z.object({ path: z.string() })).optional(),
});

/** An entry in a tsconfig's `extends` or `references`, as written. */
interface TsconfigLink {
  key: "extends" | "references";
  written: string;
}

/**
 * The `extends` or `references` entry in the tsconfig at `path` that names
 * `target`: written as is, or resolved from the tsconfig's folder (a
 * reference can name a folder, which means its `tsconfig.json`).
 */
const linkTo = (path: string, target: string): TsconfigLink | undefined => {
  const parsed = tsconfigLinksSchema.safeParse(
    ts.readConfigFile(path, ts.sys.readFile).config
  );
  if (!parsed.success) {
    return undefined;
  }
  const names = (written: string): boolean => {
    const resolved = resolve(dirname(path), written);
    return (
      written === target ||
      resolved === target ||
      join(resolved, "tsconfig.json") === target
    );
  };
  const extended = [parsed.data.extends ?? []].flat().find(names);
  if (extended !== undefined) {
    return { key: "extends", written: extended };
  }
  const referenced = (parsed.data.references ?? [])
    .map((reference) => reference.path)
    .find(names);
  return referenced === undefined
    ? undefined
    : { key: "references", written: referenced };
};

/** How to fix a tsconfig entry that doesn't resolve. */
const tsconfigFix = ({ key, written }: TsconfigLink, name: string): string => {
  if (key === "references") {
    return `Create \`${written}\` (a framework's generated tsconfig appears once its prepare or build step runs), or remove it from \`references\` in ${name}.`;
  }
  if (written.startsWith(".") || isAbsolute(written)) {
    return `Restore \`${written}\`, or remove it from \`extends\` in ${name}.`;
  }
  const packageName = written
    .split("/")
    .slice(0, written.startsWith("@") ? 2 : 1)
    .join("/");
  return `Install the package that provides it (\`${packageName}\`), or remove it from \`extends\` in ${name}.`;
};

/**
 * An `extends` or `references` entry in the project's `tsconfig.json` that
 * doesn't resolve: Vite reads that file while it builds the site, so the
 * build fails in `astro sync` before any page compiles. Placed at the entry's
 * line when the project's own tsconfig names the target.
 */
const tsconfigExtendsDiagnostic = (
  target: string,
  root: string | undefined
): Diagnostic => {
  const found = root
    ? ["tsconfig.json", "jsconfig.json"]
        .map((name) => join(root, name))
        .filter((path) => existsSync(path))
        .map((path) => ({ link: linkTo(path, target), path }))
        .find(({ link }) => link !== undefined)
    : undefined;
  const file = found?.path;
  const { key, written } = found?.link ?? { key: "extends", written: target };
  const line = file
    ? readFileSync(file, "utf-8")
        .split("\n")
        .findIndex((text) => text.includes(JSON.stringify(written))) + 1
    : 0;
  const name = file ? basename(file) : "tsconfig.json";
  return {
    code: "BLUME_TSCONFIG_EXTENDS",
    file,
    line: line > 0 ? line : undefined,
    message: `${file ? name : "A tsconfig.json in the project"} ${key} \`${written}\`, which can't be found. The build reads the project's ${name} to resolve imports, so it stops here.`,
    severity: "error",
    suggestion: tsconfigFix({ key, written }, name),
  };
};

/** The `extends` target an unresolvable tsconfig names, if `error` is that. */
const missingTsconfig = (error: Error): string | undefined =>
  (
    TSCONFIG_NOT_FOUND.exec(error.message) ??
    // `astro sync` wraps the resolver's error in its own.
    (error.cause instanceof Error
      ? TSCONFIG_NOT_FOUND.exec(error.cause.message)
      : null)
  )?.groups?.target;

/** The name a render error says nothing defines, if it says that. */
const undefinedName = (error: Error): string | undefined =>
  error.name === "ReferenceError"
    ? UNDEFINED_NAME.map((pattern) => pattern.exec(error.message)).find(Boolean)
        ?.groups?.name
    : undefined;

/**
 * Where in an `.mdx` page's files a failure the compiler didn't place
 * happened: a render error the page threw, or a compile error in a partial it
 * includes, which the compiler pins on the page with no `line:column:` in its
 * message. (Bun stamps a `line` of its own on every error, so `loc` can't
 * tell.)
 */
const locateFailure = async (
  error: Error,
  page: string,
  name: string | undefined,
  locate: MdxFailureLocator | undefined
): Promise<MdxFailureSite | null> => {
  if (!locate) {
    return null;
  }
  if (name) {
    return await locate(page, { kind: "undefined-name", name });
  }
  return error.name === "MDXError" && !POSITIONED.test(error.message)
    ? await locate(page, { kind: "syntax" })
    : null;
};

/** One failure as a diagnostic at the file (and position) it names. */
const failureDiagnostic = async (
  error: Error,
  context: BuildFailureContext
): Promise<Diagnostic> => {
  const raised = blumeErrorSchema.safeParse(error);
  if (raised.success) {
    return raised.data.diagnostic;
  }
  const tsconfig = missingTsconfig(error);
  if (tsconfig) {
    return tsconfigExtendsDiagnostic(tsconfig, context.root);
  }
  const parsed = buildErrorSchema.safeParse(error);
  const { id, loc } = parsed.success ? parsed.data : {};
  const file = loc?.file ?? id;
  const name = undefinedName(error);
  const site = file?.endsWith(".mdx")
    ? await locateFailure(error, file, name, context.locate)
    : null;
  if (file?.endsWith(".mdx") && name) {
    return undefinedNameDiagnostic(name, file, site);
  }
  if (site?.diagnostic) {
    return site.diagnostic;
  }
  // A named error (`MDXError`, `CompilerError`) says which step failed.
  const label = error.name === "Error" ? "" : `${error.name}: `;
  return {
    code: "BLUME_BUILD_FAILED",
    column: loc?.column,
    file,
    line: loc?.line,
    message: `${label}${error.message}`,
    severity: "error",
  };
};

/**
 * What `astro build` rejected with, as build diagnostics: one per failure
 * Rolldown collected, else the error itself. A page Blume's own checks pass
 * can still fail Astro's compile (MDX that doesn't parse) or render, and that
 * is a problem in the site, reported at its file, rather than an internal
 * error blaming Blume.
 */
export const astroBuildDiagnostics = async (
  rejection: Error,
  context: BuildFailureContext = {}
): Promise<Diagnostic[]> => {
  const parsed = buildErrorSchema.safeParse(rejection);
  const failures = parsed.success ? (parsed.data.errors ?? []) : [];
  return await Promise.all(
    (failures.length > 0 ? failures : [rejection]).map(
      async (failure) => await failureDiagnostic(failure, context)
    )
  );
};

/**
 * The locator a build uses: the failing page's source, read with the includes
 * and variables the scan resolved for it.
 */
export const buildFailureLocator =
  (
    project: Pick<BlumeProject, "config" | "context" | "graph" | "sources">
  ): MdxFailureLocator =>
  (file, failure) => {
    const page = project.graph.pages.find(
      (candidate) => candidate.sourcePath === file
    );
    const source = project.sources.find(
      (candidate) => candidate.name === page?.source.name
    );
    return locateMdxFailure(
      {
        contentRoot: source?.staged ? undefined : source?.contentRoot,
        name: relative(project.context.root, file),
        sourcePath: file,
        variables: project.config.variables,
      },
      failure
    );
  };
