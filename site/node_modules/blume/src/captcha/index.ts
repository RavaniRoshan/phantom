/**
 * Bot checks for the assistant (`ai.assistant.captcha` in `blume.config.ts`).
 * The assistant gets a token from the check before each question and the
 * generated route verifies it before calling the model:
 *
 * ```ts
 * import { defineConfig } from "blume";
 * import { turnstile } from "blume/captcha";
 *
 * export default defineConfig({
 *   ai: {
 *     assistant: {
 *       enabled: true,
 *       captcha: turnstile({ siteKey: "0x4AAAAAAA…" }),
 *     },
 *   },
 * });
 * ```
 *
 * Each factory returns a plain descriptor (see `core/adapter.ts`); the browser
 * half is `client.ts`, the server half `verify.ts`.
 */
export type { AdapterDescriptor, JsonValue } from "../core/adapter.ts";
export { hcaptcha } from "./hcaptcha.ts";
export type { HcaptchaAdapter, HcaptchaOptions } from "./hcaptcha.ts";
export type { CaptchaAdapter, CaptchaSettings } from "./schema.ts";
export { turnstile } from "./turnstile.ts";
export type { TurnstileAdapter, TurnstileOptions } from "./turnstile.ts";
