/**
 * `native()`'s browser module: Blume's own banner. The generated
 * `blume:consent-client` brings it in when `native()` is the configured
 * consent adapter (see `consent/clients.ts`). It reports the reader's stored
 * answer, shows the banner (`ConsentBanner.astro`) until they pick one, stores
 * the pick, and makes the footer's Cookie settings link bring the banner back.
 */
import type { NativeOptions } from "../../../consent/native.ts";
import type { BlumeConsent, ConsentClientStart } from "./types.ts";

/** Where `native()` keeps the reader's answer. */
export const CONSENT_STORAGE_KEY = "blume-consent";

const BANNER = "[data-blume-consent-banner]";
const CHOICE = "[data-blume-consent-choice]";

/** The stored answer, or `null` before one (or without storage). */
export const storedChoice = (): boolean | null => {
  try {
    const value = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (value === "granted" || value === "denied") {
      return value === "granted";
    }
  } catch {
    // Storage blocked: ask again on every page rather than fail.
  }
  return null;
};

const storeChoice = (granted: boolean): void => {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, granted ? "granted" : "denied");
  } catch {
    // Storage blocked: the answer holds for this page load only.
  }
};

const banner = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(BANNER);

/**
 * Wire this page's banner: show it while the reader hasn't answered, and
 * store and report an answer. Runs again after every client-router swap,
 * which brings a fresh, hidden banner.
 */
const syncBanner = (consent: BlumeConsent): void => {
  const element = banner();
  if (!element) {
    return;
  }
  element.hidden = storedChoice() !== null;
  for (const button of element.querySelectorAll<HTMLElement>(CHOICE)) {
    button.addEventListener("click", () => {
      const granted = button.dataset.blumeConsentChoice === "accept";
      storeChoice(granted);
      element.hidden = true;
      consent.set({ analytics: granted });
    });
  }
};

/**
 * Report the stored answer, and wire the banner on this page and every page
 * the client router swaps in. The options (the banner's privacy link) are
 * rendered into the banner itself, so there's nothing to read here.
 */
export const start: ConsentClientStart<NativeOptions> = (consent) => {
  consent.open = () => {
    const element = banner();
    if (element) {
      element.hidden = false;
    }
  };
  syncBanner(consent);
  consent.set({ analytics: storedChoice() === true });
  document.addEventListener("astro:after-swap", () => {
    syncBanner(consent);
  });
};
