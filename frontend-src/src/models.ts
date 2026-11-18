// User-facing provider/model catalog. All configuration happens in the app;
// the CLI and CI use the same config file but never show these controls.

export type ModelOption = { id: string; label: string; note?: string }
export type ProviderOption = {
  id: string
  label: string
  models: ModelOption[]
  needsKey: boolean
  needsEndpoint?: boolean
}

export const PROVIDERS: ProviderOption[] = [
  {
    id: "claude",
    label: "Anthropic Claude",
    needsKey: true,
    models: [
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", note: "balanced, vision" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1", note: "most capable" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "fast, low cost" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    needsKey: true,
    models: [
      { id: "gpt-4o", label: "GPT-4o", note: "balanced, vision" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", note: "fast, low cost" },
      { id: "gpt-4.1", label: "GPT-4.1", note: "long context" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", note: "fast" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", note: "long context" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", note: "low cost" },
    ],
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    needsKey: true,
    models: [
      { id: "meta/llama-3.2-90b-vision-instruct", label: "Llama 3.2 90B Vision", note: "free tier" },
      { id: "microsoft/phi-3.5-vision-instruct", label: "Phi 3.5 Vision", note: "compact" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    needsKey: true,
    needsEndpoint: true,
    models: [
      { id: "openai/gpt-4o", label: "GPT-4o via OpenRouter" },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet via OpenRouter" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    needsKey: false,
    needsEndpoint: true,
    models: [
      { id: "llama3.1", label: "Llama 3.1" },
      { id: "qwen2.5", label: "Qwen 2.5" },
      { id: "llama3.2-vision", label: "Llama 3.2 Vision" },
    ],
  },
  {
    id: "local",
    label: "Local OpenAI-compatible server",
    needsKey: false,
    needsEndpoint: true,
    models: [{ id: "llama3.1", label: "Custom local model" }],
  },
  {
    id: "mock",
    label: "Offline demo (no model)",
    needsKey: false,
    models: [{ id: "mock-1", label: "Deterministic mock" }],
  },
]

export function providerById(id: string): ProviderOption | undefined {
  return PROVIDERS.find((p) => p.id === id)
}
