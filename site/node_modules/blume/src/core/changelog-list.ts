/**
 * The policy the changelog index lists by, shared by the surfaces that build
 * it: the `<Changelog />` component (reading Astro collection entries) and
 * `ai/changelog-markdown.ts` (reading the build-time page graph for the
 * `/changelog.md` mirror and MCP `get_page`).
 *
 * The data sources genuinely differ — a collection entry on the Astro side, a
 * `PageRecord` on the Node side — so what lives here is the *decisions*, not
 * the access: which date a row carries, what order rows come in, and how they
 * fall into year groups. Keeping them in one place is what stops the rendered
 * page and the Markdown an agent reads from drifting apart.
 */

/**
 * A changelog entry's date, from `date` or the `changelog.date` it may live
 * under instead. Front matter hands either a `Date` (an unquoted YAML date) or
 * a string, and an unparseable value is treated as no date at all rather than
 * failing the build — a malformed date costs the row its stamp and its year
 * group, not the page.
 */
export const parseChangelogDate = (
  value: Date | string | null | undefined
): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Newest first. An undated entry sorts as the epoch, so undated rows collect
 * at the end of the list (and, through {@link groupChangelogYears}, into a
 * final group with no year label).
 */
export const compareChangelogDates = (a: Date | null, b: Date | null): number =>
  (b?.getTime() ?? 0) - (a?.getTime() ?? 0);

/** One year's run of rows. `year` is `null` for the undated group. */
export interface ChangelogYearGroup<T> {
  items: T[];
  year: string | null;
}

/**
 * Consecutive rows sharing a year, in list order, so the index reads as a year
 * rail beside its rows. Runs are consecutive rather than keyed, which matters
 * only for a list that isn't sorted by date: such a list keeps its order and
 * repeats the year heading instead of silently regrouping around it.
 *
 * `yearOf` returns the label the surface wants — a locale-formatted year on the
 * rendered page, a plain number in Markdown — or `null` for an undated row.
 */
export const groupChangelogYears = <T>(
  items: T[],
  yearOf: (item: T) => string | null
): ChangelogYearGroup<T>[] => {
  const groups: ChangelogYearGroup<T>[] = [];
  for (const item of items) {
    const year = yearOf(item);
    const last = groups.at(-1);
    if (last && last.year === year) {
      last.items.push(item);
    } else {
      groups.push({ items: [item], year });
    }
  }
  return groups;
};

/**
 * Make each row's anchor unique. Repeated labels slug to the same id (two
 * entries with neither a title nor a version both fall back to "update"), so
 * the later ones take a `-2`, `-3`, … suffix and the first keeps the plain
 * slug — every row ends up with its own hash anchor.
 */
export const uniqueAnchorIds = (ids: string[]): string[] => {
  const seen = new Set<string>();
  return ids.map((id) => {
    let unique = id;
    for (let n = 2; seen.has(unique); n += 1) {
      unique = `${id}-${n}`;
    }
    seen.add(unique);
    return unique;
  });
};
