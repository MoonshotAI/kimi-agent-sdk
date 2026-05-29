from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import pytest
from kaos.path import KaosPath
from kosong.message import Message

from kimi_agent_sdk import Session, prompt
from kimi_agent_sdk import _prompt as prompt_module
from kimi_agent_sdk import _session as session_module


@pytest.mark.asyncio
async def test_session_create_requires_kaos_work_dir() -> None:
    with pytest.raises(TypeError, match="work_dir must be KaosPath"):
        await Session.create(work_dir=cast(Any, Path(".")))


@pytest.mark.asyncio
async def test_session_resume_requires_kaos_work_dir() -> None:
    with pytest.raises(TypeError, match="work_dir must be KaosPath"):
        await Session.resume(cast(Any, Path(".")))


@pytest.mark.asyncio
async def test_session_create_requires_kaos_skills_dir() -> None:
    with pytest.raises(TypeError, match="skills_dir must be KaosPath"):
        await Session.create(work_dir=KaosPath.cwd(), skills_dir=cast(Any, Path(".")))


@pytest.mark.asyncio
async def test_prompt_requires_kaos_work_dir() -> None:
    with pytest.raises(TypeError, match="work_dir must be KaosPath"):
        await anext(prompt("hi", yolo=True, work_dir=cast(Any, Path("."))))


@pytest.mark.asyncio
async def test_prompt_requires_kaos_skills_dir() -> None:
    with pytest.raises(TypeError, match="skills_dir must be KaosPath"):
        await anext(prompt("hi", yolo=True, skills_dir=cast(Any, Path("."))))


@pytest.mark.asyncio
async def test_session_create_requires_kaos_skills_dirs() -> None:
    with pytest.raises(TypeError, match=r"skills_dirs\[0\] must be KaosPath"):
        await Session.create(work_dir=KaosPath.cwd(), skills_dirs=[cast(Any, Path("."))])


@pytest.mark.asyncio
async def test_session_create_accepts_kaos_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_kwargs: dict[str, Any] = {}

    async def _dummy_session_create(*_args: Any, **_kwargs: Any) -> Any:
        return object()

    async def _dummy_cli_create(*_args: Any, **_kwargs: Any) -> Any:
        captured_kwargs.update(_kwargs)
        return cast(Any, object())

    monkeypatch.setattr(session_module.CliSession, "create", _dummy_session_create)
    monkeypatch.setattr(session_module.KimiCLI, "create", _dummy_cli_create)

    session = await Session.create(work_dir=KaosPath.cwd(), skills_dir=KaosPath.cwd())
    assert isinstance(session, Session)
    assert captured_kwargs["skills_dirs"] == [KaosPath.cwd()]


@pytest.mark.asyncio
async def test_session_resume_accepts_kaos_skills_dirs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_kwargs: dict[str, Any] = {}

    async def _dummy_find(*_args: Any, **_kwargs: Any) -> Any:
        return object()

    async def _dummy_cli_create(*_args: Any, **_kwargs: Any) -> Any:
        captured_kwargs.update(_kwargs)
        return cast(Any, object())

    monkeypatch.setattr(session_module.CliSession, "find", _dummy_find)
    monkeypatch.setattr(session_module.KimiCLI, "create", _dummy_cli_create)

    session = await Session.resume(
        KaosPath.cwd(),
        session_id="test-session",
        skills_dirs=[KaosPath.cwd()],
    )
    assert isinstance(session, Session)
    assert captured_kwargs["skills_dirs"] == [KaosPath.cwd()]


@pytest.mark.asyncio
async def test_prompt_forwards_skills_dirs(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_kwargs: dict[str, Any] = {}

    class _DummySessionContext:
        async def __aenter__(self) -> _DummySessionContext:
            return self

        async def __aexit__(self, *_args: Any) -> None:
            return None

        async def prompt(self, *_args: Any, **_kwargs: Any):
            if False:
                yield None
            return

    async def _dummy_session_create(*_args: Any, **kwargs: Any) -> Any:
        captured_kwargs.update(kwargs)
        return _DummySessionContext()

    monkeypatch.setattr(prompt_module.Session, "create", _dummy_session_create)

    results: list[Message] = []
    async for message in prompt(
        "hi",
        yolo=True,
        skills_dirs=[KaosPath.cwd()],
    ):
        results.append(message)

    assert results == []
    assert captured_kwargs["skills_dirs"] == [KaosPath.cwd()]
