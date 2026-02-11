"""
Skill development utilities for Kimi Agent SDK.

This module provides tools for skill development, validation, and monitoring.
It helps developers create, test, and debug skills programmatically.

Example:
    ```python
    from kimi_agent_sdk.skills import SkillValidator, SkillWatcher
    
    # Validate a skill
    validator = SkillValidator()
    result = validator.validate("/path/to/my-skill")
    print(result.is_valid)
    
    # Watch for changes
    async with SkillWatcher("/path/to/skills", on_change=reload_skill) as watcher:
        await asyncio.sleep(3600)  # Watch for an hour
    ```
"""

from __future__ import annotations

from kimi_agent_sdk.skills.validator import SkillValidationResult, SkillValidator
from kimi_agent_sdk.skills.watcher import SkillWatcher, SkillChangeEvent

__all__ = [
    "SkillValidator",
    "SkillValidationResult",
    "SkillWatcher",
    "SkillChangeEvent",
]
