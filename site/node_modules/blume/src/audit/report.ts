import { colors } from "consola/utils";
import type { ColorFunction } from "consola/utils";
import { relative } from "pathe";

import { countBySeverity } from "../core/diagnostics.ts";
import type { Diagnostic, DiagnosticSeverity } from "../core/types.ts";
import { CHECKS, checkMeta } from "./catalog.ts";
import type { CheckId } from "./catalog.ts";
import type { AuditResult } from "./run.ts";
import { checkSelected } from "./terms.ts";
import type { AuditCategory, AuditTier } from "./types.ts";

const SEVERITY_COLOR = {
  error: colors.red,
  info: colors.blue,
  warning: colors.yellow,
} satisfies Record<DiagnosticSeverity, ColorFunction>;

const GLYPH = {
  error: "✖",
  info: "ℹ",
  warning: "⚠",
} satisfies Record<DiagnosticSeverity, string>;

/** How many affected pages to list before collapsing the rest. */
const PREVIEW = 3;

/** The skippable tiers, each with the flag that runs it. */
const TIER_FLAGS: { tier: AuditTier; flag: string }[] = [
  { flag: "--external", tier: "external" },
  { flag: "--url <origin>", tier: "network" },
];

interface CheckRollup {
  id: CheckId;
  count: number;
  /** Distinct affected URLs — one page can carry several findings. */
  pages: number;
  severity: DiagnosticSeverity;
  category: AuditCategory;
  title: string;
  findings: Diagnostic[];
}

const SEVERITY_ORDER = {
  error: 0,
  info: 2,
  warning: 1,
} satisfies Record<DiagnosticSeverity, number>;

/**
 * The group's severity: the worst of its findings'. A check can downgrade a
 * finding at runtime (an external link answering 503 is a warning, not the
 * catalog's error), and the group's glyph must agree with the summary counts.
 */
const worstSeverity = (findings: Diagnostic[]): DiagnosticSeverity => {
  let worst: DiagnosticSeverity = "info";
  for (const finding of findings) {
    if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[worst]) {
      worst = finding.severity;
    }
  }
  return worst;
};

/** The first finding per affected URL, in report order. */
const firstPerPage = (findings: Diagnostic[]): Diagnostic[] => {
  const seen = new Set<string | undefined>();
  return findings.filter((finding) => {
    if (seen.has(finding.url)) {
      return false;
    }
    seen.add(finding.url);
    return true;
  });
};

/**
 * Group findings by check. This is the difference between a report people read
 * and one they close: 214 pages × 6 findings is an unreadable wall, but "Meta
 * description missing — 12 pages" is a to-do list.
 */
export const rollup = (diagnostics: Diagnostic[]): CheckRollup[] => {
  const groups = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const group = groups.get(diagnostic.code);
    if (group) {
      group.push(diagnostic);
    } else {
      groups.set(diagnostic.code, [diagnostic]);
    }
  }

  const checks = [...groups.entries()].map(([id, findings]) => {
    // SAFETY: audit findings are only ever created through `finding()`, whose
    // codes are the check catalog's ids.
    const checkId = id as CheckId;
    const { category, title } = checkMeta(checkId);
    return {
      category,
      count: findings.length,
      findings,
      id: checkId,
      pages: firstPerPage(findings).length,
      severity: worstSeverity(findings),
      title,
    };
  });

  // Rank each category by the worst thing in it, so the categories that need
  // attention lead. Sorting on severity alone would interleave the categories
  // and print "content" three separate times.
  const worst = new Map<AuditCategory, number>();
  for (const check of checks) {
    const rank = SEVERITY_ORDER[check.severity];
    worst.set(
      check.category,
      Math.min(worst.get(check.category) ?? rank, rank)
    );
  }

  return checks.toSorted(
    (a, b) =>
      (worst.get(a.category) ?? 0) - (worst.get(b.category) ?? 0) ||
      a.category.localeCompare(b.category) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.count - a.count
  );
};

/** Categories that had no findings but were never run, and the flag that runs them. */
const skippedTiers = (result: AuditResult): string[] =>
  TIER_FLAGS.flatMap(({ flag, tier }) => {
    // Only the checks `--only`/`--skip` left in would have run.
    const count = CHECKS.filter(
      (check) => check.tier === tier && checkSelected(check.id, result)
    ).length;
    return result.tiers[tier] || count === 0
      ? []
      : [
          `  ${colors.dim(`⊘ ${tier.padEnd(12)} skipped — pass ${flag} (${count} checks)`)}`,
        ];
  });

/**
 * How many checks the report covers: those whose tier was enabled, and that
 * `--only`/`--skip` left in.
 */
const activeChecks = (result: AuditResult): number =>
  CHECKS.filter(
    (check) => result.tiers[check.tier] && checkSelected(check.id, result)
  ).length;

/**
 * Individual checks performed: every rule that ran, against every page crawled.
 * The headline number — it's what makes "39 warnings" legible as a proportion
 * rather than a bare count.
 */
export const auditCount = (result: AuditResult): number =>
  activeChecks(result) * result.pages;

const summaryLine = (
  counts: Record<DiagnosticSeverity, number>,
  audits: number
): string =>
  [
    `${audits.toLocaleString("en-US")} audit${audits === 1 ? "" : "s"}`,
    `${counts.error} error${counts.error === 1 ? "" : "s"}`,
    `${counts.warning} warning${counts.warning === 1 ? "" : "s"}`,
    `${counts.info} note${counts.info === 1 ? "" : "s"}`,
  ].join(" · ");

