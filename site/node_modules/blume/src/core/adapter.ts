import { z } from "zod";

/**
 * The serializable descriptor an integration factory returns — `posthog({ key })`,
 * `vercel()`, `script({ src })` and their siblings. A descriptor is plain data:
 * the CLI evaluates `blume.config.ts` once, validates what came back, and
 * writes it into the generated project's data snapshot as a JSON literal. That
 * is where the runtime reads it — nothing generated imports the config at
 * request time — so a descriptor can't carry functions, class instances, or
 * anything else JSON drops.
 *
 * Every consumer reads the descriptor instead of switching on a provider name:
 * the head emitter and `blume doctor` branch on `kind`, the generated
 * `.blume/package.json` declares `runtimeDeps`, and the secrets check warns
 * when an entry of `requiredSecrets` is unset.
 *
 * An adapter's verbatim option passthrough is typed as {@link JsonValue} and
 * validated with `z.json()`, so a function, `undefined`, a bigint, or a
 * non-finite number fails config validation with a path instead of vanishing
 * (or throwing) when the snapshot is serialized.
 */
export interface AdapterDescriptor<Kind extends string, Options> {
  /** Which integration this is. */
  kind: Kind;
  /** The options the factory was called with, verbatim. */
  options: Options;
  /** Env vars the integration reads at runtime; `blume dev`/`build` warn when one is unset. */
  requiredSecrets: string[];
  /** Extra packages the generated `.blume/package.json` must declare. */
  runtimeDeps: string[];
}

/**
 * A value JSON can carry unchanged — what an adapter's passthrough options are
 * typed as. Structurally identical to what `z.json()` accepts.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * The schema for one descriptor `kind`, validating its `options` with the
 * adapter's own option schema. Members of a `z.discriminatedUnion("kind", …)`.
 */
export const adapterDescriptorSchema = <
  Kind extends string,
  Options extends z.ZodType,
>(
  kind: Kind,
  options: Options
) =>
  z.strictObject({
    kind: z.literal(kind),
    options,
    requiredSecrets: z.array(z.string()),
    runtimeDeps: z.array(z.string()),
  });
