"""Generate the Python gRPC stubs from proto/phantom.proto.

Outputs phantom_pb2.py and phantom_pb2_grpc.py next to this file (the python/
package root), which is where server.py imports them from.

Usage:  python generate_proto.py
"""

from __future__ import annotations

import os
import sys

from grpc_tools import protoc

HERE = os.path.dirname(os.path.abspath(__file__))
PROTO_DIR = os.path.normpath(os.path.join(HERE, "..", "proto"))
PROTO_FILE = os.path.join(PROTO_DIR, "phantom.proto")


def main() -> int:
    if not os.path.exists(PROTO_FILE):
        sys.stderr.write(f"proto not found: {PROTO_FILE}\n")
        return 1
    rc = protoc.main(
        [
            "grpc_tools.protoc",
            f"-I{PROTO_DIR}",
            f"--python_out={HERE}",
            f"--grpc_python_out={HERE}",
            PROTO_FILE,
        ]
    )
    if rc == 0:
        print(f"generated phantom_pb2.py / phantom_pb2_grpc.py in {HERE}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
