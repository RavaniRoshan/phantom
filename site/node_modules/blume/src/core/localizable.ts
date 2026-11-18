import type { LocalizableLabel } from "./schema.ts";

/** A label is either one string for every locale or a per-locale map. */
const isSingleLabel = (label: LocalizableLabel): label is string =>
  typeof label === "string";

/**
 * Resolve a possibly-per-locale label to the string a locale renders: the
 * active locale's entry, else the default locale's, else the map's first
 * entry (which is also what a single-locale site gets).
 */
export const resolveLocalizable = (
  label: LocalizableLabel,
  locale?: string,
  defaultLocale?: string
): string => {
  if (isSingleLabel(label)) {
    return label;
  }
  return (
    (locale === undefined ? undefined : label[locale]) ??
    (defaultLocale === undefined ? undefined : label[defaultLocale]) ??
    Object.values(label)[0] ??
    ""
  );
};
