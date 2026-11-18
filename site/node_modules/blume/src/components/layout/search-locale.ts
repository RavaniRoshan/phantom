/**
 * The locale the search dialog should scope to, or `undefined` when scoping
 * is pointless. Derived from the resolved i18n settings rather than from the
 * header's language-switcher entries: the switcher list is only assembled by
 * the content catch-all, so pages rendered without one (custom pages built on
 * `PageLayout`, the changelog index, the 404 page, the API reference shell)
 * would otherwise search every language while showing no "All languages"
 * toggle. A single-locale site (or one without i18n) has nothing to scope.
 */
export const searchLocaleFor = (
  i18n: { locales: { code: string }[] } | null,
  locale: string
): string | undefined => (i18n && i18n.locales.length > 1 ? locale : undefined);
