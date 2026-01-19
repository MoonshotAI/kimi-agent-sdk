from __future__ import annotations

import asyncio
import inspect
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import TYPE_CHECKING, Any

from kaos.path import KaosPath
from kimi_cli.app import KimiCLI
from kimi_cli.config import Config
from kimi_cli.session import Session as CliSession
from kimi_cli.soul import StatusSnapshot
from kimi_cli.wire.types import ContentPart, WireMessage

from kimi_agent_sdk._exception import SessionStateError

if TYPE_CHECKING:
    from kimi_agent_sdk import MCPConfig


def _coerce_work_dir(work_dir: Path | str | None) -> KaosPath:
    if work_dir is None:
        return KaosPath.cwd()
    if isinstance(work_dir, KaosPath):
        return work_dir.expanduser()
    if isinstance(work_dir, Path):
        return KaosPath.unsafe_from_local_path(work_dir).expanduser()
    return KaosPath(str(work_dir)).expanduser()


class Session:
    """
    Kimi Agent session with low-level control.

    Use this class when you need full access to Wire messages, manual approval
    handling, or session persistence across prompts.
    """

    def __init__(self, cli: KimiCLI) -> None:
        self._cli = cli
        self._cancel_event: asyncio.Event | None = None
        self._closed = False

    @staticmethod
    async def create(
        work_dir: Path | str | None = None,
        *,
        # Basic configuration
        session_id: str | None = None,
        config: Config | Path | None = None,
        model: str | None = None,
        thinking: bool = False,
        # Run mode
        yolo: bool = False,
        # Extensions
        agent_file: Path | None = None,
        mcp_configs: list[MCPConfig] | list[dict[str, Any]] | None = None,
        skills_dir: Path | None = None,
        # Loop control
        max_steps_per_turn: int | None = None,
        max_retries_per_step: int | None = None,
        max_ralph_iterations: int | None = None,
    ) -> Session:
        """
        Create a new Session instance.

        Args:
            work_dir: Working directory. Defaults to current directory.
            session_id: Custom session ID (optional).
            config: Configuration object or path to a config file.
            model: Model name, e.g. "kimi".
            thinking: Whether to enable thinking mode (requires model support).
            yolo: Automatically approve all approval requests.
            agent_file: Agent specification file path.
            mcp_configs: MCP server configurations.
            skills_dir: Skills directory.
            max_steps_per_turn: Maximum number of steps in one turn.
            max_retries_per_step: Maximum number of retries per step.
            max_ralph_iterations: Extra iterations in Ralph mode (-1 for unlimited).

        Returns:
            Session: A new Session instance.

        Raises:
            FileNotFoundError: When the agent file is not found.
            ConfigError(KimiCLIException, ValueError): When the configuration is invalid.
            AgentSpecError(KimiCLIException, ValueError): When the agent specification is invalid.
            InvalidToolError(KimiCLIException, ValueError): When any tool cannot be loaded.
            MCPConfigError(KimiCLIException, ValueError): When any MCP configuration is invalid.
            MCPRuntimeError(KimiCLIException, RuntimeError): When any MCP server cannot be
                connected.
        """
        work_dir_path = _coerce_work_dir(work_dir)
        cli_session = await CliSession.create(work_dir_path, session_id)
        cli = await KimiCLI.create(
            cli_session,
            config=config,
            model_name=model,
            thinking=thinking,
            yolo=yolo,
            agent_file=agent_file,
            mcp_configs=mcp_configs,
            skills_dir=skills_dir,
            max_steps_per_turn=max_steps_per_turn,
            max_retries_per_step=max_retries_per_step,
            max_ralph_iterations=max_ralph_iterations,
        )
        return Session(cli)

    @staticmethod
    async def resume(
        work_dir: Path | str,
        session_id: str | None = None,
        *,
        # Basic configuration
        config: Config | Path | None = None,
        model: str | None = None,
        thinking: bool = False,
        # Run mode
        yolo: bool = False,
        # Extensions
        agent_file: Path | None = None,
        mcp_configs: list[MCPConfig] | list[dict[str, Any]] | None = None,
        skills_dir: Path | None = None,
        # Loop control
        max_steps_per_turn: int | None = None,
        max_retries_per_step: int | None = None,
        max_ralph_iterations: int | None = None,
    ) -> Session | None:
        """
        Resume an existing session.

        Args:
            work_dir: Working directory to resume from.
            session_id: Session ID to resume. If None, resumes the most recent session.
            config: Configuration object or path to a config file.
            model: Model name, e.g. "kimi".
            thinking: Whether to enable thinking mode (requires model support).
            yolo: Automatically approve all approval requests.
            agent_file: Agent specification file path.
            mcp_configs: MCP server configurations.
            skills_dir: Skills directory.
            max_steps_per_turn: Maximum number of steps in one turn.
            max_retries_per_step: Maximum number of retries per step.
            max_ralph_iterations: Extra iterations in Ralph mode (-1 for unlimited).

        Returns:
            Session | None: The resumed session, or None if not found.

        Raises:
            FileNotFoundError: When the agent file is not found.
            ConfigError(KimiCLIException, ValueError): When the configuration is invalid.
            AgentSpecError(KimiCLIException, ValueError): When the agent specification is invalid.
            InvalidToolError(KimiCLIException, ValueError): When any tool cannot be loaded.
            MCPConfigError(KimiCLIException, ValueError): When any MCP configuration is invalid.
            MCPRuntimeError(KimiCLIException, RuntimeError): When any MCP server cannot be
                connected.
        """
        work_dir_path = _coerce_work_dir(work_dir)
        if session_id is None:
            cli_session = await CliSession.continue_(work_dir_path)
        else:
            cli_session = await CliSession.find(work_dir_path, session_id)
        if cli_session is None:
            return None
        cli = await KimiCLI.create(
            cli_session,
            config=config,
            model_name=model,
            thinking=thinking,
            yolo=yolo,
            agent_file=agent_file,
            mcp_configs=mcp_configs,
            skills_dir=skills_dir,
            max_steps_per_turn=max_steps_per_turn,
            max_retries_per_step=max_retries_per_step,
            max_ralph_iterations=max_ralph_iterations,
        )
        return Session(cli)

    @property
    def id(self) -> str:
        """Session ID."""
        return self._cli.session.id

    @property
    def model_name(self) -> str:
        """Name of the current model."""
        return self._cli.soul.model_name

    @property
    def status(self) -> StatusSnapshot:
        """Current status snapshot (context usage, yolo state, etc.)."""
        return self._cli.soul.status

    async def prompt(
        self,
        user_input: str | list[ContentPart],
        *,
        merge_wire_messages: bool = False,
    ) -> AsyncGenerator[WireMessage, None]:
        """
        Send a prompt and get a WireMessage stream.

        Args:
            user_input: User input, can be plain text or a list of content parts.
            merge_wire_messages: Whether to merge consecutive Wire messages.

        Yields:
            WireMessage: Wire messages, including ApprovalRequest.

        Raises:
            LLMNotSet: When the LLM is not set.
            LLMNotSupported: When the LLM does not have required capabilities.
            ChatProviderError: When the LLM provider returns an error.
            MaxStepsReached: When the maximum number of steps is reached.
            RunCancelled: When the run is cancelled by the cancel event.
            SessionStateError: When the session is closed or already running.

        Note:
            Callers must handle ApprovalRequest manually unless yolo=True.
        """
        if self._closed:
            raise SessionStateError("Session is closed")
        if self._cancel_event is not None:
            raise SessionStateError("Session is already running")
        cancel_event = asyncio.Event()
        self._cancel_event = cancel_event
        try:
            async for msg in self._cli.run(
                user_input,
                cancel_event,
                merge_wire_messages=merge_wire_messages,
            ):
                yield msg
        finally:
            if self._cancel_event is cancel_event:
                self._cancel_event = None

    def cancel(self) -> None:
        """
        Cancel the current prompt operation.

        This sets the cancel event used by the underlying KimiCLI.run call and
        results in RunCancelled being raised from the active prompt coroutine.
        """
        if self._cancel_event is not None:
            self._cancel_event.set()

    async def close(self) -> None:
        """
        Close the Session and release resources.

        This cancels any ongoing prompt and cleans up tool resources.
        """
        if self._closed:
            return
        self._closed = True
        if self._cancel_event is not None:
            self._cancel_event.set()
        toolset = getattr(self._cli.soul.agent, "toolset", None)
        cleanup = getattr(toolset, "cleanup", None)
        if cleanup is None:
            return
        result = cleanup()
        if inspect.isawaitable(result):
            await result

    async def __aenter__(self) -> Session:
        """Async context manager entry."""
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.close()
