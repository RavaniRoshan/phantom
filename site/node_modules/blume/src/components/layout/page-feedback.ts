import { track } from "./analytics-client.ts";
/**
 * The "Was this page helpful?" rating (`PageFeedback.astro`). A rating is
 * sent as a `feedback` analytics event, the buttons give way to a thank-you,
 * and, with `feedback.comments` on, a box below asks the reader to say more.
 * A comment they send goes out as a `feedback_comment` event with the same
 * rating, path, and title, so the two line up in a dashboard.
 *
 * Both go through analytics, so under a consent layer (`consent`) the widget
 * renders hidden and only shows once the reader allows analytics: from
 * anyone else, an answer would go nowhere.
 *
 * Runs on the initial load and again after every client-router swap, which
 * rebuilds the widget from server-rendered markup, so the handlers always
 * bind to the freshly swapped-in elements.
 */
import type { BlumeConsent } from "./consent/types.ts";

/** The longest comment the box takes. */
export const COMMENT_MAX_LENGTH = 1000;

/**
 * Whether an answer would reach analytics: the site has no consent layer, or
 * the reader has allowed analytics.
 */
const answersReachAnalytics = (): boolean => {
  // SAFETY: the consent init script (`consent/init.ts`) is the only writer of
  // `window.blumeConsent`; without a consent layer it's absent.
  const { blumeConsent } = window as Window & { blumeConsent?: BlumeConsent };
  return blumeConsent === undefined || blumeConsent.analytics === true;
};

/**
 * Show the page's rating only while its answers would reach analytics. Runs
 * when the widget is wired and again on every `blume:consent` change, so a
 * reader who accepts the banner gets the rating right away.
 */
export const syncFeedbackVisibility = (): void => {
  const root = document.querySelector<HTMLElement>(
    "[data-blume-page-feedback]"
  );
  if (root) {
    root.hidden = !answersReachAnalytics();
  }
};

/** Wire the page's rating, when it has one. */
export const initFeedback = (): void => {
  const root = document.querySelector("[data-blume-page-feedback]");
  if (!root) {
    return;
  }
  syncFeedbackVisibility();
  const actions = root.querySelector("[data-feedback-actions]");
  const thanks = root.querySelector<HTMLElement>("[data-feedback-thanks]");
  const form = root.querySelector<HTMLFormElement>("[data-feedback-form]");
  let helpful = "";
  const rate = (value: string) => {
    helpful = value;
    track("feedback", {
      helpful,
      path: location.pathname,
      title: document.title,
    });
    actions?.classList.add("hidden");
    thanks?.classList.remove("hidden");
    if (form) {
      form.hidden = false;
    }
    // The clicked button just disappeared under focus; hand focus to the
    // (live) thanks line so the reader isn't dropped at the top of the page.
    // The comment box is the next stop from there.
    thanks?.focus();
  };
  for (const button of root.querySelectorAll<HTMLElement>(
    "[data-feedback-value]"
  )) {
    button.addEventListener("click", () =>
      rate(button.dataset.feedbackValue ?? "")
    );
  }
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const comment = form.querySelector("textarea")?.value.trim() ?? "";
    if (comment) {
      track("feedback_comment", {
        comment: comment.slice(0, COMMENT_MAX_LENGTH),
        helpful,
        path: location.pathname,
        title: document.title,
      });
    }
    form.hidden = true;
    thanks?.focus();
  });
};
