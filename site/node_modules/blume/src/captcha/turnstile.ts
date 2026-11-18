import { z } from "zod";

import type { AdapterDescriptor } from "../core/adapter.ts";
import { adapterDescriptorSchema } from "../core/adapter.ts";

/** Options for {@link turnstile}. */
export interface TurnstileOptions {
  /** The widget's site key, from the Cloudflare dashboard. */
  siteKey: string;
}

export const turnstileOptionsSchema = z.strictObject({
  siteKey: z.string().min(1),
});

export type TurnstileAdapter = AdapterDescriptor<"turnstile", TurnstileOptions>;

export const turnstileAdapterSchema = adapterDescriptorSchema(
  "turnstile",
  turnstileOptionsSchema
);

/** Where the assistant's route checks a Turnstile token. */
export const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare Turnstile. The site key is public and goes to the browser; the
 * secret key the route checks tokens with comes from `TURNSTILE_SECRET_KEY`.
 * Set the widget to Invisible or Managed in the Cloudflare dashboard: most
 * readers never see a challenge.
 */
export const turnstile = (options: TurnstileOptions): TurnstileAdapter => ({
  kind: "turnstile",
  options,
  requiredSecrets: ["TURNSTILE_SECRET_KEY"],
  runtimeDeps: [],
});
