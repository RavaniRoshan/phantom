import { z } from "zod";

import type { HeadScript } from "../analytics/head.ts";
import type { AdapterDescriptor } from "../core/adapter.ts";
import { adapterDescriptorSchema } from "../core/adapter.ts";

/** Options for {@link osano}. */
export interface OsanoOptions {
  /** The configuration ID from the script tag Osano gives you. */
  configId: string;
  /** The customer ID from the script tag Osano gives you. */
  customerId: string;
}

export const osanoOptionsSchema = z.strictObject({
  configId: z.string().min(1),
  customerId: z.string().min(1),
});

export type OsanoAdapter = AdapterDescriptor<"osano", OsanoOptions>;

export const osanoAdapterSchema = adapterDescriptorSchema(
  "osano",
  osanoOptionsSchema
);

/**
 * Osano Cookie Consent. Osano shows its own banner and drawer, set up in the
 * Osano dashboard, and Blume runs the analytics once Osano reports the
 * reader's `ANALYTICS` consent. Both IDs come from the script tag Osano
 * gives you, and neither is secret.
 */
export const osano = (options: OsanoOptions): OsanoAdapter => ({
  kind: "osano",
  options,
  requiredSecrets: [],
  runtimeDeps: [],
});

/**
 * Reports Osano's analytics consent to `window.blumeConsent` now (`Osano.cm`
 * is ready as soon as its script ran) and on every Osano consent event, and
 * reopens Osano's drawer from the Cookie settings link.
 */
export const OSANO_BRIDGE = `(()=>{const o=window.Osano?.cm;const c=window.blumeConsent;if(!o||!c){return;}const sync=()=>c.set({analytics:o.analytics===true});c.open=()=>o.showDrawer();for(const e of ["osano-cm-initialized","osano-cm-consent-saved","osano-cm-consent-changed"]){o.addEventListener(e,sync);}sync();})();`;

/**
 * Osano's loader, synchronous as its install guide requires, then the
 * bridge. The IDs are path segments, so each is encoded.
 */
export const osanoHead = (options: OsanoOptions): HeadScript[] => [
  {
    attributes: {
      src: `https://cmp.osano.com/${encodeURIComponent(options.customerId)}/${encodeURIComponent(options.configId)}/osano.js`,
    },
    content: null,
  },
  { attributes: {}, content: OSANO_BRIDGE },
];
