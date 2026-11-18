/**
 * The browser half of the bot check: a fresh token for each question the
 * assistant sends (both providers' tokens are single-use). The provider's
 * script loads with the first question rather than with the page, and one
 * widget serves every question after it: an invisible hCaptcha, or a
 * Turnstile that only shows itself when it needs the reader to interact,
 * in a small container at the foot of the viewport.
 *
 * The client router swaps `<body>` on every navigation, taking the container
 * and its widget with it, so a question after a swap mounts a new one.
 */
import type { CaptchaSettings } from "./schema.ts";

/** Each provider's script, rendering only when asked to. */
export const CAPTCHA_SCRIPTS = {
  hcaptcha: "https://js.hcaptcha.com/1/api.js?render=explicit",
  turnstile:
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
} as const;

/** What Blume asks a Turnstile widget for. */
interface TurnstileRenderOptions {
  appearance: "interaction-only";
  callback: (token: string) => void;
  "error-callback": () => void;
  execution: "execute";
  sitekey: string;
}

/** The slice of `window.turnstile` the check uses. */
export interface TurnstileApi {
  execute: (widget: string) => void;
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widget: string) => void;
}

/** What Blume asks an hCaptcha widget for. */
interface HcaptchaRenderOptions {
  sitekey: string;
  size: "invisible";
}

/** The slice of `window.hcaptcha` the check uses. */
export interface HcaptchaApi {
  execute: (
    widget: string,
    options: { async: true }
  ) => Promise<{ response: string }>;
  render: (container: HTMLElement, options: HcaptchaRenderOptions) => string;
  reset: (widget: string) => void;
}

/** The window, with the providers' globals once their scripts ran. */
type CaptchaWindow = Window & {
  hcaptcha?: HcaptchaApi;
  turnstile?: TurnstileApi;
};

/** A Turnstile token on its way. */
interface PendingToken {
  reject: (error: Error) => void;
  resolve: (token: string) => void;
}

/** Get a token for the next question. */
export type CaptchaTokenGetter = (settings: CaptchaSettings) => Promise<string>;

/** A token getter with its own script, container, and widget. */
export const createCaptchaClient = (): CaptchaTokenGetter => {
  let loaded: Promise<void> | undefined;
  let host: HTMLElement | undefined;
  let widget: string | undefined;
  let pending: PendingToken | undefined;

  const load = (kind: CaptchaSettings["kind"]): Promise<void> => {
    // oxlint-disable-next-line promise/avoid-new -- adapt the script tag's load events
    loaded ??= new Promise<void>((resolve, reject) => {
      const tag = document.createElement("script");
      tag.async = true;
      tag.src = CAPTCHA_SCRIPTS[kind];
      tag.addEventListener("load", () => resolve());
      tag.addEventListener("error", () => {
        // Let the next question try again.
        loaded = undefined;
        reject(new Error(`The ${kind} script didn't load.`));
      });
      document.head.append(tag);
    });
    return loaded;
  };

  // The widget's container, mounted again when a swap took the last one.
  const mount = (): HTMLElement => {
    if (host?.isConnected) {
      return host;
    }
    host = document.createElement("div");
    host.className = "fixed bottom-4 left-1/2 z-[60] -translate-x-1/2";
    host.dataset.blumeCaptcha = "";
    document.body.append(host);
    widget = undefined;
    return host;
  };

  const turnstileToken = (api: TurnstileApi, siteKey: string) =>
    // oxlint-disable-next-line promise/avoid-new -- adapt Turnstile's token callbacks
    new Promise<string>((resolve, reject) => {
      pending = { reject, resolve };
      const target = mount();
      if (widget === undefined) {
        widget = api.render(target, {
          appearance: "interaction-only",
          callback: (token) => pending?.resolve(token),
          "error-callback": () =>
            pending?.reject(new Error("The Turnstile check failed.")),
          execution: "execute",
          sitekey: siteKey,
        });
      } else {
        api.reset(widget);
      }
      api.execute(widget);
    });

  const hcaptchaToken = async (api: HcaptchaApi, siteKey: string) => {
    const target = mount();
    if (widget === undefined) {
      widget = api.render(target, { sitekey: siteKey, size: "invisible" });
    } else {
      api.reset(widget);
    }
    const { response } = await api.execute(widget, { async: true });
    return response;
  };

  return async (settings) => {
    await load(settings.kind);
    // SAFETY: CaptchaWindow only adds the providers' optional globals, each
    // checked before use.
    const { hcaptcha, turnstile } = window as CaptchaWindow;
    if (settings.kind === "hcaptcha" && hcaptcha) {
      return hcaptchaToken(hcaptcha, settings.siteKey);
    }
    if (settings.kind === "turnstile" && turnstile) {
      return turnstileToken(turnstile, settings.siteKey);
    }
    throw new Error(`The ${settings.kind} script loaded without its API.`);
  };
};

/** The page's token getter: one script and one widget per page load. */
export const captchaToken = createCaptchaClient();
