/**
 * A file or folder name's ordering prefix: digits, then a `-`, `_`, or `.`
 * separator (`01-intro`, `2_setup`). It sorts the generated sidebar and is
 * dropped from the route.
 */
const ORDERING_PREFIX = /^(?<order>\d+)[-_.]/u;

/**
 * Digit-led names that are names, not orders, and stay whole: a version
 * (`1.2.0`, `2.0`), which a `1.` prefix would split into `2.0`, and an ISO date
 * (`2024-01-05`, `2024-01-05-first-post`), whose year would sort the sidebar
 * and leave only `01-05…` of the route.
 */
const VERSION_OR_ISO_DATE = /^(?:\d+\.\d|\d{4}-\d{2}-\d{2}(?:[-_.]|$))/u;

/**
 * The other dates a name can start with, kept whole the same way: day or
 * month first with a four-digit year last (`12-05-2022`, `1-5-2022-launch`),
 * and a year and month (`2024-01`, `2024-01-recap`). Blume once read their
 * first number as an ordering prefix, so these names routed as `05-2022` and
 * `01`; {@link formerRouteName} still knows those routes, so they redirect.
 */
const DATE_NAME =
  /^(?:(?:0?[1-9]|[12]\d|3[01])-(?:0?[1-9]|[12]\d|3[01])-\d{4}|\d{4}-(?:0[1-9]|1[0-2]))(?:[-_.]|$)/u;

/** The digits of `name`'s ordering prefix (`01` of `01-intro`), if it has one. */
export const orderingPrefix = (name: string): string | undefined =>
  VERSION_OR_ISO_DATE.test(name) || DATE_NAME.test(name)
    ? undefined
    : name.match(ORDERING_PREFIX)?.groups?.order;

/** `name` without its ordering prefix (`01-intro` -> `intro`). */
export const stripOrderingPrefix = (name: string): string => {
  const order = orderingPrefix(name);
  // The prefix is the digits plus their one-character separator.
  return order === undefined ? name : name.slice(order.length + 1);
};

/**
 * The name an earlier Blume routed `name` as, when it differs from today's:
 * a {@link DATE_NAME} lost its first number as an ordering prefix
 * (`12-05-2022` routed as `05-2022`, `2024-01` as `01`).
 */
export const formerRouteName = (name: string): string | undefined =>
  DATE_NAME.test(name) && !VERSION_OR_ISO_DATE.test(name)
    ? name.slice(name.indexOf("-") + 1)
    : undefined;
