"""Shared pytest fixtures / setup.

Ensures the generated gRPC stubs (``phantom_pb2`` / ``phantom_pb2_grpc``) exist
and are importable before any test that needs them runs. The stubs are generated
artifacts (gitignored), so we regenerate them on demand — this keeps the test
suite self-sufficient locally and in CI without a separate build step.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parent.parent

# Make both the package root (where phantom_pb2 lives) and the package itself
# importable regardless of the working directory pytest is invoked from.
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))


def _ensure_proto_stubs() -> None:
    """Generate phantom_pb2*.py if they are not already importable."""
    try:
        importlib.import_module("phantom_pb2")
        importlib.import_module("phantom_pb2_grpc")
        return
    except ModuleNotFoundError:
        pass

    from grpc_tools import protoc

    proto_dir = PYTHON_ROOT.parent / "proto"
    proto_file = proto_dir / "phantom.proto"
    rc = protoc.main(
        [
            "grpc_tools.protoc",
            f"-I{proto_dir}",
            f"--python_out={PYTHON_ROOT}",
            f"--grpc_python_out={PYTHON_ROOT}",
            str(proto_file),
        ]
    )
    if rc != 0:
        raise RuntimeError(f"protoc failed to generate stubs (rc={rc})")


# Run at import time so even module-level imports in test files succeed.
_ensure_proto_stubs()
