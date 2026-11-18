import { z } from "zod";

import { hcaptchaAdapterSchema } from "./hcaptcha.ts";
import { turnstileAdapterSchema } from "./turnstile.ts";

/**
 * The configured bot check, as its factory returned it. Anything that isn't
 * one fails with the adapter hint; an adapter's own option errors keep their
 * messages.
 */
export const captchaAdapterSchema = z.discriminatedUnion(
  "kind",
  [hcaptchaAdapterSchema, turnstileAdapterSchema],
  {
    error:
      'captcha takes one adapter — e.g. `captcha: turnstile({ siteKey })` or `captcha: hcaptcha({ siteKey })`, imported from "blume/captcha".',
  }
);

export type CaptchaAdapter = z.output<typeof captchaAdapterSchema>;

/** What the browser needs to run the check: never the secret. */
export interface CaptchaSettings {
  kind: CaptchaAdapter["kind"];
  siteKey: string;
}

/** The public half of an adapter, for the data snapshot. */
export const captchaSettings = (adapter: CaptchaAdapter): CaptchaSettings => ({
  kind: adapter.kind,
  siteKey: adapter.options.siteKey,
});
