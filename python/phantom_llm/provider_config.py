"""B3 — provider registry, validate-on-save outcomes and capability precedence.

Stdlib only: the GUI can call these helpers through the sidecar without any
provider SDK installed. This module never logs or stores a secret.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from .secrets import get_api_key, get_secret

# One record shape for all five provider families (ADR-011).
@dataclass(frozen=True)
class ProviderSpec:
    name: str
    auth: str                  # bearer | x-api-key | x-goog-api-key | none
    base_url: str
    discovery: str             # path appended to base_url
    key_prefix: str
    capabilities_from_api: bool
    price_from_api: bool


PROVIDERS: dict[str, ProviderSpec] = {
    "openai": ProviderSpec("openai", "bearer", "https://api.openai.com/v1", "/models", "sk-", False, False),
    "anthropic": ProviderSpec("anthropic", "x-api-key", "https://api.anthropic.com", "/v1/models", "sk-ant-", True, False),
    "gemini": ProviderSpec("gemini", "x-goog-api-key", "https://generativelanguage.googleapis.com/v1beta", "/models", "", True, False),
    "openrouter": ProviderSpec("openrouter", "bearer", "https://openrouter.ai/api/v1", "/models", "sk-or-v1-", True, True),
    "local": ProviderSpec("local", "none", "http://localhost:11434/v1", "/models", "", False, False),
}

# Shipped fallback capability table for providers whose /models has no metadata
# (OpenAI). Unknown models are text-only — never advertise an unverified vision.
STATIC_CAPS: dict[str, set[str]] = {
    "gpt-4o": {"vision", "tools"},
    "gpt-4.1": {"vision", "tools", "reasoning"},
    "claude": {"vision", "tools", "reasoning"},
    "gemini": {"vision", "tools", "reasoning"},
    "qwen": {"vision", "tools"},
}

STATIC_PRICE: dict[str, tuple[float, float]] = {
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gpt-4o-mini": (0.15, 0.60),
}


def spec(provider: str) -> ProviderSpec:
    p = (provider or "").strip().lower()
    if p not in PROVIDERS:
        raise ValueError(f"unknown provider '{provider}' (expected one of {sorted(PROVIDERS)})")
    return PROVIDERS[p]


def normalize_base_url(provider: str, base: str = "") -> str:
    """Use the provider default, or normalize a custom OpenAI-compatible URL."""
    if not base:
        return spec(provider).base_url
    url = base.strip().rstrip("/")
    if provider in {"openai", "openrouter", "local"} and not url.endswith("/v1"):
        url += "/v1"
    return url


def resolve_key(key_ref: str = "") -> str | None:
    """Resolve a key by credential target; no key is ever read from config.toml."""
    if key_ref:
        env_name = "PHANTOM_KEY_" + key_ref.replace("/", "_").replace("-", "_").upper()
        return os.environ.get(env_name) or get_secret(key_ref)
    return get_api_key()


def validate_outcome(status: int, model_count: int | None = None) -> str:
    """Six explicit outcomes for the wizard, never a bare boolean."""
    if status == 200:
        return "accepted" if (model_count or 0) > 0 else "connected_no_models"
    if status == 401:
        return "key_rejected"
    if status == 403:
        return "api_not_enabled"
    if status == 429:
        return "rate_limited"
    return "unreachable"


def capabilities(provider: str, model_id: str, live: dict | None = None) -> set[str]:
    """Live metadata → OpenRouter params → shipped table → unknown (text-only)."""
    if live:
        caps = set()
        if live.get("image_input") or live.get("vision"):
            caps.add("vision")
        if live.get("tools"):
            caps.add("tools")
        if live.get("thinking") or live.get("reasoning"):
            caps.add("reasoning")
        return caps
    mid = model_id.lower()
    for prefix, caps in STATIC_CAPS.items():
        if prefix in mid:
            return set(caps)
    return set()


def price_per_million(provider: str, model_id: str, live_price: float | None = None,
                      sentinel: float | None = None) -> tuple[float, float] | None:
    """Return (input, output) per 1M tokens, or None when unknown.

    OpenRouter uses -1 as a sentinel for router models — never present it as free.
    """
    if sentinel is not None and sentinel < 0:
        return None
    if live_price is not None:
        return (0.0, live_price) if live_price == 0 else (live_price, live_price)
    return STATIC_PRICE.get(model_id.lower())
