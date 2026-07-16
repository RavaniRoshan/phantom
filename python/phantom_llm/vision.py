"""Screenshot / vision helpers (provider-neutral)."""

from __future__ import annotations

import base64
from typing import Any


def to_data_uri(data: bytes, media_type: str = "image/png") -> str:
    return f"data:{media_type};base64,{base64.b64encode(data).decode('ascii')}"


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def caption_hint(text: str) -> dict[str, Any]:
    """Placeholder for a future vision-pipeline step that summarizes a screenshot
    into text when the active model is text-only."""
    return {"note": "vision pipeline not yet implemented", "text": text}
