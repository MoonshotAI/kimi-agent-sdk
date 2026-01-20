from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import pytest
from kaos.path import KaosPath

from kimi_agent_sdk import Session, prompt
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
async def test_session_create_accepts_kaos_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _dummy_session_create(*_args: Any, **_kwargs: Any) -> Any:
        return object()

    async def _dummy_cli_create(*_args: Any, **_kwargs: Any) -> Any:
        return cast(Any, object())

    monkeypatch.setattr(session_module.CliSession, "create", _dummy_session_create)
    monkeypatch.setattr(session_module.KimiCLI, "create", _dummy_cli_create)

    session = await Session.create(work_dir=KaosPath.cwd(), skills_dir=KaosPath.cwd())
    assert isinstance(session, Session)
