import asyncio
import os
import pytest
import grpc

import phantom_pb2
import phantom_pb2_grpc
from phantom_llm.providers import build_provider
from phantom_llm.server import PhantomLLMServicer

pytestmark = pytest.mark.skipif(
    not os.getenv("ANTHROPIC_API_KEY"),
    reason="ANTHROPIC_API_KEY required for real LLM E2E test",
)

async def _start_server() -> tuple[grpc.aio.Server, int]:
    server = grpc.aio.server()
    phantom_pb2_grpc.add_PhantomLLMServicer_to_server(
        PhantomLLMServicer(build_provider("claude")), server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    return server, port

async def _run_claude_decide() -> tuple[str, str]:
    server, port = await _start_server()
    try:
        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            stub = phantom_pb2_grpc.PhantomLLMStub(channel)
            
            # Simple 1x1 black PNG
            black_png = (
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
                b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x00"
                b"\x00\x02\x00\x01\xe5\x27\xde\xfc\x00\x00\x00\x00IEND\xaeB`\x82"
            )
            
            action = await stub.DecideAction(
                phantom_pb2.ActionRequest(
                    screenshot=black_png,
                    task_description="I just uploaded a 1x1 black image. Acknowledge the image color and conclude the task by outputting a 'done' action.",
                    backend="browser",
                    mode="safe",
                )
            )
            return action.action_type, action.action
    finally:
        await server.stop(grace=None)

def test_claude_e2e_decide_action():
    atype, action = asyncio.run(_run_claude_decide())
    assert atype == "done"
