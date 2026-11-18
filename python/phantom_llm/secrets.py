"""W0.9 — read API keys from Windows Credential Manager (no key in config.toml).

The Rust side (`phantom_core::secrets`) writes/migrates credentials; this module
lets the Python LLM service read the same generic credentials via ctypes, so no
provider SDK or third-party package is needed. Env vars still win at the call
site (`PHANTOM_API_KEY`).

Off-Windows this is a no-op; CI supplies keys via environment variables.
"""

from __future__ import annotations

import sys
from typing import Any

API_KEY_TARGET = "phantom/api_key"


_WINAPI_CACHE = None


def _winapi():  # pragma: no cover - only defined on Windows
    """Build (and cache) the ctypes bindings — CREDENTIAL must be ONE class."""
    global _WINAPI_CACHE
    if _WINAPI_CACHE is not None:
        return _WINAPI_CACHE
    import ctypes
    from ctypes import wintypes

    class CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    api = ctypes.WinDLL("advapi32", use_last_error=True)
    api.CredReadW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.POINTER(CREDENTIAL)),
    ]
    api.CredReadW.restype = wintypes.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    api.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIAL), wintypes.DWORD]
    api.CredWriteW.restype = wintypes.BOOL
    api.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    api.CredDeleteW.restype = wintypes.BOOL
    _WINAPI_CACHE = (ctypes, wintypes, CREDENTIAL, api)
    return _WINAPI_CACHE


def get_secret(target: str = API_KEY_TARGET) -> str | None:
    """Return the UTF-8 secret stored at `target`, or None if absent."""
    if sys.platform != "win32":
        return None
    ctypes, _, CREDENTIAL, api = _winapi()
    ptr = ctypes.POINTER(CREDENTIAL)()
    ptr_ref = ctypes.cast(ctypes.byref(ptr), ctypes.POINTER(ctypes.POINTER(CREDENTIAL)))
    if not api.CredReadW(target, 1, 0, ptr_ref):
        return None
    try:
        cred = ptr.contents
        blob = ctypes.string_at(cred.CredentialBlob, cred.CredentialBlobSize)
        return blob.decode("utf-8")
    finally:
        api.CredFree(ctypes.cast(ptr, ctypes.c_void_p))


def set_secret(target: str, value: str) -> bool:  # pragma: no cover - Windows only
    """Store a generic credential. Used by tests and first-run setup."""
    if sys.platform != "win32":
        return False
    ctypes, _, CREDENTIAL, api = _winapi()
    blob = ctypes.create_string_buffer(value.encode("utf-8"))
    cred = CREDENTIAL()
    cred.Type = 1  # CRED_TYPE_GENERIC
    cred.TargetName = ctypes.c_wchar_p(target)
    cred.CredentialBlobSize = len(value.encode("utf-8"))
    cred.CredentialBlob = ctypes.cast(blob, ctypes.POINTER(ctypes.c_ubyte))
    cred.Persist = 2  # CRED_PERSIST_LOCAL_MACHINE
    return bool(api.CredWriteW(ctypes.cast(ctypes.byref(cred), ctypes.POINTER(CREDENTIAL)), 0))


def delete_secret(target: str) -> bool:  # pragma: no cover - Windows only
    """Remove a credential (test cleanup)."""
    if sys.platform != "win32":
        return False
    _, _, _, api = _winapi()
    return bool(api.CredDeleteW(target, 1, 0))


def get_api_key() -> str | None:
    """Resolve the provider API key: env first, then credential store.

    The legacy `api_key` value in config.toml is deliberately NOT read here —
    W0.9 requires keys to live in the OS store (or env).
    """
    import os

    env = os.environ.get("PHANTOM_API_KEY")
    if env:
        return env
    return get_secret(API_KEY_TARGET)
