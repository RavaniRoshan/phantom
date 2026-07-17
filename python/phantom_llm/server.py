"""gRPC server implementing the PhantomLLM service.

Run with:  python -m phantom_llm.server   (after generating proto stubs)
See generate_proto.py — you must generate phantom_pb2 / phantom_pb2_grpc first.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

import grpc

# Generated stubs live at the python/ package root (see generate_proto.py).
import phantom_pb2
import phantom_pb2_grpc

from .providers import build_provider
from .providers.base import DecideRequest, PlanRequest
from .schema import normalize_action_dict, normalize_plan_dict

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("phantom.llm")


def load_config() -> dict:
    """Load config from ~/.phantom/config.toml (Python 3.11 tomllib) + env vars.

    Env vars win over the file so the running shell can override the provider.
    """
    cfg = {"provider": "claude", "api_key": "", "endpoint": "", "model": ""}
    path = os.path.expanduser("~/.phantom/config.toml")
    try:
        import tomllib

        with open(path, "rb") as f:
            data = tomllib.load(f)
        for k in cfg:
            if k in data and data[k]:
                cfg[k] = data[k]
    except FileNotFoundError:
        pass
    cfg["provider"] = os.environ.get("PHANTOM_PROVIDER", cfg["provider"])
    cfg["api_key"] = os.environ.get("PHANTOM_API_KEY", cfg["api_key"])
    cfg["endpoint"] = os.environ.get("PHANTOM_LLM_ENDPOINT", cfg["endpoint"])
    cfg["model"] = os.environ.get("PHANTOM_MODEL", cfg["model"])
    return cfg


def _decide_request_from_proto(request) -> DecideRequest:
    return DecideRequest(
        task_description=request.task_description,
        current_context=request.current_context,
        screenshot=request.screenshot or None,
        history=[(h.action, h.result, h.success) for h in request.history],
        mode=request.mode or "safe",
        backend=request.backend,
    )


class PhantomLLMServicer(phantom_pb2_grpc.PhantomLLMServicer):
    def __init__(self, provider):
        self.provider = provider

    async def DecideAction(self, request, context):
        decision = await self.provider.decide(_decide_request_from_proto(request))
        return phantom_pb2.ActionResponse(
            action_type=decision.action_type,
            action=decision.action,
            params=decision.params,
            reasoning=decision.reasoning,
            confidence=decision.confidence,
        )

    async def PlanTask(self, request, context):
        steps = await self.provider.plan(PlanRequest(task=request.task, mode=request.mode or "safe"))
        return phantom_pb2.PlanResponse(
            steps=[
                phantom_pb2.SubTask(order=s.order, description=s.description, backend=s.backend)
                for s in steps
            ]
        )

    async def StreamThinking(self, request, context):
        async for chunk in self.provider.stream(_decide_request_from_proto(request)):
            yield phantom_pb2.ThinkingChunk(text=chunk.text, phase=chunk.phase)


async def _serve() -> None:
    cfg = load_config()
    provider = build_provider(
        cfg["provider"], api_key=cfg["api_key"], endpoint=cfg["endpoint"], model=cfg["model"] or None
    )
    log.info("Phantom LLM service: provider=%s model=%s", provider.name, provider.model)

    server = grpc.aio.server()
    phantom_pb2_grpc.add_PhantomLLMServicer_to_server(
        PhantomLLMServicer(provider), server
    )
    port = os.environ.get("PHANTOM_GRPC_PORT", "50051")
    # Bind IPv4 wildcard so the Rust gRPC client (which connects to the IPv4
    # loopback 127.0.0.1) always reaches it, including on Windows runners where
    # an IPv6-only `[::]` listener can be unreachable over IPv4.
    server.add_insecure_port(f"0.0.0.0:{port}")
    await server.start()
    log.info("listening on [::]:%s", port)
    await server.wait_for_termination()


def main() -> None:
    # Ensure the package root (where phantom_pb2 lives) is importable.
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    try:
        asyncio.run(_serve())
    except KeyboardInterrupt:
        log.info("shutdown")


if __name__ == "__main__":
    main()
