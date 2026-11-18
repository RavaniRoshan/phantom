import { relative } from "pathe";

import { BUILTIN_CHILD_PROPS, BUILTIN_MDX_TAGS } from "./builtin-tags.ts";
import type { Diagnostic, PageRecord } from "./types.ts";

/** `CardGroup` → `card-group`, matching registry item names. */
const toKebab = (tag: string): string =>
  tag
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>")
    .toLowerCase();

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * Warn when an `.mdx` page uses a `<Component>` tag that resolves to nothing —
 * a built-in, an island, or a `components.ts` override — so a typo surfaces as a
 * friendly diagnostic (with a `blume add` hint where one exists) instead of a raw
 * MDX "X is not defined" build error. `extraTags` are the project's own known
 * components (islands + overrides); `registryNames` gates the install hint.
 * One warning per tag names every page that uses it, anchored to the first.
 */
export const validateUsedComponents = (
  pages: PageRecord[],
  extraTags: Set<string>,
  registryNames: Set<string>
): Diagnostic[] => {
  const users = new Map<string, PageRecord[]>();
  for (const page of pages) {
    for (const tag of page.componentsUsed ?? []) {
      if (!(BUILTIN_MDX_TAGS.has(tag) || extraTags.has(tag))) {
        users.set(tag, [...(users.get(tag) ?? []), page]);
      }
    }
  }
  return [...users].map(([tag, using]) => {
    const name = toKebab(tag);
    const suggestion = registryNames.has(name)
      ? `Run \`blume add ${name}\` to install it, or register <${tag}> in components.ts (mdx).`
      : `Register <${tag}> in components.ts (mdx), or add an islands/${tag}.tsx component.`;
    const routes = using.map((page) => page.route);
    const [first] = using;
    return {
      code: "BLUME_UNKNOWN_COMPONENT",
      file: first?.sourcePath ?? first?.id,
      message:
        routes.length === 1
          ? `<${tag}> is used in ${LIST.format(routes)} but isn't a known component.`
          : `<${tag}> is used on ${routes.length} pages but isn't a known component: ${LIST.format(routes)}.`,
      severity: "warning",
      suggestion,
    };
  });
};

const EITHER = new Intl.ListFormat("en", { type: "disjunction" });
const quoted = (names: readonly string[]): string[] =>
  names.map((name) => `\`${name}\``);

/**
 * Warn about each childless built-in in an `.mdx` page given props it doesn't
 * take (`<Badge type="tip" text="beta" />`, VitePress's Badge). Blume's
 * components ignore unknown props, so the element renders without the
 * content those props carried. `extraTags` are the project's own components
 * (islands + overrides): one that replaces a built-in takes its own props,
 * so its uses aren't checked. A file shared by several locales is reported
 * once.
 */
export const unknownPropDiagnostics = (
  pages: readonly PageRecord[],
  extraTags: ReadonlySet<string>
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const use of page.unknownProps ?? []) {
      const file = use.file ?? page.sourcePath ?? page.id;
      const key = `${file}:${use.line}:${use.column}`;
      if (extraTags.has(use.tag) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const accepted = BUILTIN_CHILD_PROPS.get(use.tag) ?? [];
      const takes =
        accepted.length > 0
          ? `, and use the props ${use.tag} takes: ${LIST.format(quoted(accepted))}`
          : `; ${use.tag} takes no props`;
      diagnostics.push({
        code: "BLUME_UNKNOWN_PROP",
        column: use.column,
        file,
        line: use.line,
        message: `<${use.tag}> in ${page.route} has no children, and ${use.tag} doesn't take ${EITHER.format(quoted(use.props))}, so it renders without what ${use.props.length === 1 ? "that prop" : "those props"} meant to show.`,
        severity: "warning",
        suggestion: `Put the content between the tags (<${use.tag}>…</${use.tag}>)${takes}.`,
      });
    }
  }
  return diagnostics;
};

/** What example discovery found: where it looked, and each example's key. */
export interface ExampleKeys {
  /** Absolute directory the examples were discovered under. */
  dir: string;
  examples: readonly { path: string }[];
}

/**
 * Warn about each `<Component path>` in an `.mdx` page that names no
 * discovered example. The page still renders, with a "No example found" box
 * where the preview should be, so without this a typo or a moved example
 * ships silently. Reported at the `path` value, in the partial that holds it
 * when an `<include>` brought it in; a file shared by several locales is
 * reported once. `extraTags` are the project's own components (islands +
 * overrides), as for {@link validateUsedComponents}: one named `Component`
 * replaces the built-in and resolves `path` its own way, so none is checked.
 */
export const missingExampleDiagnostics = (
  pages: readonly PageRecord[],
  discovery: ExampleKeys,
  root: string,
  extraTags: ReadonlySet<string>
): Diagnostic[] => {
  if (extraTags.has("Component")) {
    return [];
  }
  const known = new Set(discovery.examples.map((example) => example.path));
  const dir = relative(root, discovery.dir) || ".";
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const use of page.examplesUsed ?? []) {
      const file = use.file ?? page.sourcePath ?? page.id;
      const key = `${file}:${use.line}:${use.column}`;
      if (!(known.has(use.path) || seen.has(key))) {
        seen.add(key);
        diagnostics.push({
          code: "BLUME_EXAMPLE_NOT_FOUND",
          column: use.column,
          file,
          line: use.line,
          message: `<Component path="${use.path}"> in ${page.route} names no example, so the page shows "No example found" in its place.`,
          severity: "warning",
          suggestion: `Fix the path, or add the example under ${dir}/: \`path\` is its location there, without the extension.`,
        });
      }
    }
  }
  return diagnostics;
};
