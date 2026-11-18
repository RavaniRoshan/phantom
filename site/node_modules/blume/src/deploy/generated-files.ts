import { join } from "pathe";

import { buildAgentReadability } from "../ai/agent-readability.ts";
import {
  AI_CATALOG_PATH,
  ARD_MANIFEST_PATH,
  buildAiCatalog,
} from "../ai/ai-catalog.ts";
import { API_CATALOG_PATH, buildApiCatalog } from "../ai/api-catalog.ts";
import {
  API_NAVIGATION_PATH,
  API_PAGES_PATH,
  OPENAPI_PATH,
} from "../ai/api/paths.ts";
import { SKILL_MD_PATH } from "../ai/site-skill.ts";
import { AGENT_SKILLS_INDEX_PATH, servesSkillsIndex } from "../ai/skills.ts";
import type { SkillArtifact } from "../ai/skills.ts";
import {
  buildSignaturesDirectory,
  SIGNATURES_DIRECTORY_PATH,
} from "../ai/web-bot-auth.ts";
import type { BlumeProject } from "../core/project-graph.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import { staticFileResolver } from "../core/static-files.ts";
import { buildRobots } from "./robots.ts";
import { buildRssFeeds } from "./rss.ts";
import { buildSitemapFiles } from "./sitemap.ts";

/** A generated `.well-known` discovery document: `null` content when it's off. */
export interface WellKnownFile {
  content: string | null;
  label: string;
  path: string;
}

/**
 * The generated `.well-known` discovery documents — the Web Bot Auth signature
 * directory, the RFC 9727 API catalog, and the AI catalog under both the
 * ai-catalog spec's well-known URI and the ARD v0.91 one (see
 * `ai/ai-catalog.ts`) — each with `null` content when its feature is off.
 */
export const wellKnownFiles = (
  config: ResolvedConfig,
  skills: readonly SkillArtifact[]
): WellKnownFile[] => {
  const aiCatalog = buildAiCatalog(config, skills);
  return [
    {
      content: buildSignaturesDirectory(config),
      label: "Web Bot Auth",
      path: SIGNATURES_DIRECTORY_PATH,
    },
    {
      content: buildApiCatalog(config),
      label: "RFC 9727",
      path: API_CATALOG_PATH,
    },
    { content: aiCatalog, label: "AI Catalog", path: AI_CATALOG_PATH },
    { content: aiCatalog, label: "ARD manifest", path: ARD_MANIFEST_PATH },
  ];
};

/**
 * The files a build serves beside its pages that don't come from `public/`,
 * as base-less root-relative paths: what `publishBuildArtifacts` writes once
 * Astro is done (llms.txt, the sitemap, robots.txt, `agent-readability.json`,
 * the `.well-known` discovery documents, the Agent Skills index, `skill.md`)
 * and the generated endpoints at fixed paths (the RSS feeds, the JSON docs
 * API and its OpenAPI description, the MCP discovery documents). Each is
 * listed under the gate its writer reads, so a feature the config switches
 * off drops its file here too: `blume validate` accepts a link to
 * `/llms.txt` exactly when the build writes one.
 *
 * Read from the config alone, before a build: the skill archives a build
 * publishes beside the index, and the platform files (`_redirects`,
 * `_headers`, `vercel.json`), aren't listed. A page's Markdown copy
 * (`/guide.md`) is its route's, and resolves through the page.
 */
export const generatedFilePaths = (project: BlumeProject): string[] => {
  const { config } = project;
  const paths: string[] = [];
  if (config.agents.llmsTxt.enabled) {
    paths.push("/llms.txt", "/llms-full.txt");
  }
  paths.push(
    ...(buildSitemapFiles(project) ?? []).map((file) => `/${file.name}`)
  );
  if (buildRobots(project)) {
    paths.push("/robots.txt");
  }
  if (buildAgentReadability(project)) {
    paths.push("/agent-readability.json");
  }
  paths.push(
    ...wellKnownFiles(config, []).flatMap((file) =>
      file.content ? [file.path] : []
    )
  );
  if (servesSkillsIndex(config)) {
    paths.push(AGENT_SKILLS_INDEX_PATH);
    if (config.agents.skillMd) {
      paths.push(SKILL_MD_PATH);
    }
  }
  paths.push(...buildRssFeeds(project).map((feed) => feed.path));
  if (config.agents.api) {
    paths.push(OPENAPI_PATH, API_PAGES_PATH, API_NAVIGATION_PATH);
  }
  if (config.agents.mcp.enabled) {
    paths.push("/.well-known/mcp.json", "/.well-known/mcp/server-card.json");
  }
  return paths;
};

/**
 * Whether a base-less path is a file the project's site serves beside its
 * pages: one in `public/` (`/spec.pdf`, a folder's `index.html`) or one the
 * build generates (`/llms.txt`). What `generateRuntime` and `blume doctor`
 * check navigation entries against, beside the routes, as `blume validate`
 * checks links.
 */
export const servedFiles = (
  project: BlumeProject
): ((path: string) => boolean) =>
  staticFileResolver(
    join(project.context.root, "public"),
    generatedFilePaths(project)
  );
