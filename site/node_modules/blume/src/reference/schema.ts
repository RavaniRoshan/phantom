import { z } from "zod";

import { unrecognizedKeysMessage } from "../core/unrecognized-keys.ts";
import { asyncapiAdapterSchema } from "./asyncapi.ts";
import type { AsyncApiAdapter, ResolvedAsyncApiAdapter } from "./asyncapi.ts";
import { graphqlAdapterSchema } from "./graphql.ts";
import type { GraphqlAdapter, ResolvedGraphqlAdapter } from "./graphql.ts";
import { openapiAdapterSchema } from "./openapi.ts";
import type { OpenApiAdapter, ResolvedOpenApiAdapter } from "./openapi.ts";
import { SCALAR_RUNTIME_DEPS, scalarAdapterSchema } from "./scalar.ts";
import type { ResolvedScalarAdapter, ScalarAdapter } from "./scalar.ts";

/** Every descriptor a `blume/reference` factory can return. */
export type ReferenceAdapter =
  | AsyncApiAdapter
  | GraphqlAdapter
  | OpenApiAdapter
  | ScalarAdapter;

/** What `config.reference` holds: each descriptor with its options resolved. */
export type ResolvedReferenceAdapter =
  | ResolvedAsyncApiAdapter
  | ResolvedGraphqlAdapter
  | ResolvedOpenApiAdapter
  | ResolvedScalarAdapter;

/**
 * One configured reference adapter, as its factory returned it. Only `kind`
 * and `options` carry information — the metadata lists are validated for
 * shape, then re-derived from the resolved options so a descriptor that went
 * through JSON resolves to the same canonical metadata the factory ships.
 */
export const referenceAdapterSchema = z
  .discriminatedUnion("kind", [
    asyncapiAdapterSchema,
    graphqlAdapterSchema,
    openapiAdapterSchema,
    scalarAdapterSchema,
  ])
  .transform((value): ResolvedReferenceAdapter => ({
    ...value,
    requiredSecrets: [],
    // Blume's own renderer parses at generate time and needs nothing; the
    // Scalar embed is imported by its generated page.
    runtimeDeps: value.kind === "scalar" ? [...SCALAR_RUNTIME_DEPS] : [],
  }));

const LIST_HINT =
  'reference is a list of adapters — e.g. `reference: [openapi({ spec }), asyncapi({ spec }), graphql({ spec, endpoint }), scalar({ spec })]`, imported from "blume/reference".';

/**
 * `blume.config.reference`: the API references to render, in order. Unset
 * means none. A non-array fails with the list hint; element errors keep their
 * own messages.
 */
export const referenceConfigSchema = z
  .array(referenceAdapterSchema, {
    error: (issue) => (issue.code === "invalid_type" ? LIST_HINT : undefined),
  })
  .default([]);

/** The top-level keys the `reference` list replaced. */
const REMOVED_KEYS: readonly string[] = ["asyncapi", "graphql", "openapi"];

/**
 * The hint for a config still carrying the 1.x `openapi`/`asyncapi`/`graphql`
 * blocks, or `undefined` when none of the unrecognized keys is one of them
 * (so the default "unrecognized key" message applies). Wired into the root
 * config object's error hook: the keys are gone from the schema, so without
 * this a migrating site would see only "Unrecognized key". Any other unknown
 * key keeps Zod's wording beside the hint, and the rest of the config is
 * still validated in the same run.
 */
export const removedReferenceKeysHint = (
  keys: string[]
): string | undefined => {
  const removed = REMOVED_KEYS.filter((key) => keys.includes(key));
  if (removed.length === 0) {
    return undefined;
  }
  const list = removed.map((key) => `\`${key}\``).join(", ");
  const factories = removed.map((key) => `${key}({ … })`).join(", ");
  const hint = `The top-level ${list} config was replaced by \`reference\`, a list of adapters imported from "blume/reference": \`reference: [${factories}]\`. Each block's options move onto its factory unchanged (\`enabled\` is gone — an adapter in the list is enabled), and a block with \`renderer: "scalar"\` becomes its own \`scalar({ spec, theme, …scalar })\` adapter in the list.`;
  const others = keys.filter((key) => !REMOVED_KEYS.includes(key));
  return others.length > 0
    ? `${hint} ${unrecognizedKeysMessage(others)}`
    : hint;
};
