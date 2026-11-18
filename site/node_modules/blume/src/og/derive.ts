/**
 * Bridges `theme.fonts` into the OG card renderer. A site that explicitly
 * picks its typefaces gets matching cards (and non-Latin coverage) without
 * configuring `seo.og.fonts`; untouched defaults derive nothing, so plain
 * sites keep Takumi's built-in font. Either way every card gets a Noto
 * fallback stack for the scripts that font can't draw (Japanese, Hindi,
 * Russian, …), which it fetches only when its text needs one.
 */

import { existsSync } from "node:fs";

import { isAbsolute, join } from "pathe";

import type {
  FontsConfig,
  FontValue,
  LocalFontConfig,
} from "../theme/fonts.ts";
import { GOOGLE_FONTS, isFontSlug, localeFontSubsets } from "../theme/fonts.ts";
import type { OgFont, OgFontFamilies, OgLocalFont } from "./card.ts";

/** Fonts, script fallbacks, and per-role families for the OG endpoint. */
export interface DerivedOgFonts {
  families?: OgFontFamilies;
  fallbacks?: OgFallbackFont[];
  fonts: OgFont[];
}

/** The weights the card actually renders at (title 600, everything else 400). */
const CARD_WEIGHTS = [400, 600];

/** Resolve a config path against the project root. */
const absoluteSrc = (root: string, src: string): string =>
  isAbsolute(src) ? src : join(root, src);

/** A concrete numeric face weight (as opposed to a variable-range string). */
const isNumericWeight = (
  weight: number | string | undefined
): weight is number => typeof weight === "number";

/** A variable-range weight spec string, e.g. `"100..900"`. */
const isRangeWeight = (weight: number | string | undefined): weight is string =>
  typeof weight === "string";

/** A theme role configured as a font slug / family-name string. */
const isFontName = (value: FontValue): value is string =>
  typeof value === "string";

/** An OG font entry that reads a local file (as opposed to a Google family). */
const isLocalOgFont = (font: OgFont): font is OgLocalFont =>
  typeof font !== "string" && "src" in font;

/**
 * The weight spec to fetch for a derived Google family: the declared weights
 * the card uses, the declared numeric weights otherwise, a lone variable
 * range as-is, or nothing (family default) as the last resort.
 */
const googleWeights = (
  weights: (number | string)[]
): number[] | string | undefined => {
  const numbers = weights.filter(isNumericWeight);
  const used = numbers.filter((weight) => CARD_WEIGHTS.includes(weight));
  if (used.length > 0) {
    return used;
  }
  if (numbers.length > 0) {
    return numbers;
  }
  const [first] = weights;
  return weights.length === 1 && isRangeWeight(first) ? first : undefined;
};

const googleOgFont = (name: string, weights: (number | string)[]): OgFont => {
  const weight = googleWeights(weights);
  return weight === undefined ? { name } : { name, weight };
};

/** Per-variant local entries for the renderer (paths made absolute). */
const localOgFonts = (font: LocalFontConfig, root: string): OgLocalFont[] =>
  font.variants.map((variant) => {
    const entry: OgLocalFont = {
      name: font.name,
      src: absoluteSrc(root, variant.src),
    };
    const withWeight: OgLocalFont = isNumericWeight(variant.weight)
      ? { ...entry, weight: variant.weight }
      : entry;
    // Takumi's per-face style is normal/italic; oblique falls back to the file.
    return variant.style === "normal" || variant.style === "italic"
      ? { ...withWeight, style: variant.style }
      : withWeight;
  });

/**
 * The card fonts for one theme role, or null when the role can't flow into
 * the renderer (an unknown slug string, or a provider Takumi can't fetch —
 * `googleFonts` only speaks Google's css2 endpoint).
 */
const roleFonts = (value: FontValue, root: string): OgFont[] | null => {
  if (isFontName(value)) {
    if (!isFontSlug(value)) {
      return null;
    }
    const def = GOOGLE_FONTS[value];
    return [googleOgFont(def.family, def.weights)];
  }
  if ("variants" in value) {
    return localOgFonts(value, root);
  }
  if ((value.provider ?? "google") !== "google") {
    return null;
  }
  return [googleOgFont(value.name, value.weights ?? CARD_WEIGHTS)];
};

/** The family name a theme role registers under. */
const roleFamily = (value: FontValue): string | null => {
  if (isFontName(value)) {
    return isFontSlug(value) ? GOOGLE_FONTS[value].family : null;
  }
  return value.name;
};

