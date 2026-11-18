import { z } from "zod";

import type { HeadScript } from "../analytics/head.ts";
import type { AdapterDescriptor } from "../core/adapter.ts";
import { adapterDescriptorSchema } from "../core/adapter.ts";

/** Options for {@link ethyca}. */
export interface EthycaOptions {
  /**
   * The key of the privacy notice that covers analytics, as you named it in
   * Fides. Defaults to `analytics`.
   */
  notice?: string;
  /** Your Fides privacy center's origin, which serves `fides.js`. */
  privacyCenter: string;
  /** The Fides property to load, when you have more than one. */
  propertyId?: string;
}

export const ethycaOptionsSchema = z.strictObject({
  notice: z.string().min(1).optional(),
  privacyCenter: z.url({ protocol: /^https?$/u }),
  propertyId: z.string().min(1).optional(),
});

export type EthycaAdapter = AdapterDescriptor<"ethyca", EthycaOptions>;

export const ethycaAdapterSchema = adapterDescriptorSchema(
  "ethyca",
  ethycaOptionsSchema
);

/**
 * Ethyca's Fides consent manager, loaded from your privacy center. Fides
 * shows its own banner and modal, set up in Fides, and Blume runs the
 * analytics once the reader's analytics notice is on. Nothing here is
 * secret.
 */
export const ethyca = (options: EthycaOptions): EthycaAdapter => ({
  kind: "ethyca",
  options,
  requiredSecrets: [],
  runtimeDeps: [],
});

/**
 * Reports the analytics notice to `window.blumeConsent` when Fides is ready
 * and whenever the reader saves a change, and reopens Fides' modal from the
 * Cookie settings link. The notice key rides in as `data-notice`. It counts
 * as allowed when on (`true`), opted in, or a notice that only asks for
 * acknowledgment.
 */
export const ETHYCA_BRIDGE = `(()=>{const c=window.blumeConsent;if(!c){return;}const k=document.currentScript?.dataset.notice??"analytics";const sync=(e)=>{const v=(e?.detail?.consent??window.Fides?.consent??{})[k];c.set({analytics:v===true||v==="opt_in"||v==="acknowledge"});};c.open=()=>window.Fides?.showModal();addEventListener("FidesReady",sync);addEventListener("FidesUpdated",sync);if(window.Fides?.initialized){sync();}})();`;

/** Fides' script from the privacy center, then the bridge. */
export const ethycaHead = (options: EthycaOptions): HeadScript[] => {
  const src = new URL(
    "fides.js",
    `${options.privacyCenter.replace(/\/+$/u, "")}/`
  );
  if (options.propertyId) {
    src.searchParams.set("property_id", options.propertyId);
  }
  return [
    { attributes: { src: src.href }, content: null },
    {
      attributes: { "data-notice": options.notice ?? "analytics" },
      content: ETHYCA_BRIDGE,
    },
  ];
};
