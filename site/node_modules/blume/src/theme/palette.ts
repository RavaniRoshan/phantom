import type { ResolvedConfig } from "../core/schema.ts";
import { composite, contrastRatio, isCssColor, parseColor } from "./color.ts";
import type { Rgba } from "./color.ts";

/** Per-mode CSS colors. */
export interface AccentColors {
  dark: string;
  light: string;
}

/** A color mode. */
export type ColorMode = keyof AccentColors;

/**
 * Named accent presets mapped to OKLCH values, per mode. The single source of
 * truth for preset colors: the theme CSS and the OG card (og/card.ts) both
 * resolve from this table, so a site and its social cards can't disagree
 * about "blue". Each clears WCAG AA (4.5:1) as text on its mode's page and
 * under its button label ({@link readableOn}), with room to spare on the
 * tinted surfaces accent text also sits on: the light shades are dark enough
 * for white labels, the dark shades light enough to read on the dark page.
 */
export const ACCENTS = {
  blue: { dark: "oklch(0.62 0.16 250)", light: "oklch(0.55 0.16 250)" },
  green: { dark: "oklch(0.6 0.16 150)", light: "oklch(0.53 0.16 150)" },
  orange: { dark: "oklch(0.68 0.17 50)", light: "oklch(0.56 0.17 50)" },
  pink: { dark: "oklch(0.65 0.2 350)", light: "oklch(0.58 0.2 350)" },
  purple: { dark: "oklch(0.6 0.2 290)", light: "oklch(0.57 0.2 290)" },
  red: { dark: "oklch(0.61 0.22 25)", light: "oklch(0.58 0.22 25)" },
  teal: { dark: "oklch(0.6 0.12 195)", light: "oklch(0.53 0.12 195)" },
} satisfies Record<string, AccentColors>;

/** The contrast WCAG AA asks of body-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * The theme's own colors a configured accent is drawn against: each mode's
 * page background and text, and the dark ink a filled accent can carry.
 * Mirrors the defaults in `entry.ts`.
 */
export const THEME_INKS = {
  dark: {
    background: "oklch(0.085 0 0)",
    foreground: "oklch(0.96 0 0)",
    ink: "oklch(0.085 0 0)",
    mutedForeground: "oklch(0.68 0 0)",
  },
  light: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    ink: "oklch(0.145 0 0)",
    mutedForeground: "oklch(0.53 0 0)",
  },
} satisfies Record<ColorMode, Record<string, string>>;

const WHITE = "oklch(1 0 0)";

/** A color this module writes itself, parsed (they all parse). */
const own = (value: string): Rgba =>
  parseColor(value) ?? { alpha: 1, blue: 0, green: 0, red: 0 };

/** {@link THEME_INKS}, parsed, for contrast math. */
export const themeInk = (
  mode: ColorMode,
  name: keyof (typeof THEME_INKS)[ColorMode]
): Rgba => own(THEME_INKS[mode][name]);

/**
 * The label color for text on a filled `fill` (a button, a step number): white
 * while it reaches AA, else the mode's dark ink when that reads better, so a
 * light accent (every dark-mode preset) gets dark text instead of white text
 * nobody can read.
 */
export const labelOn = (fill: Rgba, mode: ColorMode): string => {
  const opaque = composite(fill, themeInk(mode, "background"));
  const onWhite = contrastRatio(own(WHITE), opaque);
  return onWhite >= MIN_TEXT_CONTRAST ||
    onWhite >= contrastRatio(themeInk(mode, "ink"), opaque)
    ? WHITE
    : THEME_INKS[mode].ink;
};

/** {@link labelOn} for a CSS color; one this module can't parse keeps white. */
export const readableOn = (fill: string, mode: ColorMode): string => {
  const color = parseColor(fill);
  return color ? labelOn(color, mode) : WHITE;
};