/**
 * Derive the OG card fonts from the theme's display and body roles (the two
 * the card renders), deduped, plus the per-role family names so the title
 * keeps the display face and the body text the body face.
 */
export const deriveOgFonts = (
  fonts: FontsConfig,
  root: string
): DerivedOgFonts => {
  const derived: OgFont[] = [];
  const seen = new Set<string>();
  const families: OgFontFamilies = {};

  const roles = [
    ["title", fonts?.display],
    ["body", fonts?.body],
  ] as const;
  for (const [role, value] of roles) {
    if (value === undefined) {
      continue;
    }
    const roleEntries = roleFonts(value, root);
    if (!roleEntries) {
      continue;
    }
    families[role] = roleFamily(value) ?? undefined;
    for (const entry of roleEntries) {
      const key = JSON.stringify(entry);
      if (!seen.has(key)) {
        seen.add(key);
        derived.push(entry);
      }
    }
  }

  const result: DerivedOgFonts = { fonts: derived };
  if (families.title || families.body) {
    result.families = families;
  }
  return result;
};

/**
 * The family Takumi renders a card in when no font is loaded: its embedded
 * Geist, which covers Latin only. Naming it keeps a card's Latin text in that
 * face once fallbacks are loaded, since Takumi otherwise tries loaded fonts
 * first; a glyph Geist lacks still falls back to them. Were Takumi to rename
 * it, the name would resolve to nothing and cards would fall back to the
 * loaded fonts, never to tofu.
 */
const BUILT_IN_FAMILY = "Geist";

/**
 * The Google Noto family that draws each language's script, keyed by BCP 47
 * language subtag, for scripts beyond the Latin, Cyrillic, Greek, and
 * Vietnamese that `Noto Sans` covers (see {@link localeFamily}). Keep keys
 * alphabetical.
 */
const SCRIPT_FAMILIES = {
  am: "Noto Sans Ethiopic",
  ar: "Noto Sans Arabic",
  as: "Noto Sans Bengali",
  bn: "Noto Sans Bengali",
  ckb: "Noto Sans Arabic",
  fa: "Noto Sans Arabic",
  gu: "Noto Sans Gujarati",
  he: "Noto Sans Hebrew",
  hi: "Noto Sans Devanagari",
  hy: "Noto Sans Armenian",
  ja: "Noto Sans JP",
  ka: "Noto Sans Georgian",
  km: "Noto Sans Khmer",
  kn: "Noto Sans Kannada",
  ko: "Noto Sans KR",
  lo: "Noto Sans Lao",
  ml: "Noto Sans Malayalam",
  mr: "Noto Sans Devanagari",
  my: "Noto Sans Myanmar",
  ne: "Noto Sans Devanagari",
  or: "Noto Sans Oriya",
  pa: "Noto Sans Gurmukhi",
  ps: "Noto Sans Arabic",
  sa: "Noto Sans Devanagari",
  si: "Noto Sans Sinhala",
  ta: "Noto Sans Tamil",
  te: "Noto Sans Telugu",
  th: "Noto Sans Thai",
  ti: "Noto Sans Ethiopic",
  ur: "Noto Sans Arabic",
  yi: "Noto Sans Hebrew",
  zh: "Noto Sans SC",
} satisfies Record<string, string>;

/** Type guard: does `language` have an entry in the script table? */
const isScriptLanguage = (
  language: string
): language is keyof typeof SCRIPT_FAMILIES =>
  Object.hasOwn(SCRIPT_FAMILIES, language);

/** A script fallback: a Google family at the weights the card renders. */
export interface OgFallbackFont {
  name: string;
  weight: number[];
}

/** Subtags that write Chinese in traditional characters (`zh-Hant`, `zh-TW`). */
const TRADITIONAL_CHINESE = new Set(["hant", "hk", "mo", "tw"]);

/** The Noto family for one locale's script, or null when Geist covers it. */
const localeFamily = (locale: string): string | null => {
  const [language = "", ...subtags] = locale.toLowerCase().split("-");
  if (
    language === "zh" &&
    subtags.some((tag) => TRADITIONAL_CHINESE.has(tag))
  ) {
    return "Noto Sans TC";
  }
  if (isScriptLanguage(language)) {
    return SCRIPT_FAMILIES[language];
  }
  // Anything past plain `latin` in the theme's subset table (Polish, Russian,
  // Greek, Vietnamese, …) needs glyphs Geist lacks and `Noto Sans` has.
  return localeFontSubsets([locale]).length > 1 ? "Noto Sans" : null;
};

