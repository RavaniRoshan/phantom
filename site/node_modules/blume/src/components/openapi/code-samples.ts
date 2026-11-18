import { sampleLanguageInfo } from "./snippets.ts";
import type { SampleLanguageInfo } from "./snippets.ts";

/**
 * Hand-written code samples from a spec: the `x-codeSamples` extension on an
 * operation (Redocly's, which Mintlify, Speakeasy, and Stainless write too),
 * or its older spelling `x-code-samples`. Each entry names a `lang`, holds
 * the `source`, and may carry a `label`. They render as their own tabs ahead
 * of the generated samples and, being fixed text, the playground leaves them
 * as written.
 */

/** One hand-written sample, ready to render as a tab. */
export interface CustomCodeSample {
  /** A stable, unique tab key. */
  key: string;
  /** The tab label: the entry's own, else the language's name. */
  label: string;
  /** The Shiki language to highlight `source` with. */
  lang: string;
  source: string;
}

/** The two places an operation keeps them. */
export interface CodeSamplesCarrier {
  "x-code-samples"?: unknown;
  "x-codeSamples"?: unknown;
}

interface RawSample {
  label?: string;
  lang: string;
  source: string;
}

const isRawSample = (value: unknown): value is RawSample =>
  typeof value === "object" &&
  value !== null &&
  "lang" in value &&
  typeof value.lang === "string" &&
  "source" in value &&
  typeof value.source === "string" &&
  (!("label" in value) || typeof value.label === "string");

// Shell tools in an `x-codeSamples` entry are usually an SDK's CLI, not curl,
// so they're named for the shell rather than "cURL".
const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh"]);

/** The display name and highlighter for a sample's `lang`. */
const describe = (lang: string): SampleLanguageInfo => {
  const lower = lang.toLowerCase();
  if (SHELL_LANGS.has(lower)) {
    return { label: "Shell", lang: "bash" };
  }
  // A language Blume doesn't generate keeps its own name, and Shiki tries
  // it as written (it knows most languages by their common names).
  return sampleLanguageInfo(lower) ?? { label: lang, lang: lower };
};

/**
 * The operation's hand-written samples, with a unique tab label each. A label
 * two samples share gains its language (`List plants · JavaScript`), and one
 * that still repeats gains a number. Malformed entries are skipped.
 */
export const customCodeSamples = (
  operation: CodeSamplesCarrier
): CustomCodeSample[] => {
  const raw = operation["x-codeSamples"] ?? operation["x-code-samples"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries = raw.filter(isRawSample).map((entry) => {
    const language = describe(entry.lang);
    return {
      base: entry.label?.trim() || language.label,
      language,
      source: entry.source.replace(/\n$/u, ""),
    };
  });
  const counts = new Map<string, number>();
  for (const { base } of entries) {
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const used = new Set<string>();
  return entries.map(({ base, language, source }, index) => {
    const first =
      (counts.get(base) ?? 0) > 1 && base !== language.label
        ? `${base} · ${language.label}`
        : base;
    let label = first;
    for (let n = 2; used.has(label); n += 1) {
      label = `${first} (${n})`;
    }
    used.add(label);
    return { key: `x-${index}`, label, lang: language.lang, source };
  });
};