/**
 * Whether a raw config value names an accent preset. `hasOwn` keeps a value
 * like "constructor" from resolving an Object.prototype member — which would
 * stringify a function into the generated CSS, breaking the rule (the exact
 * breakout {@link safeColor} exists to prevent).
 */
export const isAccentPreset = (value: string): value is keyof typeof ACCENTS =>
  Object.hasOwn(ACCENTS, value);

// Characters valid in a CSS color value (hex, rgb/hsl/oklch functions, named
// colors). Anything else — notably `;`, `{`, `}` — could break out of the
// declaration and inject rules, so such a value is rejected.
const CSS_COLOR = /^[\w\s#%.,()/+-]+$/u;

/** Pass a raw color through only if it can't break out of a CSS declaration. */
const safeColor = (value: string, fallback: string): string =>
  CSS_COLOR.test(value.trim()) ? value.trim() : fallback;

/** Resolve a named preset in `mode`, or fall back to {@link safeColor}. */
const presetOrColor = (value: string, mode: ColorMode): string =>
  isAccentPreset(value)
    ? ACCENTS[value][mode]
    : safeColor(value, ACCENTS.blue[mode]);

/** Like {@link safeColor} but drops an unsafe/absent value to `null`. */
const safeColorOrNull = (value: string | undefined): string | null =>
  value && CSS_COLOR.test(value.trim()) ? value.trim() : null;

const RADII = {
  lg: "0.75rem",
  md: "0.5rem",
  none: "0",
  sm: "0.25rem",
} satisfies Record<ResolvedConfig["theme"]["radius"], string>;

const cssString = (value: string): string => JSON.stringify(value);

const backgroundImageCss = (image: string): string =>
  `url(${cssString(image)})`;

const cssToken = (name: string, value?: string | null): string[] =>
  value ? [`  ${name}: ${value};`] : [];

/** One mode's resolved accent and action fills. */
interface ModeFills {
  accent: string;
  action: string | null;
}

const themeRootCss = (
  theme: ResolvedConfig["theme"],
  options: ModeFills & { radius: string }
): string =>
  [
    `  --blume-accent: ${options.accent};`,
    `  --blume-accent-foreground: ${readableOn(options.accent, "light")};`,
    ...cssToken("--blume-action", options.action),
    ...cssToken(
      "--blume-action-foreground",
      options.action ? readableOn(options.action, "light") : null
    ),
    ...cssToken("--blume-background", safeColorOrNull(theme.background?.light)),
    ...cssToken(
      "--blume-background-image",
      theme.backgroundImage?.light
        ? backgroundImageCss(theme.backgroundImage.light)
        : null
    ),
    `  --blume-radius: ${options.radius};`,
  ]
    .filter(Boolean)
    .join("\n");

const themeDarkCss = (
  theme: ResolvedConfig["theme"],
  options: ModeFills
): string => {
  // Mode-shared tokens (accent, action) must be re-declared here: the base
  // stylesheet's own `:root[data-theme="dark"]` block outranks the `:root`
  // config tokens on specificity, so without this block dark mode would
  // silently keep its neutral defaults and ignore the config.
  const tokens = [
    `  --blume-accent: ${options.accent};`,
    `  --blume-accent-foreground: ${readableOn(options.accent, "dark")};`,
    ...cssToken("--blume-action", options.action),
    ...cssToken(
      "--blume-action-foreground",
      options.action ? readableOn(options.action, "dark") : null
    ),
    ...cssToken("--blume-background", safeColorOrNull(theme.background?.dark)),
    ...cssToken(
      "--blume-background-image",
      theme.backgroundImage?.dark
        ? backgroundImageCss(theme.backgroundImage.dark)
        : null
    ),
  ].filter(Boolean);
  return `:root[data-theme="dark"] {
${tokens.join("\n")}
}
`;
};

/**
 * Resolve the configured accent to per-mode CSS colors. A named accent
 * resolves to its preset's shade for each mode; any other value is treated as
 * a raw CSS color so users can pass arbitrary colors without a config change.
 * A string accent has already been normalized by the config schema to the
 * same value for both modes.
 */
export const resolveAccent = (
  theme: ResolvedConfig["theme"]
): AccentColors => ({
  dark: presetOrColor(theme.accent.dark, "dark"),
  light: presetOrColor(theme.accent.light, "light"),
});

/** Resolve the configured `action` fill per mode, or `null` when unset. */
export const resolveAction = (
  theme: ResolvedConfig["theme"]
): AccentColors | null =>
  theme.action
    ? {
        dark: presetOrColor(theme.action, "dark"),
        light: presetOrColor(theme.action, "light"),
      }
    : null;

/** Resolve the configured radius preset to a CSS length. */
export const resolveRadius = (theme: ResolvedConfig["theme"]): string =>
  RADII[theme.radius];

/**
 * Compile theme config into CSS custom properties. A named accent resolves to
 * its preset; any other value is treated as a raw CSS color so users can pass
 * arbitrary colors without a config change. Labels on accent and action fills
 * take whichever of white or dark ink reads ({@link readableOn}).
 */
export const buildThemeCss = (theme: ResolvedConfig["theme"]): string => {
  const accent = resolveAccent(theme);
  const action = resolveAction(theme);
  const root = themeRootCss(theme, {
    accent: accent.light,
    action: action?.light ?? null,
    radius: RADII[theme.radius],
  });
  const dark = themeDarkCss(theme, {
    accent: accent.dark,
    action: action?.dark ?? null,
  });

  return `/* Generated by Blume from theme config. */
:root {
${root}
}
${dark}`;
};

/** A configured color: where the config sets it, and its value. */
export interface ColorSetting {
  /** The config path, e.g. `["theme", "accent", "dark"]`. */
  path: string[];
  /** Whether the field also takes an accent preset name (`teal`). */
  presets: boolean;
  value: string;
}

const MODES = ["light", "dark"] as const;

/**
 * A per-mode field's settings. Both modes holding one value (a string, which
 * the schema copies into each) is one setting at the field itself, so a
 * mistake is reported once, at the key that set it.
 */
const modeSettings = (
  path: string[],
  value: { dark?: string; light?: string } | undefined,
  presets: boolean
): ColorSetting[] => {
  if (value?.light !== undefined && value.light === value.dark) {
    return [{ path, presets, value: value.light }];
  }
  return MODES.flatMap((mode) => {
    const color = value?.[mode];
    return color === undefined
      ? []
      : [{ path: [...path, mode], presets, value: color }];
  });
};

const OG_PALETTE_KEYS = [
  "accent",
  "background",
  "border",
  "foreground",
  "muted",
] as const;

/**
 * The configured colors that aren't CSS colors (`"deep purple"`, a hex value
 * missing its `#`): `theme.accent`, `theme.action`, and `theme.background`,
 * and the OG card's `seo.og.palette`. The schema takes any string, so a
 * mistake would otherwise reach the stylesheet, where browsers drop it, or
 * the card renderer, which rejects it. Preset names are CSS color names too.
 */
export const invalidColorSettings = (
  config: ResolvedConfig
): ColorSetting[] => {
  const { theme } = config;
  const palette = config.seo.og.palette ?? {};
  return [
    ...modeSettings(["theme", "accent"], theme.accent, true),
    ...(theme.action === undefined
      ? []
      : [{ path: ["theme", "action"], presets: true, value: theme.action }]),
    ...modeSettings(["theme", "background"], theme.background, false),
    ...OG_PALETTE_KEYS.flatMap((key) => {
      const value = palette[key];
      return value === undefined
        ? []
        : [
            {
              path: ["seo", "og", "palette", key],
              presets: key === "accent",
              value,
            },
          ];
    }),
  ].filter((setting) => !isCssColor(setting.value));
};
