/**
 * Providers for the "Open in chat" page action, in display order. Shared by
 * the config schema (`ai.openInChat` subsets validate against this list) and
 * the PageActions menu (which renders the full list when the config is `true`).
 * Lives outside `schema.ts` so the component can import the list without
 * pulling the whole config schema into the layout module graph.
 */
export const openInChatProviders = [
  "v0",
  "chatgpt",
  "claude",
  "t3",
  "scira",
  "cursor",
] as const;

export type OpenInChatProvider = (typeof openInChatProviders)[number];
