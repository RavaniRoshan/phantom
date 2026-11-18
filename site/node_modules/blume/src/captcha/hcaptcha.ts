import { z } from "zod";

import type { AdapterDescriptor } from "../core/adapter.ts";
import { adapterDescriptorSchema } from "../core/adapter.ts";

/** Options for {@link hcaptcha}. */
export interface HcaptchaOptions {
  /** The site key, from the hCaptcha dashboard. */
  siteKey: string;
}

export const hcaptchaOptionsSchema = z.strictObject({
  siteKey: z.string().min(1),
});

export type HcaptchaAdapter = AdapterDescriptor<"hcaptcha", HcaptchaOptions>;

export const hcaptchaAdapterSchema = adapterDescriptorSchema(
  "hcaptcha",
  hcaptchaOptionsSchema
);

/** Where the assistant's route checks an hCaptcha token. */
export const HCAPTCHA_VERIFY_URL = "https://api.hcaptcha.com/siteverify";

/**
 * hCaptcha, as an invisible check: most readers never see a challenge. The
 * site key is public and goes to the browser; the secret the route checks
 * tokens with comes from `HCAPTCHA_SECRET_KEY`.
 */
export const hcaptcha = (options: HcaptchaOptions): HcaptchaAdapter => ({
  kind: "hcaptcha",
  options,
  requiredSecrets: ["HCAPTCHA_SECRET_KEY"],
  runtimeDeps: [],
});
