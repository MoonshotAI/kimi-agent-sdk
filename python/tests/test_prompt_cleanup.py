from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from typing import Any, cast

import pytest
from kimi_cli.app import KimiCLI
from kimi_cli.wire.types import StepBegin, WireMessage
from kosong.message import TextPart

from kimi_agent_sdk import Session, prompt
from kimi_agent_sdk import _prompt as prompt_module


@pytest.mark.asyncio
async def test_session_prompt_closes_cli_stream_before_reuse() -> None:
    active_streams: list[AsyncGenerator[WireMessage, None]] = []
    events: list[str] = []

    class StreamingCLI:
        def run(self, *_args: Any, **_kwargs: Any) -> AsyncGenerator[WireMessage, None]:
            async def stream() -> AsyncGenerator[WireMessage, None]:
                events.append("started")
                try:
                    yield TextPart(text="hello")
                finally:
                    await asyncio.sleep(0)
                    events.append("closed")

            result = stream()
            active_streams.append(result)
            return result

    session = Session(cast(KimiCLI, StreamingCLI()))
    try:
        for _ in range(2):
            response = session.prompt("hi")
            assert await anext(response) == TextPart(text="hello")
            await response.aclose()

        assert events == ["started", "closed", "started", "closed"]
    finally:
        for stream in active_streams:
            await stream.aclose()


@pytest.mark.asyncio
async def test_prompt_closes_wire_stream_before_session_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    active_streams: list[AsyncGenerator[WireMessage, None]] = []
    events: list[str] = []

    class StreamingSession:
        async def __aenter__(self) -> StreamingSession:
            return self

        async def __aexit__(self, *_args: Any) -> None:
            events.append("session closed")

        def prompt(self, *_args: Any, **_kwargs: Any) -> AsyncGenerator[WireMessage, None]:
            async def stream() -> AsyncGenerator[WireMessage, None]:
                try:
                    yield TextPart(text="hello")
                    yield StepBegin(n=2)
                finally:
                    await asyncio.sleep(0)
                    events.append("stream closed")

            result = stream()
            active_streams.append(result)
            return result

    async def create(*_args: Any, **_kwargs: Any) -> StreamingSession:
        return StreamingSession()

    monkeypatch.setattr(prompt_module.Session, "create", create)
    response = prompt("hi", yolo=True)
    try:
        assert (await anext(response)).extract_text() == "hello"
        await response.aclose()
        assert events == ["stream closed", "session closed"]
    finally:
        await response.aclose()
        for stream in active_streams:
            await stream.aclose()
