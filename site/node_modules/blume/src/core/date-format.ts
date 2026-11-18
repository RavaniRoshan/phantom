import type { ResolvedDateFormat } from "./schema.ts";

/**
 * The default date presentation — the long form (`July 21, 2026`,
 * `2026年7月21日`) both stamps used before `dateFormat` was configurable.
 */
export const DEFAULT_DATE_FORMAT: ResolvedDateFormat = { dateStyle: "long" };

/**
 * Resolve a configured `dateFormat` into `Intl.DateTimeFormat` options for the
 * per-page "last updated" stamp and the changelog timeline. Both surfaces call
 * this so they format alike. Dates render in UTC unless the config names a
 * `timeZone`, so a stamp reads the same regardless of the build machine's zone.
 */
export const resolveDateFormatOptions = (
  format: ResolvedDateFormat = DEFAULT_DATE_FORMAT
): Intl.DateTimeFormatOptions => ({ timeZone: "UTC", ...format });
