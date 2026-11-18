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
from .secrets import get_api_key

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
            # W0.9: never read api_key from config.toml — secrets live in the
            # OS credential store (or the PHANTOM_API_KEY env override).
            if k == "api_key":
                continue
            if k in data and data[k]:
                cfg[k] = data[k]
    except FileNotFoundError:
        pass
    cfg["provider"] = os.environ.get("PHANTOM_PROVIDER", cfg["provider"])
    cfg["endpoint"] = os.environ.get("PHANTOM_LLM_ENDPOINT", cfg["endpoint"])
    cfg["model"] = os.environ.get("PHANTOM_MODEL", cfg["model"])
    cfg["api_key"] = get_api_key() or ""
    return cfg


def _decide_request_from_proto(request) -> DecideRequest:
    return DecideRequest(
        task_description=request.task_description,
        current_context=request.current_context,
        screenshot=request.screenshot or None,
        history=[(h.action, h.result, h.success) for h in request.history],
        # getattr keeps us compatible with stale generated stubs that predate
        # the screenshot_mime field; once regenerated it is always present.
        screenshot_mime=getattr(request, "screenshot_mime", "") or "",
        mode=request.mode or "safe",
        backend=request.backend,
    )


class PhantomLLMServicer(phantom_pb2_grpc.PhantomLLMServicer):
    def __init__(self, provider, cfg: dict | None = None):
        self.provider = provider
        self.cfg = cfg or {}
        # The injected provider is the default when a request omits `provider`
        # (e.g. the offline mock used by end-to-end tests).
        self.default_name = type(provider).__name__.removesuffix("Provider").lower()
        self._providers: dict[tuple[str, str, str], object] = {}

    def _provider_for(self, request):
        """B3: per-request provider/model/key_ref, cached by (provider, model, ref)."""
        name = (
            getattr(request, "provider", "")
            or self.cfg.get("provider")
            or self.default_name
            or "claude"
        ).strip().lower()
        model = (getattr(request, "model", "") or self.cfg.get("model") or "").strip() or None
        key_ref = (getattr(request, "key_ref", "") or "").strip()
        from .provider_config import resolve_key

        key = resolve_key(key_ref) if key_ref else self.cfg.get("api_key", "")
        endpoint = self.cfg.get("endpoint", "")
        if name == "openrouter" and not endpoint:
            endpoint = "https://openrouter.ai/api/v1"
        cache_key = (name, model or "", key_ref)
        if cache_key not in self._providers:
            self._providers[cache_key] = build_provider(
                name, api_key=key or "", endpoint=endpoint, model=model
            )
        return self._providers[cache_key]

    async def DecideAction(self, request, context):
        try:
            decision = await self._provider_for(request).decide(_decide_request_from_proto(request))
            # Defense in depth: re-normalize strictly on the server boundary so
            # no provider (including mocks that build ActionDecision directly)
            # can turn malformed/missing model output into a silent `done`.
            action = normalize_action_dict(
                {
                    "action_type": decision.action_type,
                    "action": decision.action,
                    "params": decision.params,
                    "reasoning": decision.reasoning,
                    "confidence": decision.confidence,
                },
                strict=True,
            )
        except ValueError as e:
            # Fail closed: surface a structured INVALID_ARGUMENT. The Rust
            # client treats this as permanent, retries at most once, and then
            # propagates a task error instead of reporting false success.
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"invalid model action: {e}")
        return phantom_pb2.ActionResponse(
            action_type=action["action_type"],
            action=action["action"],
            params=action["params"],
            reasoning=action["reasoning"],
            confidence=action["confidence"],
        )

    async def PlanTask(self, request, context):
        try:
            steps = await self._provider_for(request).plan(PlanRequest(task=request.task, mode=request.mode or "safe"))
        except ValueError as e:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"invalid plan: {e}")
        return phantom_pb2.PlanResponse(
            steps=[
                phantom_pb2.SubTask(order=s.order, description=s.description, backend=s.backend)
                for s in steps
            ]
        )

    async def StreamThinking(self, request, context):
        async for chunk in self._provider_for(request).stream(_decide_request_from_proto(request)):
            yield phantom_pb2.ThinkingChunk(text=chunk.text, phase=chunk.phase)


async def _serve() -> None:
    cfg = load_config()
    provider = build_provider(
        cfg["provider"], api_key=cfg["api_key"], endpoint=cfg["endpoint"], model=cfg["model"] or None
    )
    log.info("Phantom LLM service: provider=%s model=%s", provider.name, provider.model)

    server = grpc.aio.server()
    phantom_pb2_grpc.add_PhantomLLMServicer_to_server(
        PhantomLLMServicer(provider, cfg), server
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
