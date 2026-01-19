from __future__ import annotations

import asyncio

import pytest

from kimi_agent_sdk import PromptValidationError, Session, SessionStateError, prompt


class _DummyCLI:
    async def run(self, *_args, **_kwargs):
        if False:
            yield None


@pytest.mark.asyncio
async def test_prompt_requires_yolo_or_handler() -> None:
    with pytest.raises(PromptValidationError):
        await anext(prompt("hi"))


@pytest.mark.asyncio
async def test_prompt_rejects_yolo_with_handler() -> None:
    with pytest.raises(PromptValidationError):
        await anext(prompt("hi", yolo=True, approval_handler_fn=lambda _req: None))


@pytest.mark.asyncio
async def test_session_prompt_rejects_closed() -> None:
    session = Session(_DummyCLI())
    session._closed = True
    with pytest.raises(SessionStateError):
        await anext(session.prompt("hi"))


@pytest.mark.asyncio
async def test_session_prompt_rejects_already_running() -> None:
    session = Session(_DummyCLI())
    session._cancel_event = asyncio.Event()
    with pytest.raises(SessionStateError):
        await anext(session.prompt("hi"))
