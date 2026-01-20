# QuickStart

This guide will help you get started with the Kimi Agent SDK for Python in minutes.

## Installation

```bash
pip install kimi-agent-sdk
```

or

```bash
uv add kimi-agent-sdk
```

## LLM Provider Configuration

There are several ways to configure the LLM Provider API:

### Environment Variables

```bash
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo
```

### Configuration Object

you can pass a `Config` object to `prompt` or `Session.create` method.

```python
import asyncio
from kimi_agent_sdk import Config, Session, prompt
from kaos.path import KaosPath

config = Config(
    default_model="kimi-k2-thinking-turbo",
    providers={
        "kimi": {
            "type": "kimi",
            "base_url": "https://api.moonshot.ai/v1",
            "api_key": "your-api-key",
        }
    },
    models={
        "kimi-k2-thinking-turbo": {
            "provider": "kimi",
            "model": "kimi-k2-thinking-turbo",
        }
    },
)
async def main() -> None:
    async for msg in prompt("Hello, world!", config=config, yolo=True):
        print(msg.extract_text(), end="", flush=True)
    print()

asyncio.run(main())
```

For more configuration options, see [Kimi Code Configuration](https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html).

### Configuration File

You can also pass a configuration file path to `prompt` or `Session.create` method.

```python
from pathlib import Path
import asyncio
from kimi_agent_sdk import prompt

config_path = Path("/path/to/your/config.toml")

async def main() -> None:
    async for msg in prompt(
    "Hello, world!",
    config=config_path,
    yolo=True
):
    print(msg.extract_text(), end="", flush=True)
print()

asyncio.run(main())
```

For more info about configuration files, see [Kimi Code Configuration](https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html).

## Your First Powerful Agent with Kimi Agent SDK

There are two ways to create agents with Kimi Agent SDK, one is to use the high-level API `prompt`, the other is to use the low-level API `Session`.

We would recommend using the high-level API `prompt` as your starting point, you can change to the low-level API `Session` when you need more control over the agent.

### High-level API `prompt`

```python
import asyncio
from kimi_agent_sdk import prompt


async def main() -> None:
    async for msg in prompt("Write a hello world program", yolo=True):
        print(msg.extract_text(), end="", flush=True)
    print()


asyncio.run(main())
```

### Low-level API `Session`

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
                # Manual approval handling
                case ApprovalRequest() as req:
                    req.resolve("approve")


asyncio.run(main())
```
