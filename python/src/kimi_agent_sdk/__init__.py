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
    ToolReturnValue,
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
