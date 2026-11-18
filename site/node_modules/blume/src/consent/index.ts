/**
 * Consent adapters for `blume.config.ts`:
 *
 * ```ts
 * import { defineConfig } from "blume";
 * import { googleAnalytics } from "blume/analytics";
 * import { native } from "blume/consent";
 *
 * export default defineConfig({
 *   analytics: [googleAnalytics({ id: "G-XXXXXXXXXX" })],
 *   consent: native({ policy: "/privacy" }),
 * });
 * ```
 *
 * With `consent` set, analytics waits for the reader: every adapter's tags are
 * held until the consent adapter reports that analytics is allowed. Each
 * factory returns a plain descriptor (see `core/adapter.ts`).
 *
 * Adding a consent manager: a factory and option schema in its own module,
 * and a member of `consentAdapterSchema` (`schema.ts`). Then connect it to
 * `window.blumeConsent` (see `init.ts` for the contract): report the reader's
 * choice with `set({ analytics })` on load and on every change, and set
 * `open` to reopen the manager's preferences. A hosted manager does that
 * with tags in `consentHead` (`head.ts`): its loader, then a constant bridge
 * script (`osano.ts` is an example). A manager that ships as an npm package
 * does it in a browser module instead, registered in `clients.ts`, with its
 * packages in the factory's `runtimeDeps` (`native()`'s banner is the
 * example).
 */
export type { AdapterDescriptor, JsonValue } from "../core/adapter.ts";
export { ethyca } from "./ethyca.ts";
export type { EthycaAdapter, EthycaOptions } from "./ethyca.ts";
export { native } from "./native.ts";
export type { NativeAdapter, NativeOptions } from "./native.ts";
export { osano } from "./osano.ts";
export type { OsanoAdapter, OsanoOptions } from "./osano.ts";
export type { ConsentAdapter } from "./schema.ts";
