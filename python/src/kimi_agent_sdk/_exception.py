"""
Custom exceptions for Kimi Agent SDK.

This module defines SDK-specific exceptions for validation and state management errors.
All exceptions inherit from KimiCLIException for consistent error handling across the SDK.

Key exceptions:

- `PromptValidationError` is raised when prompt configuration is invalid (e.g., neither yolo
  nor approval_handler_fn is provided).
- `SessionStateError` is raised when session operations are performed in invalid states (e.g.,
  prompting while already running or after closing).
"""

from __future__ import annotations

from kimi_cli.exception import KimiCLIException


class PromptValidationError(KimiCLIException, ValueError):
    """Invalid prompt configuration."""

    pass


class SessionStateError(KimiCLIException, RuntimeError):
    """Invalid session state for prompt execution."""

    pass
