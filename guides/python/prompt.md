# Prompt API

The `prompt` function is the high-level API for interacting with the Kimi Agent
runtime. It launches a temporary session, streams aggregated messages, and
handles approvals via either YOLO mode or a custom approval handler.

## Quick Example

The simplest use case is to stream the assistant's text output:

```python
import asyncio
from kimi_agent_sdk import prompt


async def main() -> None:
    async for message in prompt("Write a short README outline", yolo=True):
        print(message.extract_text(), end="", flush=True)
    print()

asyncio.run(main())
```

> Warning: `yolo=True` automatically approves all actions. Use it only in
> trusted environments.

## API Signature

```python
async def prompt(
    user_input: str | list[ContentPart],
    *,
    work_dir: KaosPath | str | None = None,
    config: Config | Path | None = None,
    model: str | None = None,
    thinking: bool = False,
    yolo: bool = False,
    approval_handler_fn: ApprovalHandlerFn | None = None,
    agent_file: Path | None = None,
    mcp_configs: list[MCPConfig] | list[dict[str, Any]] | None = None,
    skills_dir: KaosPath | None = None,
    max_steps_per_turn: int | None = None,
    max_retries_per_step: int | None = None,
    max_ralph_iterations: int | None = None,
    final_message_only: bool = False,
) -> AsyncGenerator[Message, None]
```

## Parameters

- `user_input`: A string prompt or a list of [ContentPart](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html#contentpart) objects (text, images, etc.).
- `work_dir`: Working directory for the agent's file operations and session
  state. Defaults to the current directory. It should be a valid KaosPath object.
- `config`: A `Config` instance or path to a config file. Uses the [Kimi Code Config](https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html#config-files)
  structure.
- `model`: Model name, e.g. `"kimi-k2-thinking-turbo"`.
- `thinking`: Enable thinking mode for models that support it.
- `yolo`: Auto-approve all approval requests. Mutually exclusive with manual
  approvals in practice.
- `approval_handler_fn`: Callback that receives an [`ApprovalRequest`](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html#approvalrequest) and must
  call `request.resolve(...)` with `"approve"`, `"approve_for_session"`, or
  `"reject"`. Required when `yolo=False`.
- `agent_file`: Path to a CLI agent spec file (tools, prompts, subagents).
- `mcp_configs`: MCP configuration objects or raw dictionaries. Matches the Kimi Code
  [MCP schema](https://moonshotai.github.io/kimi-cli/en/customization/mcp.html) (for example, `mcp.json`).
- `skills_dir`: Directory containing agent skills to load. It should be a valid KaosPath object.
- `max_steps_per_turn`: Limit the number of steps in a single turn.
- `max_retries_per_step`: Limit tool or step retries before failing.
- `max_ralph_iterations`: Extra iterations for Ralph mode (`-1` for unlimited).
- `final_message_only`: If `True`, yield only the final assistant message.

## Notes and Caveats

- You must provide either `yolo=True` or `approval_handler_fn`. If neither is
  provided, `PromptValidationError` is raised.
- If `yolo=True` and `approval_handler_fn` is provided, the handler is ignored.
- If your approval handler returns without calling `request.resolve(...)`, the
  SDK will reject the request by default.
- If your approval handler is async and never returns, the agent will keep
  waiting and the turn will not make progress.
- `final_message_only=True` returns only the last assistant message, which is
  useful for simple UI output but hides tool call details.

## What You Receive

Each yielded `Message` is a `kosong.message.Message` instance with:

- `role`: One of `system`, `user`, `assistant`, `tool`.
- `name`: Optional sender name (rare in prompt output).
- `content`: A list of content parts (text, thinking, images, audio, video), for more info about ContentParts see [here](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html#wire-message-types).
- `tool_calls`: Tool call requests associated with the message.
- `tool_call_id`: Tool call ID when the message is a tool response.
- `partial`: Whether the message is partial (may appear during streaming).

`Message` always stores content as a list of parts, even if a single string was
provided. Use `message.extract_text()` to concatenate text parts.

## Content Parts Example

You can send structured content instead of plain text:

```python
import asyncio
from kimi_agent_sdk import TextPart, prompt


async def main() -> None:
    async for message in prompt(
        [TextPart(text="Hi, write a brief poem about Kimi, and write it to a file called kimi_poem.md")],
        yolo=True,
    ):
        print(message.extract_text(), end="", flush=True)
    print()


asyncio.run(main())
```

## Approval Handling Example

Use a callback to approve or reject actions:

```python
import asyncio
from kimi_agent_sdk import ApprovalRequest, prompt


def handle_approval(request: ApprovalRequest) -> None:
    print(f"{request.action}: {request.description}")
    request.resolve("approve")


async def main() -> None:
    async for message in prompt(
        "List files in the current directory",
        approval_handler_fn=handle_approval,
    ):
        print(message.extract_text(), end="", flush=True)
    print()


asyncio.run(main())
```

You can also use an async function as the approval handler:

```python
import asyncio
from kimi_agent_sdk import ApprovalRequest, prompt


async def handle_approval(request: ApprovalRequest) -> None:
    print(f"{request.action}: {request.description}")
    # Simulate asking the user for approval.
    await asyncio.sleep(1)
    request.resolve("approve")


async def main() -> None:
    async for message in prompt(
        "List files in the current directory",
        approval_handler_fn=handle_approval,
    ):
        print(message.extract_text(), end="", flush=True)
    print()


asyncio.run(main())
```

## Final-Only Output Example

If you only want the final assistant text:

```python
import asyncio
from kimi_agent_sdk import prompt


async def main() -> None:
    async for message in prompt(
        "Summarize the meeting notes in three bullets",
        yolo=True,
        final_message_only=True,
    ):
        print(message.extract_text())


asyncio.run(main())
```
