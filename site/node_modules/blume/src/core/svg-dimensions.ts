/**
 * Pixel dimensions declared by an SVG document's root element.
 *
 * Blume needs an SVG's size in two places — the header logo's reserved
 * `<img>` box and the OG card's brand mark — and both read it through this
 * one parser so the header and the card can't disagree about one logo. It
 * inspects the root `<svg …>` tag only: explicit `width`/`height` win, a
 * `viewBox` fills in whatever is missing (scaled to a lone explicit length
 * when there is one), and lengths carry CSS units at 96dpi. Percentages have
 * no pixel meaning and are ignored, so a percent-sized SVG measures by its
 * viewBox alone.
 */
export interface SvgDimensions {
  height: number;
  width: number;
}

/** The root tag, tolerating `>` inside a quoted attribute value. */
const ROOT = /<svg\s(?:[^>"']|"[^"]*"|'[^']*')*>/u;
const WIDTH = /\swidth=(?<quote>['"])(?<value>[^%]+?)\k<quote>/u;
const HEIGHT = /\sheight=(?<quote>['"])(?<value>[^%]+?)\k<quote>/u;
const VIEWBOX = /\sviewBox=(?<quote>['"])(?<value>.+?)\k<quote>/iu;

/** Pixels per CSS unit at 96dpi; an omitted unit means pixels. */
const INCH_CM = 2.54;
const UNITS = new Map([
  ["cm", 96 / INCH_CM],
  ["em", 16],
  ["ex", 8],
  ["in", 96],
  ["m", (96 / INCH_CM) * 100],
  ["mm", 96 / INCH_CM / 10],
  ["pc", (96 / 72) * 12],
  ["pt", 96 / 72],
  ["px", 1],
]);
const LENGTH =
  /^(?<number>[0-9.]+(?:e\d+)?)(?<unit>in|cm|em|ex|m|mm|pc|pt|px)?$/u;

/** A CSS length as whole pixels, or undefined when it isn't one. */
const parseLength = (value: string | undefined): number | undefined => {
  const groups = value === undefined ? undefined : LENGTH.exec(value)?.groups;
  if (!groups) {
    return;
  }
  const pixels = Math.round(
    Number(groups.number) * (UNITS.get(groups.unit ?? "px") ?? 1)
  );
  return pixels > 0 ? pixels : undefined;
};

/** An attribute's raw value on the root tag, or undefined when absent. */
const attribute = (root: string, pattern: RegExp): string | undefined =>
  pattern.exec(root)?.groups?.value;

/** The viewBox's own width and height (its third and fourth numbers). */
const viewBoxSize = (root: string): SvgDimensions | null => {
  const raw = attribute(root, VIEWBOX);
  if (raw === undefined) {
    return null;
  }
  const bounds = raw.split(" ");
  const width = parseLength(bounds[2]);
  const height = parseLength(bounds[3]);
  return width && height ? { height, width } : null;
};

/**
 * The SVG's pixel size, or null when the root carries no usable size: no
 * root tag, neither explicit dimensions nor a viewBox, a viewBox that isn't
 * space-separated, or a zero or unparsable length.
 */
export const svgDimensions = (svg: string): SvgDimensions | null => {
  const root = ROOT.exec(svg)?.[0];
  if (root === undefined) {
    return null;
  }
  const width = parseLength(attribute(root, WIDTH));
  const height = parseLength(attribute(root, HEIGHT));
  if (width && height) {
    return { height, width };
  }
  const box = viewBoxSize(root);
  if (!box) {
    return null;
  }
  const ratio = box.width / box.height;
  if (width) {
    const scaled = Math.floor(width / ratio);
    return scaled > 0 ? { height: scaled, width } : null;
  }
  if (height) {
    const scaled = Math.floor(height * ratio);
    return scaled > 0 ? { height, width: scaled } : null;
  }
  return box;
};
