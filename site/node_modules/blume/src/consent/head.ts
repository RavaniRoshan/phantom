import type { HeadScript } from "../analytics/head.ts";
import { ethycaHead } from "./ethyca.ts";
import { osanoHead } from "./osano.ts";
import type { ConsentAdapter } from "./schema.ts";

/**
 * The tags one consent adapter emits into `<head>`, after the init script and
 * ahead of the held analytics: a hosted manager's loader and the bridge that
 * reports its answers to `window.blumeConsent`. `native()` has none; its
 * banner is markup (`ConsentBanner.astro`) and its logic is the runtime's.
 */
export const consentHead = (adapter: ConsentAdapter): HeadScript[] => {
  switch (adapter.kind) {
    case "ethyca": {
      return ethycaHead(adapter.options);
    }
    case "osano": {
      return osanoHead(adapter.options);
    }
    default: {
      return [];
    }
  }
};
