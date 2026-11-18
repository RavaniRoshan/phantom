import { z } from "zod";

import type { AdapterDescriptor } from "../core/adapter.ts";
import { adapterDescriptorSchema } from "../core/adapter.ts";

/** Options for {@link native}. */
export interface NativeOptions {
  /** Where the banner's privacy policy link goes: a page route or a URL. */
  policy?: string;
}

export const nativeOptionsSchema = z.strictObject({
  policy: z.string().min(1).optional(),
});

export type NativeAdapter = AdapterDescriptor<"native", NativeOptions>;

export const nativeAdapterSchema = adapterDescriptorSchema(
  "native",
  nativeOptionsSchema
);

/**
 * Blume's own consent banner: a card at the foot of the page asking to use
 * analytics cookies, with Accept and Decline side by side and an optional
 * link to your privacy policy. The answer stays in the reader's browser, and
 * the footer's Cookie settings link brings the banner back to change it. Its
 * text comes from the `consent` UI strings, translated in every built-in
 * language.
 */
export const native = (options: NativeOptions = {}): NativeAdapter => ({
  kind: "native",
  options,
  requiredSecrets: [],
  runtimeDeps: [],
});
