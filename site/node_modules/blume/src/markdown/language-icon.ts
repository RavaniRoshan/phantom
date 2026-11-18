/**
 * A Shiki transformer that prepends a brand icon to a code block's header,
 * keyed off the fence language. Icons are sourced from `simple-icons` (raw SVG
 * path data) at build time and emitted as an inline `<svg>` — no client JS and
 * no React, so it works in the core theme. The icon renders in `currentColor`
 * (the muted header color) so it stays legible in both light and dark; brand
 * hex colors are skipped because dark-on-dark logos (Next.js, Rust…) vanish.
 *
 * The theme styles `.blume-lang-icon` and shifts the language label
 * (`pre[data-language][data-icon]::before`) to make room — gated on
 * `data-language` so the icon only shows when a header bar exists to hold it.
 */

import {
  siAstro,
  siC,
  siCplusplus,
  siCss,
  siDart,
  siDocker,
  siGnubash,
  siGo,
  siGraphql,
  siHtml5,
  siJavascript,
  siJson,
  siKotlin,
  siLess,
  siLua,
  siMarkdown,
  siMdx,
  siMysql,
  siNextdotjs,
  siPhp,
  siPrisma,
  siPython,
  siReact,
  siRuby,
  siRust,
  siSass,
  siScala,
  siSvelte,
  siSvg,
  siSwift,
  siToml,
  siTypescript,
  siVuedotjs,
  siWebassembly,
  siYaml,
} from "simple-icons";

/** The slice of a `simple-icons` icon Blume reads: its slug and path data. */
interface SimpleIcon {
  path: string;
  slug: string;
}

/** Fence language (and common aliases) → icon. Unmapped languages get none. */
interface LanguageIcons {
  [language: string]: SimpleIcon;
}

const LANGUAGE_ICONS: LanguageIcons = {
  astro: siAstro,
  bash: siGnubash,
  c: siC,
  "c++": siCplusplus,
  cjs: siJavascript,
  cpp: siCplusplus,
  css: siCss,
  cts: siTypescript,
  dart: siDart,
  docker: siDocker,
  dockerfile: siDocker,
  go: siGo,
  gql: siGraphql,
  graphql: siGraphql,
  html: siHtml5,
  javascript: siJavascript,
  js: siJavascript,
  json: siJson,
  json5: siJson,
  jsonc: siJson,
  jsx: siReact,
  kotlin: siKotlin,
  kt: siKotlin,
  less: siLess,
  lua: siLua,
  markdown: siMarkdown,
  md: siMarkdown,
  mdx: siMdx,
  mjs: siJavascript,
  mts: siTypescript,
  nextjs: siNextdotjs,
  php: siPhp,
  prisma: siPrisma,
  py: siPython,
  python: siPython,
  rb: siRuby,
  react: siReact,
  rs: siRust,
  ruby: siRuby,
  rust: siRust,
  sass: siSass,
  scala: siScala,
  scss: siSass,
  sh: siGnubash,
  shell: siGnubash,
  sql: siMysql,
  svelte: siSvelte,
  svg: siSvg,
  swift: siSwift,
  toml: siToml,
  ts: siTypescript,
  tsx: siReact,
  typescript: siTypescript,
  vue: siVuedotjs,
  wasm: siWebassembly,
  yaml: siYaml,
  yml: siYaml,
  zsh: siGnubash,
};

/** A minimal hast node (avoids a hast type dependency). */
interface HastNode {
  children?: HastNode[];
  properties?: Record<string, boolean | number | string | string[] | undefined>;
  tagName?: string;
  type: string;
  value?: string;
}

/** The slice of Shiki's transformer `this` context the icon hook reads. */
interface IconContext {
  options: { lang?: string };
}

/** The `<pre>` hast node a Shiki `pre` hook receives. */
interface IconPreNode {
  children: HastNode[];
  properties: Record<string, boolean | number | string | undefined>;
}

/** A Shiki-compatible transformer, typed structurally to avoid a Shiki dep. */
export interface LanguageIconTransformer {
  name: string;
  pre: (this: IconContext, node: IconPreNode) => void;
}

/** Build the transformer. Runs after Shiki's built-in `data-language` hook. */
export const languageIconTransformer = (): LanguageIconTransformer => ({
  name: "blume:language-icon",
  pre(node) {
    const icon = LANGUAGE_ICONS[(this.options.lang ?? "").toLowerCase()];
    if (!icon) {
      return;
    }
    // The icon itself is CSS: the theme paints `pre[data-icon="<slug>"]::after`
    // with the brand path as a mask (see `languageIconCss`), so a block
    // carries a short attribute instead of ~1 kB of SVG — on a reference page
    // with twenty TypeScript blocks, the difference is most of the page.
    node.properties.dataIcon = icon.slug;
  },
});

/** The icon slug for a fence language, or null for an unmapped language. */
export const languageIconSlug = (language: string): string | null =>
  LANGUAGE_ICONS[language.toLowerCase()]?.slug ?? null;

// Fence openers (```ts, ~~~tsx) and the `lang`/`language` props of code
// components (<CodeBlock lang="ts">), which highlight through the same
// transformer. Word characters plus the few punctuation marks languages use.
const FENCE_LANGUAGE = /^[ \t]*(?:`{3,}|~{3,})[ \t]*(?<lang>[\w+#.-]+)/gmu;
const PROP_LANGUAGE = /\blang(?:uage)?=["'](?<lang>[\w+#.-]+)["']/gu;

/**
 * The icon slugs a site's Markdown uses, sorted and deduped, so the theme
 * carries a mask rule for each of them and none for the other thirty.
 */
export const languageIconSlugsIn = (markdown: string): string[] => {
  const slugs = new Set<string>();
  for (const pattern of [FENCE_LANGUAGE, PROP_LANGUAGE]) {
    for (const match of markdown.matchAll(pattern)) {
      const slug = languageIconSlug(match.groups?.lang ?? "");
      if (slug) {
        slugs.add(slug);
      }
    }
  }
  return [...slugs].toSorted();
};

const iconBySlug = (slug: string): SimpleIcon | undefined =>
  Object.values(LANGUAGE_ICONS).find((icon) => icon.slug === slug);

/** A simple-icons path as a `mask-image` data URI (24×24 viewBox). */
const maskUri = (path: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}"/></svg>`)}")`;

/**
 * The per-language rules that paint a code block's icon: each gives the
 * block's `::after` (positioned by the theme) the brand path as a mask over
 * the muted foreground. Only the listed slugs get a rule, so an unmapped or
 * unused language paints nothing rather than a blank square.
 */
export const languageIconCss = (slugs: string[]): string =>
  slugs
    .map((slug) => {
      const icon = iconBySlug(slug);
      if (!icon) {
        return "";
      }
      const mask = maskUri(icon.path);
      return `.prose > :where(pre[data-language][data-icon="${slug}"])::after {
  background-color: var(--blume-muted-foreground);
  -webkit-mask-image: ${mask};
  mask-image: ${mask};
}`;
    })
    .filter((rule) => rule !== "")
    .join("\n");
