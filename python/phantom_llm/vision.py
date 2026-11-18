"""Screenshot / vision helpers (provider-neutral).

W0.1 image transport contract (ADR-001): captures are normalized to PNG at the
source, but a declared MIME travels in the contract so providers never hard-code
a media type. This module is the single place that builds data URIs and decides
which MIME a screenshot actually is.
"""

from __future__ import annotations

import base64
from typing import Any

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"
GIF_MAGIC = b"GIF8"
WEBP_MAGIC = b"RIFF"

SUPPORTED_IMAGE_MIMES = frozenset(
    {"image/png", "image/jpeg", "image/gif", "image/webp"}
)
DEFAULT_IMAGE_MIME = "image/png"


def to_data_uri(data: bytes, media_type: str = DEFAULT_IMAGE_MIME) -> str:
    return f"data:{media_type};base64,{base64.b64encode(data).decode('ascii')}"


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def detect_image_mime(data: bytes) -> str:
    """Sniff the real image type from magic bytes (fail-safe default PNG)."""
    if data.startswith(PNG_MAGIC):
        return "image/png"
    if data.startswith(JPEG_MAGIC):
        return "image/jpeg"
    if data.startswith(GIF_MAGIC):
        return "image/gif"
    if data.startswith(WEBP_MAGIC) and len(data) >= 12 and data[8:12] == b"WEBP":
        return "image/webp"
    return DEFAULT_IMAGE_MIME


def effective_image_mime(data: bytes, declared: str | None = None) -> str:
    """Resolve the MIME to send to a provider.

    A declared MIME from the contract wins only when it is a supported image
    type; otherwise we sniff the bytes. This keeps a stale/malformed `mime`
    field from turning a PNG into an opaque blob for the model.
    """
    if declared:
        cleaned = declared.split(";", 1)[0].strip().lower()
        if cleaned in SUPPORTED_IMAGE_MIMES:
            return cleaned
    return detect_image_mime(data)


def encode_image(data: bytes, declared_mime: str | None = None) -> str:
    """Build a ``data:<mime>;base64,...`` URI honoring the declared MIME."""
    return to_data_uri(data, effective_image_mime(data, declared_mime))


def caption_hint(text: str) -> dict[str, Any]:
    """Placeholder for a future vision-pipeline step that summarizes a screenshot
    into text when the active model is text-only."""
    return {"note": "vision pipeline not yet implemented", "text": text}
