import { createHash } from "node:crypto";

import type { JsonValue } from "../core/adapter.ts";
import { isJsonObject } from "../core/sources/json.ts";
import { RATE_LIMIT_BINDING } from "./cloudflare.ts";
import type { CloudflareRateLimitAdapter } from "./cloudflare.ts";

/** The Workers rate limiting binding, as the Worker's config declares it. */
export interface RateLimitBindingConfig {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: 10 | 60 };
}

/**
 * A namespace id for a Worker that sets none: a positive integer derived from
 * its name, so two Blume sites on one account don't share one.
 */
export const rateLimitNamespace = (workerName: string): string => {
  const digest = createHash("sha256").update(workerName).digest("hex");
  return String((Number.parseInt(digest.slice(0, 8), 16) % 2_000_000_000) + 1);
};

const isText = <Value>(value: Value): value is Value & string =>
  typeof value === "string";

/** The binding `cloudflare()` asks for, on the Worker named `workerName`. */
export const rateLimitBinding = (
  adapter: CloudflareRateLimitAdapter,
  workerName: string
): RateLimitBindingConfig => ({
  name: RATE_LIMIT_BINDING,
  namespace_id: adapter.options.namespaceId ?? rateLimitNamespace(workerName),
  simple: {
    limit: adapter.options.requests ?? 10,
    period: adapter.options.window ?? 60,
  },
});

/**
 * The built Worker's config (`dist/server/wrangler.json`) with Blume's rate
 * limiting binding in `ratelimits`, replacing an earlier one of the same name
 * and keeping any others. `null` when the config isn't a JSON object.
 */
export const withRateLimitBinding = (
  wranglerText: string,
  adapter: CloudflareRateLimitAdapter
): string | null => {
  let config: JsonValue;
  try {
    config = JSON.parse(wranglerText);
  } catch {
    return null;
  }
  if (!isJsonObject(config) || Array.isArray(config)) {
    return null;
  }
  const { name, ratelimits } = config;
  const others = Array.isArray(ratelimits)
    ? ratelimits.filter(
        (entry) => !(isJsonObject(entry) && entry.name === RATE_LIMIT_BINDING)
      )
    : [];
  const binding = rateLimitBinding(adapter, isText(name) ? name : "");
  config.ratelimits = [
    ...others,
    { ...binding, simple: { ...binding.simple } },
  ];
  return JSON.stringify(config);
};
