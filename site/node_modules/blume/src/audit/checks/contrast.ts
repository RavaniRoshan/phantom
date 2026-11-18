import type { ResolvedConfig } from "../../core/schema.ts";
import type { Diagnostic } from "../../core/types.ts";
import { composite, contrastRatio, parseColor } from "../../theme/color.ts";
import type { Rgba } from "../../theme/color.ts";
import {
  MIN_TEXT_CONTRAST,
  labelOn,
  resolveAccent,
  resolveAction,
  themeInk,
} from "../../theme/palette.ts";
import type { ColorMode } from "../../theme/palette.ts";
import { finding } from "../catalog.ts";
import type { CheckModule } from "../types.ts";

const MODES = ["light", "dark"] as const satisfies readonly ColorMode[];

/** The theme config key a color comes from. */
type ThemeKey = "theme.accent" | "theme.action" | "theme.background";

/** A color the theme draws text in, over the surface it sits on. */
interface TextPair {
  fix: string;
  key: ThemeKey;
  /** What the pair is, for the message: "Accent text on the page". */
  label: string;
  surface: Rgba;
  text: Rgba;
}

/** A theme color, resolved for one mode, and the config key it came from. */
interface ThemeColor {
  key: ThemeKey;
  value: string;
}

/** What one mode's check found: pairs to measure, colors it couldn't read. */
interface ModeColors {
  pairs: TextPair[];
  unread: ThemeColor[];
}

/** A fill and the label the build puts on it (`labelOn`, as `readableOn`). */
const fillPair = (
  key: "theme.accent" | "theme.action",
  fill: Rgba,
  page: Rgba,
  mode: ColorMode
): TextPair => ({
  fix: `Neither white nor dark text reaches ${MIN_TEXT_CONTRAST}:1 on this shade. Move \`${key}\`'s ${mode} shade lighter or darker.`,
  key,
  label:
    key === "theme.action"
      ? "The call-to-action label"
      : "Button labels on the accent",
  surface: composite(fill, page),
  text: parseColor(labelOn(fill, mode)) ?? fill,
});

/** The accent's pairs: accent text on the page, and labels on accent fills. */
const accentPairs = (fill: Rgba, page: Rgba, mode: ColorMode): TextPair[] => [
  {
    fix: `${mode === "light" ? "Darken" : "Lighten"} \`theme.accent\`'s ${mode} shade (\`theme.accent: { light, dark }\`).`,
    key: "theme.accent",
    label: "Accent text on the page",
    surface: page,
    text: fill,
  },
  fillPair("theme.accent", fill, page, mode),
];

/** The pairs a custom page background sets: body and secondary text on it. */
const backgroundPairs = (page: Rgba, mode: ColorMode): TextPair[] => {
  const fix = `Pick a \`theme.background\` ${mode} color further from the text color.`;
  return [
    {
      fix,
      key: "theme.background",
      label: "Body text on the page",
      surface: page,
      text: themeInk(mode, "foreground"),
    },
    {
      fix,
      key: "theme.background",
      label: "Secondary text on the page",
      surface: page,
      text: themeInk(mode, "mutedForeground"),
    },
  ];
};

/** Everything one mode draws text in, from the theme config. */
const modeColors = (
  theme: ResolvedConfig["theme"],
  mode: ColorMode
): ModeColors => {
  const unread: ThemeColor[] = [];
  const read = (color: ThemeColor): Rgba | null => {
    const parsed = parseColor(color.value);
    if (!parsed) {
      unread.push(color);
    }
    return parsed;
  };
  const custom = theme.background?.[mode];
  const customPage =
    custom === undefined
      ? null
      : read({ key: "theme.background", value: custom });
  // Text on a page color the audit can't read can't be measured.
  if (custom !== undefined && !customPage) {
    return { pairs: [], unread };
  }
  const page = customPage ?? themeInk(mode, "background");
  const pairs = customPage ? backgroundPairs(customPage, mode) : [];
  const accent = read({
    key: "theme.accent",
    value: resolveAccent(theme)[mode],
  });
  if (accent) {
    pairs.push(...accentPairs(accent, page, mode));
  }
  const action = resolveAction(theme);
  const actionFill =
    action && read({ key: "theme.action", value: action[mode] });
  if (actionFill) {
    pairs.push(fillPair("theme.action", actionFill, page, mode));
  }
  return { pairs, unread };
};

/**
 * Theme contrast: the text colors a configured theme draws — accent text,
 * labels on accent and call-to-action fills, and body text on a custom
 * background — measured against WCAG AA's 4.5:1 in both color modes, resolved
 * the way the build resolves them (presets per mode, labels by `labelOn`).
 * One finding per failing pair, pointed at blume.config.ts, since a theme
 * color is a site-wide choice, not a page's.
 */
export const contrastChecks: CheckModule = {
  category: "accessibility",
  run(context) {
    const { theme } = context.project.config;
    const site = {
      file: context.project.context.configFile ?? undefined,
      url: "/",
    };
    const found: Diagnostic[] = [];
    const reported = new Set<string>();
    for (const mode of MODES) {
      const { pairs, unread } = modeColors(theme, mode);
      for (const color of unread) {
        const id = `${color.key}:${color.value}`;
        if (!reported.has(id)) {
          reported.add(id);
          found.push(
            finding(
              "BLUME_AUDIT_THEME_COLOR_UNCHECKED",
              site,
              `\`${color.key}\` is "${color.value}", which the audit can't read as a color, so its contrast went unchecked.`
            )
          );
        }
      }
      for (const pair of pairs) {
        const ratio = contrastRatio(pair.text, pair.surface);
        if (ratio < MIN_TEXT_CONTRAST) {
          found.push(
            finding(
              "BLUME_AUDIT_THEME_CONTRAST_LOW",
              site,
              `${pair.label} in ${mode} mode is ${ratio.toFixed(2)}:1, under the ${MIN_TEXT_CONTRAST}:1 WCAG AA asks of body text (\`${pair.key}\`).`,
              pair.fix
            )
          );
        }
      }
    }
    return found;
  },
  tier: "static",
};
