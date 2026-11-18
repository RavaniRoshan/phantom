import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { join } from "pathe";

/**
 * `blume migrate`'s logic, kept out of the command module so it runs (and is
 * covered) in-process. Migration is judgment work — idiomatic navigation,
 * component rewrites, what to drop — so it stays in the `blume-migrate` skill,
 * shipped inside the package; this module only names the source (from the
 * argument, or detected from the repo's own files) and writes the prompt that
 * points a coding agent at the skill and that source's mappings.
 */

/** The docs frameworks the skill has a mapping reference for. */
export const MIGRATE_SOURCES = [
  "mintlify",
  "fumadocs",
  "docusaurus",
  "starlight",
  "nextra",
  "vitepress",
  "vuepress",
  "docus",
  "mkdocs",
  "mdbook",
  "fern",
  "gitbook",
  "redocly",
  "readme",
  "docsify",
  "jekyll",
  "github-wiki",
] as const;

export type MigrateSourceId = (typeof MIGRATE_SOURCES)[number];

/** Display names, for messages and the prompt. */
export const MIGRATE_SOURCE_NAMES: Record<MigrateSourceId, string> = {
  docsify: "Docsify",
  docus: "Docus",
  docusaurus: "Docusaurus",
  fern: "Fern",
  fumadocs: "Fumadocs",
  gitbook: "GitBook",
  "github-wiki": "GitHub Wiki",
  jekyll: "Jekyll",
  mdbook: "mdBook",
  mintlify: "Mintlify",
  mkdocs: "MkDocs",
  nextra: "Nextra",
  readme: "ReadMe",
  redocly: "Redocly",
  starlight: "Starlight",
  vitepress: "VitePress",
  vuepress: "VuePress",
};

/** The skill's directory inside the published package. */
export const MIGRATE_SKILL_DIR = join("skills", "blume-migrate");

export const isMigrateSource = (value: string): value is MigrateSourceId =>
  MIGRATE_SOURCES.some((source) => source === value);

/** A detected source and the file or dependency that gave it away. */
export interface DetectedSource {
  evidence: string;
  source: MigrateSourceId;
}

/** The slice of `package.json` detection reads. */
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Every dependency the project's `package.json` names, or none when unreadable. */
const dependencyNames = async (root: string): Promise<Set<string>> => {
  const path = join(root, "package.json");
  if (!existsSync(path)) {
    return new Set();
  }
  try {
    // SAFETY: package.json is a JSON object; only its dependency maps are read.
    const pkg = JSON.parse(await readFile(path, "utf-8")) as PackageJson;
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    // A malformed package.json is the agent's to deal with; detection just
    // falls back to the other signals.
    return new Set();
  }
};

/**
 * Each source's tell, in the order the skill's workflow checks them: a config
 * file the framework owns, or a dependency only it installs. A GitHub wiki
 * clone has neither (its tell is the `.wiki.git` remote), so `github-wiki` is
 * named-only.
 */
