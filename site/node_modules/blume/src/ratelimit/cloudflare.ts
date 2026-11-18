import { z } from "zod";

import type { AdapterDescriptor } from "../core/adapter.ts";
import { adapterDescriptorSchema } from "../core/adapter.ts";

/** The Worker binding Blume declares for the rate limiter. */
export const RATE_LIMIT_BINDING = "BLUME_RATE_LIMIT";

/** Options for {@link cloudflare}. */
export interface CloudflareRateLimitOptions {
  /**
   * The rate limiting namespace, a positive integer unique in your
   * Cloudflare account. Defaults to one derived from the site.
   */
  namespaceId?: string;
  /** Requests each reader may make per window, per route. Defaults to 10. */
  requests?: number;
  /** The window, in seconds: Cloudflare allows 10 or 60. Defaults to 60. */
  window?: 10 | 60;
}

export const cloudflareRateLimitOptionsSchema = z.strictObject({
  namespaceId: z
    .string()
    .regex(/^[1-9]\d*$/u, "namespaceId is a positive integer, as a string.")
    .optional(),
  requests: z.number().int().positive().optional(),
  window: z.union([z.literal(10), z.literal(60)]).optional(),
});

export type CloudflareRateLimitAdapter = AdapterDescriptor<
  "cloudflare",
  CloudflareRateLimitOptions
>;

export const cloudflareRateLimitAdapterSchema = adapterDescriptorSchema(
  "cloudflare",
  cloudflareRateLimitOptionsSchema
);

/**
 * Counts with Cloudflare's Workers rate limiting, for a site deployed with
 * `deployment: cloudflare()`: Blume declares the binding in the Worker's
 * config, so there is nothing to set up. Cloudflare counts per location and
 * allows a window of 10 or 60 seconds.
 */
export const cloudflare = (
  options: CloudflareRateLimitOptions = {}
): CloudflareRateLimitAdapter => ({
  kind: "cloudflare",
  options,
  requiredSecrets: [],
  runtimeDeps: [],
});
