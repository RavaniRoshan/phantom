/**
 * The server half of the bot check: the generated assistant route verifies
 * the token the browser sent with the question against the provider before
 * it calls the model. A failed or unreachable check refuses the question
 * (and logs why), so a server that can't reach the provider shows up as a
 * refused question rather than a silently unprotected route.
 */
import { clientAddressOf } from "../core/client-address.ts";
import type { ClientContext } from "../core/client-address.ts";
import { HCAPTCHA_VERIFY_URL } from "./hcaptcha.ts";
import type { CaptchaAdapter } from "./schema.ts";
import { TURNSTILE_VERIFY_URL } from "./turnstile.ts";

/** The longest token either provider issues, with room to spare. */
const MAX_TOKEN_LENGTH = 4096;

/** What the provider answers about a token. */
interface VerifyReply {
  "error-codes"?: string[];
  success?: boolean;
}

/** What the route hands the check from its runtime. */
export interface VerifyOptions {
  /** For tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** The provider's secret key. */
  secret: string;
}

/**
 * Whether the provider confirms `token` came from a person on this site. The
 * route passes the request body's `captcha` when it's a string.
 */
export const verifyCaptcha = async (
  adapter: CaptchaAdapter,
  token: string | undefined,
  context: ClientContext,
  options: VerifyOptions
): Promise<boolean> => {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return false;
  }
  const form = new URLSearchParams({ response: token, secret: options.secret });
  const address = clientAddressOf(context);
  if (address) {
    form.set("remoteip", address);
  }
  if (adapter.kind === "hcaptcha") {
    form.set("sitekey", adapter.options.siteKey);
  }
  try {
    const response = await (options.fetch ?? fetch)(
      adapter.kind === "hcaptcha" ? HCAPTCHA_VERIFY_URL : TURNSTILE_VERIFY_URL,
      { body: form, method: "POST" }
    );
    // SAFETY: both providers answer JSON with a `success` flag; anything
    // else reads as a failure below.
    const reply = (await response.json()) as VerifyReply;
    if (reply.success === true) {
      return true;
    }
    console.warn(
      `The ${adapter.kind} check refused a question:`,
      reply["error-codes"] ?? response.status
    );
  } catch (error) {
    console.error(`The ${adapter.kind} check could not be reached:`, error);
  }
  return false;
};