const SIGNALS: {
  deps?: string[];
  files?: string[];
  source: MigrateSourceId;
}[] = [
  { files: ["docs.json", "mint.json"], source: "mintlify" },
  {
    files: [
      "docusaurus.config.ts",
      "docusaurus.config.js",
      "docusaurus.config.mjs",
      "docusaurus.config.cjs",
    ],
    source: "docusaurus",
  },
  {
    deps: ["fumadocs-core", "fumadocs-ui", "fumadocs-mdx"],
    files: ["source.config.ts"],
    source: "fumadocs",
  },
  { deps: ["nextra"], source: "nextra" },
  { deps: ["@astrojs/starlight"], source: "starlight" },
  // The config usually sits in docs/.vitepress, often with the dependency in
  // docs/package.json rather than the root one.
  {
    deps: ["vitepress"],
    files: [".vitepress", "docs/.vitepress"].flatMap((dir) =>
      ["ts", "mts", "js", "mjs"].map((ext) => `${dir}/config.${ext}`)
    ),
    source: "vitepress",
  },
  // v1 also reads YAML and TOML configs; v2 also reads vuepress.config.* from
  // the directory it runs in. vuepress-vite and vuepress-webpack were the v2
  // beta wrappers.
  {
    deps: ["vuepress", "vuepress-vite", "vuepress-webpack"],
    files: [
      ...[".vuepress", "docs/.vuepress"].flatMap((dir) =>
        ["ts", "js", "mjs", "yml", "toml"].map((ext) => `${dir}/config.${ext}`)
      ),
      "vuepress.config.ts",
      "vuepress.config.js",
      "vuepress.config.mjs",
    ],
    source: "vuepress",
  },
  // The Nuxt docs theme (not Docusaurus); 1.x shipped as @nuxt-themes/docus.
  { deps: ["docus", "@nuxt-themes/docus"], source: "docus" },
  // MkDocs and the tools that build its projects (Zensical, ProperDocs). They
  // come after the JavaScript frameworks, so a stale mkdocs.yml doesn't win.
  {
    files: [
      "mkdocs.yml",
      "mkdocs.yaml",
      "zensical.toml",
      "properdocs.yml",
      "properdocs.yaml",
    ],
    source: "mkdocs",
  },
  // A code repo usually keeps its book in a subfolder.
  {
    files: ["book.toml", "docs/book.toml", "book/book.toml"],
    source: "mdbook",
  },
  // Not fern.config.json alone: plenty of repos run Fern only to generate SDKs.
  { files: ["fern/docs.yml"], source: "fern" },
  // Not SUMMARY.md (mdBook and HonKit books have one too) or book.json (too
  // generic a name).
  {
    deps: ["honkit", "gitbook-cli"],
    files: ["gitbook-docs.yaml", ".gitbook.yaml", ".gitbook.yml"],
    source: "gitbook",
  },
  // After the config-file sources, and never on redocly.yaml alone: that file
  // is just as often Redocly CLI lint config in a repo built with another
  // framework.
  {
    deps: [
      "@redocly/realm",
      "@redocly/redoc",
      "@redocly/revel",
      "@redocly/reef",
      "@redocly/redoc-revel",
      "@redocly/redoc-reef",
      "@redocly/revel-reef",
    ],
    files: ["sidebars.yaml"],
    source: "redocly",
  },
  // ReadMe's bi-directional Git sync; repos that only push with the rdme CLI
  // leave no tell, so those are named-only.
  {
    files: [
      "docs/_order.yaml",
      "reference/_order.yaml",
      "recipes/_order.yaml",
      "custom_pages/_order.yaml",
    ],
    source: "readme",
  },
  // A Docsify site is an index.html that loads the library from a CDN, so only
  // the ones with a manifest give themselves away. Not _sidebar.md: on a
  // case-insensitive filesystem it also matches a GitHub wiki's _Sidebar.md.
  { deps: ["docsify-cli", "docsify"], source: "docsify" },
  // Last: _config.yml is a generic name (Hexo and Jupyter Book use it too), so
  // every more specific tell wins first, and the reference says how to spot
  // the others.
  { files: ["_config.yml", "docs/_config.yml"], source: "jekyll" },
];

/**
 * Detect the docs framework a project is built on from its own files, or
 * null when nothing gives it away (the skill still migrates any framework,
 * working from its general model instead of a mapping reference).
 */
export const detectMigrateSource = async (
  root: string
): Promise<DetectedSource | null> => {
  const deps = await dependencyNames(root);
  for (const { deps: tells = [], files = [], source } of SIGNALS) {
    const file = files.find((name) => existsSync(join(root, name)));
    if (file) {
      return { evidence: file, source };
    }
    const dep = tells.find((name) => deps.has(name));
    if (dep) {
      return { evidence: `${dep} in package.json`, source };
    }
  }
  return null;
};

/**
 * The prompt's URL rule, where a source can't follow the default: a GitHub
 * wiki's old URLs stay on github.com, where no redirect can reach them.
 */
const URL_RULES: Partial<Record<MigrateSourceId, string>> = {
  "github-wiki":
    "Keep every content page. The old wiki URLs stay on github.com and can't be redirected, so map them with the reference's route table and link stubs instead: add no `redirects`, and never push to the wiki; prepare the stubs for the user.",
};

/**
 * The handoff prompt: follow the skill, where its mappings for this source
 * are, and the few rules worth restating — the target version, and that no
 * page or URL is lost.
 */
export const migratePrompt = (options: {
  detected: DetectedSource | null;
  skillDir: string;
  source: MigrateSourceId | null;
  version: string;
}): string => {
  const { detected, skillDir, source, version } = options;
  const evidence =
    detected && detected.source === source
      ? ` (detected from ${detected.evidence})`
      : "";
  const sourceLine = source
    ? `The source is ${MIGRATE_SOURCE_NAMES[source]}${evidence}. Its exact mappings are in ${join(skillDir, "references", `${source}.md`)}.`
    : `The source framework wasn't detected, so inventory the repo first. If it's ${MIGRATE_SOURCES.map((id) => MIGRATE_SOURCE_NAMES[id]).join(", ")}, read that framework's file in ${join(skillDir, "references")}; otherwise follow the skill's mental model directly.`;
  const urlRule =
    (source && URL_RULES[source]) ??
    "Keep every page, and add a redirect for any URL that moves.";
  return `Migrate this documentation project to Blume ${version}.

Follow the blume-migrate skill: read ${join(skillDir, "SKILL.md")} first and work through its migration workflow. Wherever the skill says \`<skill>\`, it means ${skillDir}.

${sourceLine}

Add \`blume@^${version}\` as the docs package's dependency. ${urlRule} Report everything you drop or approximate, and run the skill's verification steps before you finish.`;
};
