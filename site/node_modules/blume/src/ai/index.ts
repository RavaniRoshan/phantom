/**
 * Assistant provider adapters for `blume.config.ts`:
 *
 * ```ts
 * import { defineConfig } from "blume";
 * import { openrouter } from "blume/ai";
 *
 * export default defineConfig({
 *   ai: {
 *     assistant: {
 *       enabled: true,
 *       provider: openrouter({ model: "anthropic/claude-sonnet-4-5" }),
 *     },
 *   },
 * });
 * ```
 *
 * Each factory returns a plain descriptor (see `core/adapter.ts`) that the
 * schema validates and the generated `/api/ask` route inlines as literals;
 * nothing here runs at request time.
 */
export {
  anthropic,
  gateway,
  gemini,
  grok,
  inkeep,
  llmgateway,
  openai,
  openaiCompatible,
  openrouter,
} from "./ask.ts";
export type {
  AssistantAdapter,
  AssistantAdapterOptions,
  AssistantAnthropicAdapter,
  AssistantAnthropicOptions,
  AssistantGatewayAdapter,
  AssistantGatewayOptions,
  AssistantGeminiAdapter,
  AssistantGeminiOptions,
  AssistantGrokAdapter,
  AssistantGrokOptions,
  AssistantInkeepAdapter,
  AssistantInkeepOptions,
  AssistantLlmGatewayAdapter,
  AssistantLlmGatewayOptions,
  AssistantOpenAIAdapter,
  AssistantOpenAICompatibleAdapter,
  AssistantOpenAICompatibleOptions,
  AssistantOpenAIOptions,
  AssistantOpenRouterAdapter,
  AssistantOpenRouterOptions,
  AssistantProviderOptions,
  AssistantReasoning,
} from "./ask.ts";
export type { AdapterDescriptor } from "../core/adapter.ts";
