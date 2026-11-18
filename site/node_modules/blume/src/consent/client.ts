/**
 * The browser half of the consent layer (`consent` in `blume.config.ts`),
 * bundled into every layout by `ConsentHead.astro` and started once per real
 * page load. It answers `window.blumeConsent` (see `init.ts`):
 *
 * - Analytics scripts wait in the page as `<script type="text/plain"
 *   data-blume-consent="analytics">` (see `Analytics.astro`). Once the reader
 *   allows analytics, each one runs, once per page load: the client router
 *   brings the held tags back on every navigation, and running them again
 *   would count every visit twice.
 * - A reader who takes consent back after the scripts ran gets a reload, the
 *   one way to stop scripts that already started.
 * - Any element with `data-blume-consent-open` (the footer's Cookie settings
 *   link) reopens the adapter's preferences.
 * - An adapter with a browser module (`native()`'s banner, say) is started
 *   from here once the runtime is listening; see `consent/clients.ts`.
 */
import type { BlumeConsent } from "../components/layout/consent/types.ts";

/** The window, with the state the init script puts on it. */
type ConsentWindow = Window & { blumeConsent?: BlumeConsent };

/** Analytics tags held until the reader allows analytics. */
export const HELD_SCRIPTS =
  'script[type="text/plain"][data-blume-consent="analytics"]';

const OPEN = "[data-blume-consent-open]";

/**
 * Run each held tag the page hasn't run yet, as a new `<script>` beside it
 * with the same attributes and body. `ran` is keyed by the tag's markup,
 * which is the same on every page, so a tag the router brings back is
 * skipped.
 */
export const runHeldScripts = (ran: Set<string>): void => {
  for (const held of document.querySelectorAll(HELD_SCRIPTS)) {
    const key = held.outerHTML;
    if (ran.has(key)) {
      continue;
    }
    ran.add(key);
    const script = document.createElement("script");
    for (const { name, value } of held.attributes) {
      if (name !== "type" && name !== "data-blume-consent") {
        script.setAttribute(name, value);
      }
    }
    // A created script is async unless told otherwise; keep the tags in
    // document order, as the parser would have, unless one asked for async.
    if (!held.hasAttribute("async")) {
      script.async = false;
    }
    script.text = held.textContent ?? "";
    held.after(script);
  }
};

/**
 * Start the consent runtime on this page load, then the configured adapter's
 * browser module (`startClient`, from the generated `blume:consent-client`;
 * none for a hosted manager, whose `<head>` tags report its answers).
 */
export const startConsent = (
  startClient: (consent: BlumeConsent) => void = () => {
    // No browser module: a hosted manager's <head> tags report its answers.
  }
): void => {
  // SAFETY: ConsentWindow only adds the optional state the init script
  // creates; it's checked before use.
  const consent = (window as ConsentWindow).blumeConsent;
  if (!consent) {
    return;
  }
  const ran = new Set<string>();
  const run = () => {
    if (consent.analytics === true) {
      runHeldScripts(ran);
    }
  };
  window.addEventListener("blume:consent", () => {
    if (consent.analytics === true) {
      runHeldScripts(ran);
    } else if (ran.size > 0) {
      location.reload();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(OPEN)) {
      consent.open?.();
    }
  });
  startClient(consent);
  run();
  document.addEventListener("astro:after-swap", run);
};
