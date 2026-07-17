"""Provider registry. Lazy imports keep missing SDKs from breaking startup."""

from __future__ import annotations

_PROVIDERS = {
    "claude": "claude:ClaudeProvider",
    "openai": "openai:OpenAIProvider",
    "gemini": "gemini:GeminiProvider",
    "ollama": "ollama:OllamaProvider",
    # NVIDIA NIM (OpenAI-compatible) — free-tier vision models for zero-cost
    # live visual-reasoning testing. Keeps the neutral schema (no lock-in).
    "nvidia": "nvidia:NvidiaProvider",
    # Offline, deterministic, SDK-free provider — runs the whole stack without
    # an API key. Used for end-to-end tests and demos.
    "mock": "mock:MockProvider",
}


def build_provider(
    name: str, api_key: str = "", endpoint: str = "", model: str | None = None
):
    """Instantiate a provider by name. The provider's SDK is imported lazily."""
    if name not in _PROVIDERS:
        raise ValueError(
            f"unknown provider '{name}' (expected one of {sorted(_PROVIDERS)})"
        )
    module_name, class_name = _PROVIDERS[name].split(":")
    # Import the provider module from this package.
    import importlib

    module = importlib.import_module(f".{module_name}", __name__)
    cls = getattr(module, class_name)
    return cls(api_key=api_key, endpoint=endpoint, model=model)


def available() -> list[str]:
    return sorted(_PROVIDERS)
