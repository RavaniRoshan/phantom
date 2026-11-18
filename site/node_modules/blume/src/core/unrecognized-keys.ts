/**
 * Zod's own wording for unknown keys no removed-key hint covers, appended to
 * a hint so an unrelated typo isn't silently dropped from the diagnostic
 * beside it. Shared by every config object that names a removed field's
 * replacement (the root config, `ai.assistant`, `openapi()`/`asyncapi()`, …).
 */
export const unrecognizedKeysMessage = (keys: string[]): string =>
  `Unrecognized key${keys.length > 1 ? "s" : ""}: ${keys
    .map((key) => JSON.stringify(key))
    .join(", ")}`;
