import { readFile } from "node:fs/promises";

import pMap from "p-map";

import { normalizeBasePath } from "../core/base-path.ts";
import { routeSetFor } from "../core/locale-links.ts";
import type { BlumeProject } from "../core/project-graph.ts";
import type { Diagnostic } from "../core/types.ts";
import { deployStaticDir } from "../deploy/adapter-output.ts";
import { applyBaseToAstroRedirects } from "../deploy/redirects.ts";
import type { CheckId } from "./catalog.ts";
import { assetChecks } from "./checks/assets.ts";
import { contentChecks } from "./checks/content.ts";
import { contrastChecks } from "./checks/contrast.ts";
import { dnsAidChecks } from "./checks/dns-aid.ts";
import { duplicateChecks } from "./checks/duplicates.ts";
import { i18nChecks } from "./checks/i18n.ts";
import { indexabilityChecks } from "./checks/indexability.ts";
import { linkChecks } from "./checks/links.ts";
import { llmsChecks } from "./checks/llms.ts";
import { externalChecks, networkChecks } from "./checks/network.ts";
import { ogImageChecks } from "./checks/og-image.ts";
import { redirectChecks } from "./checks/redirects.ts";
import { robotsChecks } from "./checks/robots.ts";
import { sitemapChecks } from "./checks/sitemap.ts";
import {
  socialChecks,
  structuredDataChecks,
  urlChecks,
} from "./checks/social.ts";
import { crawlStaticDir } from "./crawl.ts";
import { buildGraph } from "./graph.ts";
import { resolveRedirects } from "./redirects.ts";
import { checkSelected } from "./terms.ts";
import { DEFAULT_THRESHOLDS } from "./types.ts";
import type {
  AuditContext,
  AuditTier,
  CheckModule,
  PageSnapshot,
} from "./types.ts";
import { isServed, siteOrigin } from "./url.ts";

const MODULES: CheckModule[] = [
  contentChecks,
  duplicateChecks,
  indexabilityChecks,
  linkChecks,
  redirectChecks,
  socialChecks,
  ogImageChecks,
  i18nChecks,
  assetChecks,
  contrastChecks,
  sitemapChecks,
  robotsChecks,
  llmsChecks,
  structuredDataChecks,
  urlChecks,
  networkChecks,
  dnsAidChecks,
  externalChecks,
];

export interface AuditOptions {
  project: BlumeProject;
  /** Origin to probe for the network tier (`--url`). */
  origin?: string;
  /** Probe outbound links (`--external`). */
  external?: boolean;
  /** Outbound URLs not to probe (`--ignore`). */
  ignore?: (url: string) => boolean;
  /** Only report these check ids or categories. */
  only?: string[];
  /** Suppress these check ids or categories. */
  skip?: string[];
}

export interface AuditResult {
  diagnostics: Diagnostic[];
  staticDir: string;
  pages: number;
  origin: string | null;
  /** Which tiers actually ran. A skipped tier is reported, never hidden. */
  tiers: Record<AuditTier, boolean>;
  /** The `--only` terms the findings were filtered to, if any. */
  only?: string[];
  /** The `--skip` terms the findings were filtered by, if any. */
  skip?: string[];
}

/** Thrown when there's no build to audit. */
export class NoBuildError extends Error {
  readonly staticDir: string;

  constructor(staticDir: string) {
    super(`No build found at ${staticDir}.`);
    this.name = "NoBuildError";
    this.staticDir = staticDir;
  }
}

/** Ceiling on concurrent source reads; unbounded fan-out risks EMFILE. */
const READ_CONCURRENCY = 16;

/** Read every page's source file once, so findings can cite front matter lines. */
const readSources = async (
  pages: PageSnapshot[]
): Promise<Map<string, string>> => {
  const paths = [
    ...new Set(pages.flatMap((page) => (page.source ? [page.source] : []))),
  ];
  const entries = await pMap(
    paths,
    async (path) => {
      try {
        return [path, await readFile(path, "utf-8")] as const;
      } catch {
        // A staged (non-filesystem) source may not exist on disk. The finding
        // still names the URL; it just can't cite a line.
        return null;
      }
    },
    { concurrency: READ_CONCURRENCY }
  );
  return new Map(entries.filter((entry) => entry !== null));
};

/** Audit a built site. */
export const runAudit = async (options: AuditOptions): Promise<AuditResult> => {
  const { project } = options;
  const staticDir = deployStaticDir(project.config, project.context);
  const basePath = normalizeBasePath(project.config.basePath);

  const crawl = await crawlStaticDir({
    basePath,
    deployBase: normalizeBasePath(project.config.deployment.options.base),
    manifest: project.manifest,
    staticDir,
  });
  if (crawl.pages.length === 0) {
    throw new NoBuildError(staticDir);
  }

  const origin = options.origin ?? null;
  const byUrl = new Map(crawl.pages.map((page) => [page.url, page]));
  const context: AuditContext = {
    byUrl,
    files: crawl.files,
    graph: buildGraph(
      crawl.pages,
      siteOrigin(project.config.deployment.options.site),
      normalizeBasePath(project.config.deployment.options.base)
    ),
    ignore: options.ignore ?? (() => false),
    llms: crawl.llms,
    origin,
    pages: crawl.pages,
    project,
    redirects: resolveRedirects(
      // Redirects are authored as if mounted at root; the built page URLs they
      // are checked against carry `basePath` (it's a real directory in the
      // build), so both sides gain it here, based exactly as the build bases
      // them — a `to` naming a public file stays at the root, and external
      // `to` URLs pass through.
      applyBaseToAstroRedirects(
        project.config.redirects,
        basePath,
        "",
        routeSetFor(project.manifest.routes)
      ),
      // Pages, static files, and server routes alike: a redirect may
      // legitimately land on a served asset (`/old-whitepaper` ->
      // `/files/whitepaper.pdf`), and the same predicate the link and llms.txt
      // checks use decides what counts.
      (path) => isServed({ byUrl, files: crawl.files, project }, path)
    ),
    robots: crawl.robots,
    sitemap: crawl.sitemap,
    sources: await readSources(crawl.pages),
    staticDir,
    thresholds: DEFAULT_THRESHOLDS,
  };

  const tiers = {
    external: Boolean(options.external),
    network: origin !== null,
    static: true,
  } satisfies Record<AuditTier, boolean>;

  const results = await Promise.all(
    MODULES.filter((module) => tiers[module.tier]).map((module) =>
      module.run(context)
    )
  );

  // SAFETY: audit diagnostics are created through `finding()`, whose codes
  // all come from the check catalog's `CheckId` set.
  const diagnostics = results
    .flat()
    .filter((d) => checkSelected(d.code as CheckId, options));

  return {
    diagnostics,
    only: options.only,
    origin,
    pages: crawl.pages.length,
    skip: options.skip,
    staticDir,
    tiers,
  };
};
