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
- `agent_file`: Path to a CLI agent spec file (tools, prompts, subagents), for more details see
  [Custom Agent Files](https://moonshotai.github.io/kimi-cli/en/customization/agents.html#custom-agent-files).
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
- `prompt()` creates a temporary session per call. You can only consume the
  messages from that single call and cannot continue a previous session through
  `prompt()`. For multi-turn or reusable sessions, use `Session`.
- `final_message_only=True` returns only the last assistant message, which is
  useful for simple UI output but hides tool call details.

## What You Receive

Each yielded `Message` is a `kosong.message.Message` instance with:

- `role`: One of `system`, `user`, `assistant`, `tool`.
- `name`: Optional sender name (rare in prompt output).
- `content`: A list of content parts (text, thinking, images, audio, video). See
  [ContentPart](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html#contentpart).
- `tool_calls`: Tool call requests associated with the message (assistant role).
- `tool_call_id`: Tool call ID when the message is a tool response (tool role).

`Message` always stores content as a list of parts, even if a single string was
provided. Use `message.extract_text()` to concatenate text parts.

In `prompt()`, you will receive `assistant` and `tool` roles only (system and
user roles are not emitted to callers). 

Role-specific examples:

Assistant message with plain text content:

```python
from kimi_agent_sdk import Message

message = Message(
    role="assistant",
    content="Hello! How can I help you?",
)
```

Assistant message with tool calls:

```python
from kimi_agent_sdk import Message, TextPart, ToolCall

message = Message(
    role="assistant",
    content=[TextPart(text="Let me check the current directory.")],
    tool_calls=[
        ToolCall(
            id="tc_1",
            type="function",
            function={"name": "Shell", "arguments": "{\"command\":\"ls\"}"},
        )
    ],
)
```

Tool message with a matching `tool_call_id`:

```python
from kimi_agent_sdk import Message, TextPart

message = Message(
    role="tool",
    tool_call_id="tc_1",
    content=[TextPart(text="file1.py\nfile2.py")],
)
```

Use `message.extract_text()` for human-readable text, or inspect
`message.content` for structured parts.

## Content Parts Example
You can send structured content instead of plain text:

```python
import asyncio
from kimi_agent_sdk import ImageURLPart, TextPart, prompt


async def main() -> None:
    async for message in prompt(
        [
            TextPart(text="Describe this image"),
            ImageURLPart(
                image_url=ImageURLPart.ImageURL(
                    url="data:image/png;base64,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"
                )
            ),
        ],
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
