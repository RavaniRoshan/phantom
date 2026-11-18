/**
 * The consent layer's first script, inlined at the top of `<head>` on every
 * page when `consent` is configured, ahead of any adapter's script and the
 * held analytics. It creates `window.blumeConsent`, the one contract every
 * consent adapter talks to:
 *
 * - `analytics`: `null` until an adapter reports, then the reader's choice.
 * - `set({ analytics })`: what an adapter calls with the reader's choice, on
 *   load for a returning reader and again whenever it changes. A change fires
 *   a `blume:consent` event on `window` (`detail: { analytics }`), which the
 *   runtime (`client.ts`) answers by running the held analytics, and which a
 *   site can listen to for its own scripts.
 * - `open()`: set by an adapter to reopen its preferences; the footer's
 *   Cookie settings link calls it.
 * - `kind`: the configured adapter (`native`, `osano`, …), from the tag's
 *   `data-kind`.
 *
 * It also sets `window.webAnalyticsBeforeSend`, which Vercel Web Analytics
 * reads when it starts, so `vercel()` sends nothing until analytics is
 * allowed; its script is a component rather than a tag, so it can't be held
 * like the others.
 *
 * A constant, like the layouts' other inline scripts (see
 * `components/layout/head-scripts.ts`): the kind rides in as an attribute,
 * never as interpolated source. It runs once per real page load; the client
 * router never runs an inline script twice, and the state it creates lives
 * on across navigations.
 */
export const CONSENT_INIT_SCRIPT = `(()=>{if(window.blumeConsent){return;}const c={analytics:null,kind:document.currentScript?.dataset.kind??"",set(s){const a=s?.analytics===true;if(c.analytics===a){return;}c.analytics=a;dispatchEvent(new CustomEvent("blume:consent",{detail:{analytics:a}}));}};window.blumeConsent=c;window.webAnalyticsBeforeSend=(e)=>c.analytics===true?e:null;})();`;
