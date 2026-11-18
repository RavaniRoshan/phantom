/**
 * The consent contract every adapter talks to, shared by the consent runtime
 * (`consent/client.ts`) and each adapter's browser module (like `native.ts`
 * here). `window.blumeConsent` is created by the inline init script
 * (`consent/init.ts`) before any adapter loads.
 */

/** What a consent adapter reports: whether the reader allows analytics. */
export interface ConsentState {
  analytics: boolean;
}

/** `window.blumeConsent`, created by the inline init script. */
export interface BlumeConsent {
  /** `null` until an adapter reports, then the reader's choice. */
  analytics: boolean | null;
  /** The configured adapter's kind. */
  kind: string;
  /** Reopen the reader's consent choices; set by the adapter. */
  open?: () => void;
  /** Report the reader's choice; fires `blume:consent` when it changes. */
  set: (state: ConsentState) => void;
}

/**
 * A consent adapter's browser module entry point, which the generated
 * `blume:consent-client` calls once per real page load, after the runtime is
 * listening. It gets the consent state and the adapter's options from
 * `blume.config.ts`, and must report the reader's answer with
 * `consent.set({ analytics })` (on load, and again whenever it changes) and
 * set `consent.open` to reopen the adapter's preferences. Anything it does per
 * page, it redoes on `astro:after-swap`.
 */
export type ConsentClientStart<Options> = (
  consent: BlumeConsent,
  options: Options
) => void;
