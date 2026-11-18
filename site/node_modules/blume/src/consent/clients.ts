/**
 * The browser module each consent adapter brings, by `kind`. The generated
 * `blume:consent-client` (see `consentClientTemplate`) imports the configured
 * adapter's, so a site bundles only its own adapter's browser code, the way
 * `blume:search-client` does for search.
 *
 * Hosted managers (`osano()`, `ethyca()`) have none: their `<head>` tags load
 * them and report their answers (see `head.ts`). A manager that ships as an
 * npm package adds its module under `components/layout/consent/` instead: a
 * `start` (`ConsentClientStart` in its `types.ts`) that reports the reader's answer with
 * `consent.set({ analytics })` and sets `consent.open`, with the packages it
 * imports listed in its factory's `runtimeDeps`, so only the sites that pick
 * it install them.
 */

/** Each adapter's browser module, as the generated project imports it. */
export const CONSENT_CLIENT_MODULES = new Map([
  ["native", "blume/components/layout/consent/native.ts"],
]);
