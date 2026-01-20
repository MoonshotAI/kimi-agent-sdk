# QuickStart

This guide will help you get started with the Kimi Agent SDK for Python in just a few minutes.

Kimi Agent SDK is a thin wrapper around Kimi Code(Formerly Kimi CLI), and provides programming interfaces for building your own agents based on Kimi Code. 

This means:

- Configuration and credentials follow the Kimi Code model.
- Tools, skills, and MCP servers are configured the same way as in the Kimi Code.
- If you already a user of Kimi Code, you can reuse all the configuration files and tools from Kimi Code out of the box.

## Installation

```bash
pip install kimi-agent-sdk
```

Alternatively,

```bash
uv add kimi-agent-sdk
```

## LLM Provider Configuration

There are several ways to configure the LLM provider API:

### Environment Variables

```bash
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo
```

### Configuration Object

You can pass a `Config` object to the `prompt` or `Session.create` method.

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

### Configuration File Path

You can also pass the path to a configuration file to the `prompt` or `Session.create` method.

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

For the configuration priority order, see [Config Overrides](https://moonshotai.github.io/kimi-cli/en/configuration/overrides.html#config-overrides).

## Your First Powerful Agent with Kimi Agent SDK

There are two ways to create agents with the Kimi Agent SDK: using the high-level `prompt` API, or the low-level `Session` API.

We recommend starting with the high-level `prompt` API. You can switch to the low-level `Session` API when you need more control over the agent.

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
> Note: In YOLO mode, all file modifications and shell commands are automatically executed. Use with caution.

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