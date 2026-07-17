"""End-to-end gRPC test of the PhantomLLM service.

Starts the real ``grpc.aio`` server (server.py wiring) backed by the offline
``mock`` provider, then drives it through an actual gRPC channel — exercising
PlanTask, DecideAction, and the StreamThinking server-stream. This is the test
that proves the Rust↔Python contract works, without any provider SDK or API key.
"""

from __future__ import annotations

import asyncio

import grpc
import pytest

# Stubs are ensured by conftest.py before this import runs.
import phantom_pb2
import phantom_pb2_grpc

from phantom_llm.providers import build_provider
from phantom_llm.server import PhantomLLMServicer


async def _start_server() -> tuple[grpc.aio.Server, int]:
    server = grpc.aio.server()
    phantom_pb2_grpc.add_PhantomLLMServicer_to_server(
        PhantomLLMServicer(build_provider("mock")), server
    )
    port = server.add_insecure_port("127.0.0.1:0")  # ephemeral port
    await server.start()
    return server, port


async def _run_all() -> dict:
    server, port = await _start_server()
    results: dict = {}
    try:
        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            stub = phantom_pb2_grpc.PhantomLLMStub(channel)

            # --- PlanTask ---
            plan = await stub.PlanTask(
                phantom_pb2.PlanRequest(
                    task="summarize the top story at https://example.com", mode="safe"
                )
            )
            results["plan"] = [(s.order, s.backend, s.description) for s in plan.steps]

            # --- DecideAction (first step of a browser task) ---
            action = await stub.DecideAction(
                phantom_pb2.ActionRequest(
                    task_description="summarize the top story at https://example.com",
                    backend="browser",
                    mode="safe",
                )
            )
            results["action"] = (action.action_type, action.action, dict(action.params))

            # --- StreamThinking (server stream) ---
            chunks = []
            async for chunk in stub.StreamThinking(
                phantom_pb2.ActionRequest(
                    task_description="run a command", backend="cli", mode="safe"
                )
            ):
                chunks.append((chunk.phase, chunk.text))
            results["chunks"] = chunks
    finally:
        await server.stop(grace=None)
    return results


def test_grpc_end_to_end_with_mock_provider():
    results = asyncio.run(_run_all())

    # Plan: mock routes a URL task to the browser backend, ordered from 1.
    plan = results["plan"]
    assert len(plan) >= 1
    assert plan[0][0] == 1
    assert all(s[1] == "browser" for s in plan)

    # DecideAction: first browser step is a navigate carrying the task's URL.
    atype, action, params = results["action"]
    assert atype == "browser"
    assert action == "navigate"
    assert params.get("url") == "https://example.com"

    # StreamThinking: at least the planning + observing chunks come through.
    chunks = results["chunks"]
    assert len(chunks) >= 2
    phases = {phase for phase, _ in chunks}
    assert "planning" in phases


def test_decide_action_loop_converges_to_done():
    """The scripted mock must terminate the observe→decide loop with `done`."""

    async def loop() -> str:
        server, port = await _start_server()
        try:
            async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
                stub = phantom_pb2_grpc.PhantomLLMStub(channel)
                history: list = []
                last = ""
                for _ in range(10):
                    resp = await stub.DecideAction(
                        phantom_pb2.ActionRequest(
                            task_description="read the file notes.txt",
                            backend="file",
                            mode="safe",
                            history=history,
                        )
                    )
                    last = resp.action_type
                    if resp.action_type == "done":
                        break
                    history.append(
                        phantom_pb2.ActionHistory(
                            action=resp.action, result="ok", success=True
                        )
                    )
                return last
        finally:
            await server.stop(grace=None)

    assert asyncio.run(loop()) == "done"