/**
 * Every script's fallback, in the order a card tries them: `Noto Sans` for
 * extended Latin, Cyrillic, Greek, and Vietnamese, then a family per script.
 * The CJK families all draw Han ideographs, so the first one wins them —
 * Japanese forms, unless a configured locale moves its own family ahead.
 */
const DEFAULT_FALLBACKS = [
  "Noto Sans",
  ...new Set(Object.values(SCRIPT_FAMILIES)),
  "Noto Sans TC",
];

/**
 * The card's script fallbacks, at the card's weights: each configured
 * locale's family first, so a Chinese site draws Han in Chinese forms, then
 * every other script's, so a page in a language the site never configured
 * still renders instead of tofu. Takumi's built-in font covers only basic
 * Latin; the card fetches these only when its text needs a glyph beyond it,
 * and then only the families and subsets that glyph needs.
 */
export const ogFallbackFonts = (locales: string[]): OgFallbackFont[] => {
  const names = new Set<string>();
  for (const family of [...locales.map(localeFamily), ...DEFAULT_FALLBACKS]) {
    if (family) {
      names.add(family);
    }
  }
  return [...names].map((name) => ({ name, weight: CARD_WEIGHTS }));
};

/** A bare Google family name entry (as opposed to the object forms). */
const isGoogleFamilyName = (font: OgFont): font is string =>
  typeof font === "string";

/** The family an OG font entry registers under. */
const ogFontName = (font: OgFont): string =>
  isGoogleFamilyName(font) ? font : font.name;

/**
 * `derived` plus the script fallbacks it doesn't already load. A card that
 * names no family is pinned to {@link BUILT_IN_FAMILY}, so its Latin text
 * keeps the face it had before any fallback was loaded.
 */
const withFallbacks = (
  derived: DerivedOgFonts,
  locales: string[]
): DerivedOgFonts => {
  const loaded = new Set(derived.fonts.map(ogFontName));
  return {
    fallbacks: ogFallbackFonts(locales).filter(
      (font) => !loaded.has(font.name)
    ),
    families: derived.families ?? {
      body: BUILT_IN_FAMILY,
      title: BUILT_IN_FAMILY,
    },
    fonts: derived.fonts,
  };
};

/** Explicit `seo.og.fonts` with local `src` paths resolved to absolute. */
export const resolveOgFontSources = (fonts: OgFont[], root: string): OgFont[] =>
  fonts.map((font) =>
    isLocalOgFont(font) ? { ...font, src: absoluteSrc(root, font.src) } : font
  );

/**
 * The fonts baked into the generated OG endpoint. An explicit `seo.og.fonts`
 * always wins (including `[]` to opt out, keeping the card's role styling
 * untouched); otherwise a site that explicitly set `theme.fonts` gets its
 * display/body fonts derived so cards match the site without extra config,
 * and either way every card gets the script fallbacks, the configured
 * locales' first.
 */
export const resolveOgFonts = (
  options: {
    /** The site's configured locale codes (none without `i18n`). */
    locales?: string[];
    /** Explicit `seo.og.fonts`, or undefined when unset. */
    ogFonts: OgFont[] | undefined;
    themeFonts: FontsConfig;
    /** Whether the config file set `theme.fonts` itself (gates derivation). */
    themeFontsConfigured: boolean;
  },
  root: string
): DerivedOgFonts => {
  if (options.ogFonts) {
    return { fonts: resolveOgFontSources(options.ogFonts, root) };
  }
  const derived = options.themeFontsConfigured
    ? deriveOgFonts(options.themeFonts, root)
    : { fonts: [] };
  return withFallbacks(derived, options.locales ?? []);
};

/**
 * Every configured local font file (theme roles and `seo.og.fonts`) that is
 * missing on disk, as absolute paths. Generation fails on these up front — the
 * alternative is Astro or the OG renderer crashing later with a bare ENOENT.
 */
export const missingFontFiles = (
  options: { ogFonts: OgFont[]; themeFonts: FontsConfig },
  root: string
): string[] => {
  const sources: string[] = [];
  for (const value of Object.values(options.themeFonts ?? {})) {
    if (!isFontName(value) && "variants" in value) {
      sources.push(
        ...value.variants.map((variant) => absoluteSrc(root, variant.src))
      );
    }
  }
  for (const font of options.ogFonts) {
    if (isLocalOgFont(font)) {
      sources.push(absoluteSrc(root, font.src));
    }
  }
  return [...new Set(sources)].filter((path) => !existsSync(path));
};
