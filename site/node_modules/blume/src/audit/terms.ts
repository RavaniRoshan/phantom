import { CHECKS } from "./catalog.ts";
import type { CheckId } from "./catalog.ts";

/** A check id without its `BLUME_AUDIT_` prefix, lowercased: `link_to_broken`. */
export const shortId = (id: CheckId): string =>
  id.replace("BLUME_AUDIT_", "").toLowerCase();

/** Does a check id or its category match one of the user's `--only`/`--skip` terms? */
const matchesTerms = (id: CheckId, terms: readonly string[]): boolean => {
  const meta = CHECKS.find((check) => check.id === id);
  const short = shortId(id);
  return terms.some((raw) => {
    const term = raw.trim().toLowerCase();
    return (
      term === short || term === id.toLowerCase() || term === meta?.category
    );
  });
};

/**
 * Whether `--only` and `--skip` leave a check in: it matches an `--only`
 * term, when any are given, and no `--skip` term.
 */
export const checkSelected = (
  id: CheckId,
  filter: { only?: readonly string[]; skip?: readonly string[] }
): boolean =>
  (!filter.only?.length || matchesTerms(id, filter.only)) &&
  !matchesTerms(id, filter.skip ?? []);

/**
 * Every term `--only`/`--skip` accept, as the audit's filter compares them:
 * each check's short id and each category. The full `BLUME_AUDIT_…` id is
 * accepted too, but it's the short id with a prefix, so it isn't listed.
 */
export const checkTerms = (): string[] => [
  ...new Set([
    ...CHECKS.map((check) => check.category),
    ...CHECKS.map((check) => shortId(check.id)),
  ]),
];

/**
 * The `--only`/`--skip` terms that name no check and no category. A typo there
 * (`--only link` for `links`) would otherwise match nothing, report nothing,
 * and pass a CI gate that was meant to catch something.
 */
export const unknownCheckTerms = (terms: readonly string[]): string[] => {
  const known = new Set(checkTerms());
  return terms.filter((raw) => {
    const term = raw.trim().toLowerCase();
    return !(known.has(term) || known.has(term.replace(/^blume_audit_/u, "")));
  });
};
