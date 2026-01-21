# Customized Tools

Kimi Agent SDK is a thin wrapper around Kimi Code (Kimi CLI), so custom tools
are defined exactly the same way: write a Python tool class, register it in an
agent file, and pass that agent file to `prompt()` or `Session.create(...)`.

If you already have a Kimi CLI agent file and tools, you can reuse them as-is.

## Step 1: Implement a tool

Create a tool class with a Pydantic parameter model and return `ToolOk` or
`ToolError`:

```python
from kimi_agent_sdk import CallableTool2, ToolError, ToolOk, ToolReturnValue
from pydantic import BaseModel, Field


class Params(BaseModel):
    directory: str = Field(
        default=".",
        description="The directory to list files from.",
    )


class Ls(CallableTool2):
    name: str = "Ls"
    description: str = "List files in a directory."
    params: type[Params] = Params

    async def __call__(self, params: Params) -> ToolReturnValue:
        import os

        try:
            files = os.listdir(params.directory)
            return ToolOk(output="\n".join(files))
        except Exception as exc:
            return ToolError(
                output="",
                message=str(exc),
                brief="Failed to list files",
            )
```

## Step 2: Make the tool importable

Ensure your module is importable by the Python process running the SDK:

```
my_tools/
  __init__.py
  ls.py
```

Options:

- Install your project package into the current environment.
- Or add the project root to `PYTHONPATH` when running your script.

## Step 3: Register the tool in an agent file

Add your tool path (`module:ClassName`) to `tools`. Note that `tools` replaces
the inherited list, so include every tool you want to keep.

```yaml
version: 1
agent:
  extend: default
  tools:
    - "kimi_cli.tools.multiagent:Task"
    - "kimi_cli.tools.todo:SetTodoList"
    - "kimi_cli.tools.shell:Shell"
    - "kimi_cli.tools.file:ReadFile"
    - "kimi_cli.tools.file:Glob"
    - "kimi_cli.tools.file:Grep"
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.web:SearchWeb"
    - "kimi_cli.tools.web:FetchURL"
    - "my_tools.ls:Ls" # custom tool
```

For full agent file format, see the
[Kimi Code agent docs](https://moonshotai.github.io/kimi-cli/en/customization/agents.html#custom-agent-files).

## Step 4: Use the agent file in Python

Pass the agent file path to `prompt()` or `Session.create(...)`:

```python
import asyncio
from pathlib import Path

from kimi_agent_sdk import prompt


async def main() -> None:
    async for msg in prompt(
        "What tools do you have?",
        agent_file=Path("myagent.yaml"),
        yolo=True,
    ):
        print(msg.extract_text(), end="", flush=True)
    print()


asyncio.run(main())
```

If you prefer the low-level API, use `Session.create(agent_file=...)` instead.

For full code examples, see [here](../../examples/python/customized-tools).
