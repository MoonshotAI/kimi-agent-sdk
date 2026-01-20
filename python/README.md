# Kimi Agent SDK

Kimi Agent SDK exposes the Kimi CLI agent runtime as a Python library. It provides a
high-level prompt API for streaming assistant messages and a low-level Session API for
handling Wire messages and approvals yourself.

## Installation

Requires Python 3.12 or higher.

```bash
uv add kimi-agent-sdk
```

## Examples

### High-level prompt

```python
import asyncio
from kimi_agent_sdk import prompt


async def main() -> None:
    async for msg in prompt("Write a hello world program", yolo=True):
        print(msg.extract_text(), end="", flush=True)
    print()


asyncio.run(main())
```

### Manual approval handling (low-level)

```python
import asyncio
from kaos.path import KaosPath
from kimi_agent_sdk import ApprovalRequest, Session, TextPart


async def main() -> None:
    async with await Session.create(work_dir=KaosPath.cwd()) as session:
        async for wire_msg in session.prompt("List files in current directory"):
            match wire_msg:
                case TextPart(text=text):
                    print(text, end="", flush=True)
                case ApprovalRequest() as req:
                    req.resolve("approve")


asyncio.run(main())
```

## Notes

- `prompt()` creates a temporary session per call.
- `Session.prompt()` yields raw Wire messages and requires handling approvals.
- `work_dir` and `skills_dir` expect `KaosPath` values.
- See the API docstrings for more configuration options.
