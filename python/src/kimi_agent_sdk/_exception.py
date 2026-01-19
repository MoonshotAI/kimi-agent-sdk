from __future__ import annotations

from kimi_cli.exception import KimiCLIException


class PromptValidationError(KimiCLIException, ValueError):
    """Invalid prompt configuration."""

    pass


class SessionStateError(KimiCLIException, RuntimeError):
    """Invalid session state for prompt execution."""

    pass