/** One affected page: the URL, and the source file that fixes it. */
const findingLine = (diagnostic: Diagnostic, root: string): string => {
  const url = diagnostic.url ?? "";
  const source = diagnostic.file
    ? colors.dim(
        `${relative(root, diagnostic.file)}${
          diagnostic.line === undefined ? "" : `:${diagnostic.line}`
        }`
      )
    : "";
  // padEnd alone yields no gap once the URL reaches the column width.
  return `      ${url.padEnd(34)} ${source}`.trimEnd();
};

/**
 * Render the audit as a report grouped by check, with each check's affected
 * pages, the source file to edit, and the fix.
 */
export const formatReport = (
  result: AuditResult,
  root: string,
  options: { verbose?: boolean } = {}
): string => {
  const counts = countBySeverity(result.diagnostics);
  const groups = rollup(result.diagnostics);
  const lines: string[] = [];

  const where = result.origin
    ? `${relative(root, result.staticDir) || "dist"} + ${result.origin}`
    : `${relative(root, result.staticDir) || "dist"} · offline`;
  lines.push(
    "",
    `  ${colors.bold("blume audit")}  ${colors.dim(`${result.pages} pages · ${where}`)}`,
    `  ${summaryLine(counts, auditCount(result))}`,
    ""
  );

  if (groups.length === 0) {
    lines.push(`  ${colors.green("✔ No issues found.")}`, "");
  }

  let category: AuditCategory | null = null;
  for (const group of groups) {
    const { category: next } = group;
    if (next !== category) {
      category = next;
      lines.push(`  ${colors.bold(category)}`, "");
    }

    const color = SEVERITY_COLOR[group.severity];
    const pages = `${group.pages} page${group.pages === 1 ? "" : "s"}`;
    lines.push(
      `  ${color(`${GLYPH[group.severity]} ${group.title}`)}  ${colors.dim(pages)}`
    );

    // The preview lists affected pages, each once; --verbose lists every
    // finding, since each one's message names a different specific.
    const shown = options.verbose
      ? group.findings
      : firstPerPage(group.findings).slice(0, PREVIEW);
    for (const diagnostic of shown) {
      lines.push(findingLine(diagnostic, root));
      // The message names the specifics the rolled-up line can't — which target
      // is broken, what the duplicate is — so --verbose prints it per finding.
      if (options.verbose) {
        lines.push(`        ${colors.dim(diagnostic.message)}`);
      }
    }
    const hidden = options.verbose ? 0 : group.pages - shown.length;
    if (hidden > 0) {
      lines.push(`      ${colors.dim(`… and ${hidden} more (--verbose)`)}`);
    }

    // Findings share the catalog's fix unless one overrode it (a navigation
    // entry, a page generated from an API spec), so each distinct fix is
    // printed once.
    const fixes = new Set(
      group.findings.flatMap((finding) =>
        finding.suggestion ? [finding.suggestion] : []
      )
    );
    for (const fix of fixes) {
      lines.push(`      ${colors.cyan(`fix: ${fix}`)}`);
    }
    lines.push("");
  }

  const skipped = skippedTiers(result);
  if (skipped.length > 0) {
    lines.push(...skipped, "");
  }

  return lines.join("\n");
};

/**
 * The machine-readable report. The existing `diagnostics` + `summary` shape is
 * preserved exactly — anything already parsing `blume validate --json` keeps
 * working — with the audit-specific rollup added alongside it.
 */
export const reportJson = (result: AuditResult, root: string): string => {
  const diagnostics = result.diagnostics.map((diagnostic) =>
    diagnostic.file
      ? { ...diagnostic, file: relative(root, diagnostic.file) }
      : diagnostic
  );
  return `${JSON.stringify(
    {
      audit: {
        /** Checks run × pages crawled — the total number of individual audits. */
        audits: auditCount(result),
        checks: rollup(result.diagnostics).map((group) => ({
          category: group.category,
          count: group.count,
          id: group.id,
          severity: group.severity,
        })),
        origin: result.origin,
        pages: result.pages,
        staticDir: relative(root, result.staticDir),
        tiers: result.tiers,
      },
      diagnostics,
      summary: countBySeverity(result.diagnostics),
    },
    null,
    2
  )}\n`;
};

/** `--list-checks`: the catalog, which is also the docs' source of truth. */
export const formatCatalog = (): string => {
  const lines: string[] = [""];
  let category: AuditCategory | null = null;
  for (const check of [...CHECKS].toSorted((a, b) =>
    a.category.localeCompare(b.category)
  )) {
    const { category: next } = check;
    if (next !== category) {
      category = next;
      lines.push(`  ${colors.bold(category)}`);
    }
    const tier =
      check.tier === "static" ? "" : ` ${colors.dim(`[${check.tier}]`)}`;
    lines.push(
      `    ${SEVERITY_COLOR[check.severity](GLYPH[check.severity])} ${check.id.replace("BLUME_AUDIT_", "").toLowerCase().padEnd(34)} ${colors.dim(check.title)}${tier}`
    );
  }
  lines.push("", `  ${CHECKS.length} checks.`, "");
  return lines.join("\n");
};
