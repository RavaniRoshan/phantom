import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { join } from "pathe";
import { z } from "zod";

import { BlumeError } from "../core/diagnostics.ts";
import { writeTextAtomic } from "../core/fs-atomic.ts";

/**
 * The committed translation ledger: which source files have been translated
 * into which locales, and at what source content. Named "ledger" to avoid
 * colliding with the route manifest (`core/manifest.ts`). It lives at the
 * project root — never inside `.blume/` (init gitignores that dir wholesale,
 * and the whole point is that the ledger is committed alongside the docs).
 */
export const LEDGER_FILE = "blume.translations.json";

/**
 * `files` maps a POSIX root-relative source path to, per locale, the hash of
 * the raw source text at the moment that locale's translation was written.
 */
export interface TranslationLedger {
  version: 1;
  files: Record<string, Record<string, string>>;
}

const ledgerSchema = z.object({
  files: z.record(z.string(), z.record(z.string(), z.string())),
  version: z.literal(1),
});

export const emptyLedger = (): TranslationLedger => ({
  files: {},
  version: 1,
});

/**
 * Hash the raw source text (frontmatter included), so any edit invalidates
 * every locale's stamp. sha256-16 like the audit snapshot's content hash.
 * Kept as its own function rather than sharing core's `hashText`: ledger
 * stamps persist in user repos, so this hash must never change shape when an
 * ephemeral cache hash does. CRLF line endings are normalized to LF first, so
 * a Windows checkout (`core.autocrlf`) hashes the same as everyone else's —
 * LF text hashes exactly as it always has.
 */
export const hashSource = (text: string): string =>
  createHash("sha256")
    .update(text.replaceAll("\r\n", "\n"))
    .digest("hex")
    .slice(0, 16);

/** A git merge-conflict marker line: `<<<<<<< ours`, `=======`, `>>>>>>> theirs`. */
const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7})(?:[ \r]|$)/mu;

/**
 * Read the ledger at `root`, tolerantly: a missing file, unparseable JSON, or
 * an unknown shape/version all resolve to an empty ledger rather than an error
 * (same posture as the dev lock's `parseLock`) — the worst outcome of a
 * corrupt ledger is retranslating files that were already up to date.
 *
 * Unresolved merge-conflict markers are the exception, and an error: read as
 * empty, every existing translation would be adopted as current, so
 * `--check` would pass over translations that are out of date.
 */
export const readLedger = async (root: string): Promise<TranslationLedger> => {
  const path = join(root, LEDGER_FILE);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return emptyLedger();
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    if (CONFLICT_MARKER.test(raw)) {
      throw new BlumeError({
        code: "BLUME_TRANSLATE_LEDGER_CONFLICT",
        file: path,
        message: `${LEDGER_FILE} has unresolved merge-conflict markers, so it can't say which translations are current.`,
        severity: "error",
        suggestion: `Resolve the merge conflict in ${LEDGER_FILE}, then rerun.`,
      });
    }
    return emptyLedger();
  }
  const parsed = ledgerSchema.safeParse(data);
  return parsed.success ? parsed.data : emptyLedger();
};

/** Deterministic serialization: keys sorted at both levels, 2-space indent. */
export const serializeLedger = (ledger: TranslationLedger): string => {
  const files: Record<string, Record<string, string>> = {};
  for (const source of Object.keys(ledger.files).toSorted()) {
    const locales = ledger.files[source] ?? {};
    files[source] = Object.fromEntries(
      Object.keys(locales)
        .toSorted()
        .map((locale) => [locale, locales[locale] ?? ""])
    );
  }
  return `${JSON.stringify({ files, version: ledger.version }, null, 2)}\n`;
};

/**
 * Write the ledger at `root`, returning whether anything changed on disk. A
 * byte-identical ledger is left untouched (no mtime churn, no git noise);
 * a changed one lands via temp-file-plus-rename so a concurrent reader never
 * observes a half-written file.
 */
export const writeLedger = async (
  root: string,
  ledger: TranslationLedger
): Promise<boolean> => {
  const path = join(root, LEDGER_FILE);
  const content = serializeLedger(ledger);
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf-8");
  } catch {
    existing = null;
  }
  if (existing === content) {
    return false;
  }
  await writeTextAtomic(path, content);
  return true;
};

/** Record that `sourceRel` is translated into `locale` at source hash `hash`. */
export const stampLedger = (
  ledger: TranslationLedger,
  sourceRel: string,
  locale: string,
  hash: string
): void => {
  const locales = ledger.files[sourceRel] ?? {};
  locales[locale] = hash;
  ledger.files[sourceRel] = locales;
};

/**
 * Drop entries for sources that no longer exist and locales that are no longer
 * configured, so deleted pages and removed locales don't linger in the ledger
 * forever. Returns a new ledger.
 */
export const pruneLedger = (
  ledger: TranslationLedger,
  knownSources: ReadonlySet<string>,
  knownLocales: ReadonlySet<string>
): TranslationLedger => {
  const files: Record<string, Record<string, string>> = {};
  for (const [source, locales] of Object.entries(ledger.files)) {
    if (!knownSources.has(source)) {
      continue;
    }
    const kept = Object.fromEntries(
      Object.entries(locales).filter(([locale]) => knownLocales.has(locale))
    );
    if (Object.keys(kept).length > 0) {
      files[source] = kept;
    }
  }
  return { files, version: ledger.version };
};
