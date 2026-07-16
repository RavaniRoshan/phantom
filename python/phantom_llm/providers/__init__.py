"""Provider registry. Lazy imports keep missing SDKs from breaking startup."""

from __future__ import annotations

_PROVIDERS = {
    "claude": "claude:ClaudeProvider",
    "openai": "openai:OpenAIProvider",
    "gemini": "gemini:GeminiProvider",
    "ollama": "ollama:OllamaProvider",
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
