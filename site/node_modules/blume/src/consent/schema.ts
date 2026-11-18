import { z } from "zod";

import { ethycaAdapterSchema } from "./ethyca.ts";
import { nativeAdapterSchema } from "./native.ts";
import { osanoAdapterSchema } from "./osano.ts";

const ADAPTER_HINT =
  'consent takes one adapter — e.g. `consent: native()` or `consent: osano({ customerId, configId })`, imported from "blume/consent".';

/**
 * The configured consent adapter, as its factory returned it. Anything that
 * isn't one (`true`, a list, an unknown `kind`) fails with the adapter hint;
 * an adapter's own option errors keep their messages.
 */
export const consentAdapterSchema = z.discriminatedUnion(
  "kind",
  [ethycaAdapterSchema, nativeAdapterSchema, osanoAdapterSchema],
  { error: ADAPTER_HINT }
);

export type ConsentAdapter = z.output<typeof consentAdapterSchema>;

/**
 * `blume.config.consent`: the adapter that asks readers before analytics
 * runs. Unset (`null` once resolved) means no consent layer, and analytics
 * runs as it loads.
 */
export const consentConfigSchema = consentAdapterSchema
  .optional()
  .transform((adapter) => adapter ?? null);
