from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from typing import Any, cast

import pytest
from kimi_cli.app import KimiCLI

from kimi_agent_sdk import (
    APIStatusError,
    ChatProviderError,
    LLMNotSet,
    LLMNotSupported,
    MaxStepsReached,
    PromptValidationError,
    RunCancelled,
    Session,
    SessionStateError,
    prompt,
)
from kimi_agent_sdk import _prompt as prompt_module
from kimi_agent_sdk import _session as session_module


class _DummyCLI:
    async def run(self, *_args: Any, **_kwargs: Any) -> AsyncGenerator[Any, None]:
        return
        yield


class _FailingCLI:
    def __init__(self, exc: BaseException) -> None:
        self._exc = exc

    async def run(self, *_args: Any, **_kwargs: Any) -> AsyncGenerator[Any, None]:
        raise self._exc
        return
        yield


class _DummyLLM:
    model_name = "dummy"


class _DummySession:
    async def __aenter__(self) -> _DummySession:
        return self

    async def __aexit__(self, *_args: Any) -> None:
        return None

    async def prompt(self, *_args: Any, **_kwargs: Any) -> AsyncGenerator[Any, None]:
        return
        yield


@pytest.mark.asyncio
async def test_prompt_requires_yolo_or_handler() -> None:
    with pytest.raises(PromptValidationError):
        await anext(prompt("hi"))


@pytest.mark.asyncio
async def test_prompt_allows_yolo_with_handler(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _dummy_create(*_args: Any, **_kwargs: Any) -> _DummySession:
        return _DummySession()

    monkeypatch.setattr(prompt_module.Session, "create", _dummy_create)

    with pytest.raises(StopAsyncIteration):
        await anext(prompt("hi", yolo=True, approval_handler_fn=lambda _req: None))


@pytest.mark.asyncio
async def test_session_prompt_rejects_closed() -> None:
    session = Session(cast(KimiCLI, _DummyCLI()))
    cast(Any, session)._closed = True
    with pytest.raises(SessionStateError):
        await anext(session.prompt("hi"))


@pytest.mark.asyncio
async def test_session_prompt_rejects_already_running() -> None:
    session = Session(cast(KimiCLI, _DummyCLI()))
    cast(Any, session)._cancel_event = asyncio.Event()
    with pytest.raises(SessionStateError):
        await anext(session.prompt("hi"))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc",
    [
        LLMNotSet(),
        LLMNotSupported(cast(Any, _DummyLLM()), ["image_in"]),
        MaxStepsReached(5),
        RunCancelled(),
        ChatProviderError("provider failure"),
        APIStatusError(500, "status failure"),
    ],
)
async def test_session_prompt_propagates_cli_exceptions(exc: BaseException) -> None:
    session = Session(cast(KimiCLI, _FailingCLI(exc)))
    with pytest.raises(type(exc)):
        await anext(session.prompt("hi"))


@pytest.mark.asyncio
async def test_session_create_propagates_file_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _dummy_session_create(*_args: Any, **_kwargs: Any) -> Any:
        return object()

    async def _raise_create(*_args: Any, **_kwargs: Any) -> Any:
        raise FileNotFoundError("missing agent")

    monkeypatch.setattr(session_module.CliSession, "create", _dummy_session_create)
    monkeypatch.setattr(session_module.KimiCLI, "create", _raise_create)

    with pytest.raises(FileNotFoundError):
        await Session.create()
