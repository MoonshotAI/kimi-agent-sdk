from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from kaos.path import KaosPath
from pydantic import BaseModel, Field
from kosong.tooling import (
    CallableTool2 as KosongCallableTool2,
    ToolError as KosongToolError,
    ToolOk as KosongToolOk,
    ToolReturnValue as KosongToolReturnValue,
)

from kimi_agent_sdk import (
    CallableTool2,
    Config,
    Session,
    ToolError,
    ToolOk,
    ToolReturnValue,
)


def test_tooling_exports_match_kosong() -> None:
    assert CallableTool2 is KosongCallableTool2
    assert ToolOk is KosongToolOk
    assert ToolError is KosongToolError
    assert ToolReturnValue is KosongToolReturnValue


def test_custom_tool_uses_sdk_exports() -> None:
    class Params(BaseModel):
        directory: str = Field(default=".")

    class Ls(CallableTool2):
        name: str = "Ls"
        description: str = "List files in a directory."
        params: type[Params] = Params

        async def __call__(self, params: Params) -> ToolReturnValue:
            return ToolOk(output="ok")

    result = asyncio.run(Ls()(Params()))
    assert isinstance(result, ToolReturnValue)
    assert result.is_error is False


@pytest.mark.asyncio
async def test_agent_loads_custom_tool(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tools_dir = tmp_path / "my_tools"
    tools_dir.mkdir()
    (tools_dir / "__init__.py").write_text("", encoding="utf-8")
    (tools_dir / "ls.py").write_text(
        "\n".join(
            [
                "from pydantic import BaseModel, Field",
                "from kimi_agent_sdk import CallableTool2, ToolOk, ToolReturnValue",
                "",
                "",
                "class Params(BaseModel):",
                "    directory: str = Field(default='.')",
                "",
                "",
                "class Ls(CallableTool2):",
                "    name: str = 'Ls'",
                "    description: str = 'List files in a directory.'",
                "    params: type[Params] = Params",
                "",
                "    async def __call__(self, params: Params) -> ToolReturnValue:",
                "        return ToolOk(output='ok')",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "system.md").write_text("You are a test agent.", encoding="utf-8")
    agent_file = tmp_path / "agent.yaml"
    agent_file.write_text(
        "\n".join(
            [
                "version: 1",
                "agent:",
                "  name: test-agent",
                "  system_prompt_path: ./system.md",
                "  tools:",
                "    - \"my_tools.ls:Ls\"",
                "",
            ]
        ),
        encoding="utf-8",
    )

    monkeypatch.syspath_prepend(str(tmp_path))

    async with await Session.create(
        work_dir=KaosPath(str(tmp_path)),
        config=Config(),
        agent_file=agent_file,
    ) as session:
        tool = session._cli.soul.agent.toolset.find("Ls")
        assert tool is not None
        assert tool.__class__.__module__ == "my_tools.ls"
