"""
Kimi Agent SDK is a Python SDK for building AI agents powered by Kimi.
It provides both high-level and low-level APIs for seamless agent integration, stateful sessions,
and tool orchestration in modern AI applications.

Key features:

- `kimi_agent_sdk.prompt` provides a high-level async generator API that sends prompts to Kimi
  and yields aggregated Message objects, handling approval requests automatically or via custom
  handlers.
- `kimi_agent_sdk.Session` offers low-level control with Wire message access, manual approval
  handling, session persistence, and context management for long-running agent interactions.
- Message structures, approval types, and exceptions are re-exported from kosong and kimi_cli
  for convenient access.

Example (high-level API):

```python
import asyncio

from kimi_agent_sdk import prompt


async def main() -> None:
    async for message in prompt(
        "What is the capital of France?",
        model="kimi",
        yolo=True,
    ):
        print(message.extract_text())


asyncio.run(main())
```

Example (low-level API with Session):

```python
import asyncio

from kaos.path import KaosPath

from kimi_agent_sdk import ApprovalRequest, Session


async def main() -> None:
    async with await Session.create(
        work_dir=KaosPath.cwd(),
        model="kimi",
        yolo=False,
    ) as session:
        async for wire_msg in session.prompt("What is the capital of France?"):
            if isinstance(wire_msg, ApprovalRequest):
                wire_msg.resolve("approve")
            else:
                print(wire_msg)


asyncio.run(main())
```
"""

from __future__ import annotations

from fastmcp.mcp_config import MCPConfig
from kimi_cli.config import Config
from kimi_cli.exception import (
    AgentSpecError,
    ConfigError,
    InvalidToolError,
    KimiCLIException,
    MCPConfigError,
    MCPRuntimeError,
)
from kimi_cli.soul import LLMNotSet, LLMNotSupported, MaxStepsReached, RunCancelled
from kimi_cli.wire.types import (
    ApprovalRequest,
    ApprovalRequestResolved,
    ApprovalResponseKind,
    BriefDisplayBlock,
    CompactionBegin,
    CompactionEnd,
    DiffDisplayBlock,
    DisplayBlock,
    Event,
    Request,
    StatusUpdate,
    StepBegin,
    StepInterrupted,
    SubagentEvent,
    TodoDisplayBlock,
    TokenUsage,
    ToolCallPart,
    ToolResult,
    TurnBegin,
    WireMessage,
    is_event,
    is_request,
)
from kosong.chat_provider import (
    APIConnectionError,
    APIEmptyResponseError,
    APIStatusError,
    APITimeoutError,
    ChatProviderError,
)
from kosong.message import (
    AudioURLPart,
    ContentPart,
    ImageURLPart,
    Message,
    TextPart,
    ThinkPart,
    ToolCall,
    VideoURLPart,
)
from kosong.tooling import CallableTool2, ToolError, ToolOk, ToolReturnValue

from kimi_agent_sdk._approval import ApprovalHandlerFn
from kimi_agent_sdk._exception import PromptValidationError, SessionStateError
from kimi_agent_sdk._prompt import prompt
from kimi_agent_sdk._session import Session

__all__ = [
    # Core API
    "prompt",
    "Session",
    # Approval
    "ApprovalHandlerFn",
    "ApprovalResponseKind",
    "ApprovalRequest",
    # High-level types
    "Message",
    "ContentPart",
    "TextPart",
    "ThinkPart",
    "ImageURLPart",
    "AudioURLPart",
    "VideoURLPart",
    "ToolCall",
    # Low-level types (Wire)
    "WireMessage",
    "Event",
    "Request",
    "TurnBegin",
    "StepBegin",
    "StepInterrupted",
    "CompactionBegin",
    "CompactionEnd",
    "StatusUpdate",
    "ToolCallPart",
    "ToolResult",
    "ToolReturnValue",
    "ApprovalRequestResolved",
    "SubagentEvent",
    "DisplayBlock",
    "BriefDisplayBlock",
    "DiffDisplayBlock",
    "TodoDisplayBlock",
    "TokenUsage",
    "is_event",
    "is_request",
    "CallableTool2",
    "ToolOk",
    "ToolError",
    # Exceptions
    "KimiAgentException",
    "ConfigError",
    "AgentSpecError",
    "InvalidToolError",
    "MCPConfigError",
    "MCPRuntimeError",
    "LLMNotSet",
    "LLMNotSupported",
    "ChatProviderError",
    "APIConnectionError",
    "APITimeoutError",
    "APIStatusError",
    "APIEmptyResponseError",
    "MaxStepsReached",
    "RunCancelled",
    "PromptValidationError",
    "SessionStateError",
    # Others
    "Config",
    "MCPConfig",
]

type KimiAgentException = KimiCLIException
