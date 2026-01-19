from __future__ import annotations

import inspect
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import TYPE_CHECKING, Any

from kimi_cli.config import Config
from kimi_cli.wire.types import ApprovalRequest
from kosong.message import ContentPart, Message

from kimi_agent_sdk._aggregator import MessageAggregator
from kimi_agent_sdk._approval import ApprovalHandlerFn
from kimi_agent_sdk._exception import PromptValidationError
from kimi_agent_sdk._session import Session

if TYPE_CHECKING:
    from fastmcp.mcp_config import MCPConfig


async def prompt(
    user_input: str | list[ContentPart],
    *,
    # Basic configuration
    work_dir: Path | str | None = None,
    config: Config | Path | None = None,
    model: str | None = None,
    thinking: bool = False,
    # Run mode
    yolo: bool = False,
    approval_handler_fn: ApprovalHandlerFn | None = None,
    # Extensions
    agent_file: Path | None = None,
    mcp_configs: list[MCPConfig] | list[dict[str, Any]] | None = None,
    skills_dir: Path | None = None,
    # Loop control
    max_steps_per_turn: int | None = None,
    max_retries_per_step: int | None = None,
    max_ralph_iterations: int | None = None,
    # Output control
    final_message_only: bool = False,
) -> AsyncGenerator[Message, None]:
    """
    Send a prompt to the Kimi Agent and get streaming responses.

    This is the highest-level API that aggregates Wire messages into Message objects,
    similar to `kimi --print --output stream-json`.

    Args:
        user_input: User input, can be plain text or a list of content parts.
        work_dir: Working directory. Defaults to current directory.
        config: Configuration object or path to a config file.
        model: Model name, e.g. "kimi".
        thinking: Whether to enable thinking mode (requires model support).
        yolo: Automatically approve all approval requests.
        approval_handler_fn: Custom approval handler callback (sync or async).
        agent_file: Agent specification file path.
        mcp_configs: MCP server configurations.
        skills_dir: Skills directory.
        max_steps_per_turn: Maximum number of steps in one turn.
        max_retries_per_step: Maximum number of retries per step.
        max_ralph_iterations: Extra iterations in Ralph mode (-1 for unlimited).
        final_message_only: Only return the final Message of the last step.

    Yields:
        Message: Aggregated assistant/tool messages.

    Raises:
        LLMNotSet: When the LLM is not set.
        LLMNotSupported: When the LLM does not have required capabilities.
        ChatProviderError: When the LLM provider returns an error.
        MaxStepsReached: When the maximum number of steps is reached.
        RunCancelled: When the run is cancelled by the cancel event.
        PromptValidationError: When neither of yolo/approval_handler_fn are provided.

    Note:
        If yolo=True and approval_handler_fn is provided, the handler is ignored.
    """

    if not yolo and approval_handler_fn is None:
        raise PromptValidationError("Either yolo=True or approval_handler_fn must be provided")

    def _auto_approve(request: ApprovalRequest) -> None:
        request.resolve("approve")

    if yolo:
        approval_handler: ApprovalHandlerFn = _auto_approve
    else:
        assert approval_handler_fn is not None
        approval_handler = approval_handler_fn

    async with await Session.create(
        work_dir=work_dir,
        config=config,
        model=model,
        thinking=thinking,
        yolo=yolo,
        agent_file=agent_file,
        mcp_configs=mcp_configs,
        skills_dir=skills_dir,
        max_steps_per_turn=max_steps_per_turn,
        max_retries_per_step=max_retries_per_step,
        max_ralph_iterations=max_ralph_iterations,
    ) as session:
        aggregator = MessageAggregator(final_message_only=final_message_only)
        async for wire_msg in session.prompt(user_input, merge_wire_messages=True):
            if isinstance(wire_msg, ApprovalRequest):
                result = approval_handler(wire_msg)
                if inspect.isawaitable(result):
                    await result
                if not wire_msg.resolved:
                    wire_msg.resolve("reject")
                continue

            for message in aggregator.feed(wire_msg):
                yield message

        for message in aggregator.flush():
            yield message
