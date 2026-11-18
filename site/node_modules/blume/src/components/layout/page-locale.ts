/**
 * Locale defaults for the document shells (`RootLayout`, `PageLayout`,
 * `ReferenceLayout`) when the page doesn't pass `locale`/`dir` itself.
 *
 * The content catch-all always passes both, resolved from the route manifest
 * (which also knows about fallback pages). Custom `.astro` pages, the 404
 * page, and the reference shell don't have that data, so they fall back to
 * what Astro's own i18n routing resolved for the request — `Astro.currentLocale`
 * — which the generated config enables with Blume's locale list. Before this,
 * a custom page under `/fr/` rendered `<html lang="en">` unless it threaded
 * the locale through by hand.
 */

/**
 * The page's locale: the caller's explicit value, else the one Astro resolved
 * from the URL, else the site's default locale, else `en` (no i18n).
 */
export const pageLocale = (
  i18n: { defaultLocale: string } | null,
  explicit?: string,
  current?: string
): string => explicit ?? current ?? i18n?.defaultLocale ?? "en";

/** The configured text direction of a locale; `ltr` when unknown. */
export const pageDirection = (
  i18n: { locales: { code: string; dir: "ltr" | "rtl" }[] } | null,
  locale: string
): "ltr" | "rtl" =>
  i18n?.locales.find((entry) => entry.code === locale)?.dir ?? "ltr";
