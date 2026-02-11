"""
Skill file watching utilities.

Provides file system monitoring for skill development, enabling hot-reload
workflows and change detection.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum, auto
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Awaitable

if TYPE_CHECKING:
    from collections.abc import Sequence


class ChangeType(Enum):
    """Type of file change."""
    
    CREATED = auto()
    MODIFIED = auto()
    DELETED = auto()


@dataclass(frozen=True)
class SkillChangeEvent:
    """Event representing a skill file change.
    
    Attributes:
        skill_name: Name of the skill that changed
        skill_path: Path to the skill directory
        change_type: Type of change (created, modified, deleted)
        file_path: Specific file that changed (usually SKILL.md)
    """
    
    skill_name: str
    skill_path: Path
    change_type: ChangeType
    file_path: Path


# Type alias for change handler
ChangeHandler = Callable[[SkillChangeEvent], Awaitable[None] | None]


class SkillWatcher:
    """Watch skill directories for changes.
    
    Monitors SKILL.md files and triggers callbacks when skills are
    created, modified, or deleted. Useful for hot-reload development
    workflows.
    
    Example:
        ```python
        import asyncio
        from kimi_agent_sdk.skills import SkillWatcher, SkillChangeEvent
        
        async def on_change(event: SkillChangeEvent):
            print(f"Skill {event.skill_name} was {event.change_type.name}")
        
        # Method 1: Context manager (recommended)
        async with SkillWatcher("/path/to/skills", on_change=on_change) as watcher:
            await asyncio.sleep(3600)  # Watch for an hour
        
        # Method 2: Manual control
        watcher = SkillWatcher("/path/to/skills", on_change=on_change)
        await watcher.start()
        try:
            await asyncio.sleep(3600)
        finally:
            await watcher.stop()
        ```
    """
    
    def __init__(
        self,
        skills_dir: str | Path,
        *,
        poll_interval: float = 1.0,
        on_change: ChangeHandler | None = None,
    ) -> None:
        """Initialize the skill watcher.
        
        Args:
            skills_dir: Directory containing skill subdirectories
            poll_interval: How often to check for changes (in seconds)
            on_change: Callback function for change events
        """
        self.skills_dir = Path(skills_dir)
        self.poll_interval = poll_interval
        self.on_change = on_change
        
        self._task: asyncio.Task | None = None
        self._running = False
        self._stopped = asyncio.Event()
        
        # Track file mtimes: {file_path: mtime}
        self._mtimes: dict[Path, float] = {}
        
        # Track known skills: {skill_name: skill_path}
        self._known_skills: dict[str, Path] = {}
    
    async def start(self) -> None:
        """Start watching for skill changes.
        
        Scans the skills directory once to establish a baseline,
        then begins polling for changes.
        """
        if self._running:
            return
        
        # Verify directory exists
        if not self.skills_dir.exists():
            raise FileNotFoundError(f"Skills directory does not exist: {self.skills_dir}")
        
        if not self.skills_dir.is_dir():
            raise NotADirectoryError(f"Path is not a directory: {self.skills_dir}")
        
        # Initialize baseline
        await self._scan_all()
        
        # Start watching
        self._running = True
        self._stopped.clear()
        self._task = asyncio.create_task(self._watch_loop())
    
    async def stop(self) -> None:
        """Stop watching for changes.
        
        Cancels the watch loop and waits for it to complete.
        """
        if not self._running:
            return
        
        self._running = False
        
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        
        self._stopped.set()
    
    async def __aenter__(self) -> SkillWatcher:
        """Async context manager entry."""
        await self.start()
        return self
    
    async def __aexit__(self, *args: object) -> None:
        """Async context manager exit."""
        await self.stop()
    
    async def _watch_loop(self) -> None:
        """Main watch loop."""
        while self._running:
            try:
                await self._check_changes()
            except asyncio.CancelledError:
                break
            except Exception as e:
                # Log error but continue watching
                print(f"Error in watch loop: {e}")
            
            try:
                await asyncio.wait_for(
                    self._stopped.wait(),
                    timeout=self.poll_interval
                )
            except asyncio.TimeoutError:
                continue
    
    async def _scan_all(self) -> None:
        """Scan all skills to establish baseline."""
        self._mtimes.clear()
        self._known_skills.clear()
        
        if not self.skills_dir.exists():
            return
        
        for skill_dir in self.skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue
            
            skill_md = skill_dir / "SKILL.md"
            if skill_md.exists():
                try:
                    stat = skill_md.stat()
                    self._mtimes[skill_md] = stat.st_mtime
                    self._known_skills[skill_dir.name] = skill_dir
                except OSError:
                    pass
    
    async def _check_changes(self) -> None:
        """Check for and process changes."""
        if not self.skills_dir.exists():
            return
        
        current_files: set[Path] = set()
        current_skills: dict[str, Path] = {}
        
        # Scan current state
        for skill_dir in self.skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue
            
            skill_md = skill_dir / "SKILL.md"
            skill_name = skill_dir.name
            
            if skill_md.exists():
                current_files.add(skill_md)
                current_skills[skill_name] = skill_dir
                
                try:
                    stat = skill_md.stat()
                    mtime = stat.st_mtime
                    
                    if skill_md in self._mtimes:
                        if self._mtimes[skill_md] != mtime:
                            # File modified
                            event = SkillChangeEvent(
                                skill_name=skill_name,
                                skill_path=skill_dir,
                                change_type=ChangeType.MODIFIED,
                                file_path=skill_md,
                            )
                            await self._emit(event)
                    else:
                        # New skill
                        event = SkillChangeEvent(
                            skill_name=skill_name,
                            skill_path=skill_dir,
                            change_type=ChangeType.CREATED,
                            file_path=skill_md,
                        )
                        await self._emit(event)
                    
                    self._mtimes[skill_md] = mtime
                    
                except OSError:
                    pass
        
        # Check for deleted skills
        for skill_md in list(self._mtimes.keys()):
            if skill_md not in current_files:
                skill_name = skill_md.parent.name
                event = SkillChangeEvent(
                    skill_name=skill_name,
                    skill_path=skill_md.parent,
                    change_type=ChangeType.DELETED,
                    file_path=skill_md,
                )
                await self._emit(event)
                del self._mtimes[skill_md]
                if skill_name in self._known_skills:
                    del self._known_skills[skill_name]
        
        # Update known skills
        self._known_skills = current_skills
    
    async def _emit(self, event: SkillChangeEvent) -> None:
        """Emit a change event."""
        if self.on_change:
            result = self.on_change(event)
            if asyncio.iscoroutine(result):
                await result
    
    def get_known_skills(self) -> dict[str, Path]:
        """Get currently known skills.
        
        Returns:
            Dictionary mapping skill names to their paths
        """
        return self._known_skills.copy()
    
    async def force_refresh(self) -> list[SkillChangeEvent]:
        """Force a refresh and return all detected changes.
        
        This is useful for manual synchronization when you want
        to check for changes on demand rather than waiting for
        the polling interval.
        
        Returns:
            List of detected change events
        """
        old_mtimes = self._mtimes.copy()
        old_skills = self._known_skills.copy()
        
        await self._scan_all()
        
        changes: list[SkillChangeEvent] = []
        
        # Detect changes by comparing old and new state
        all_skills = set(old_skills.keys()) | set(self._known_skills.keys())
        
        for skill_name in all_skills:
            if skill_name in self._known_skills and skill_name not in old_skills:
                # Created
                skill_path = self._known_skills[skill_name]
                changes.append(SkillChangeEvent(
                    skill_name=skill_name,
                    skill_path=skill_path,
                    change_type=ChangeType.CREATED,
                    file_path=skill_path / "SKILL.md",
                ))
            elif skill_name in old_skills and skill_name not in self._known_skills:
                # Deleted
                skill_path = old_skills[skill_name]
                changes.append(SkillChangeEvent(
                    skill_name=skill_name,
                    skill_path=skill_path,
                    change_type=ChangeType.DELETED,
                    file_path=skill_path / "SKILL.md",
                ))
            else:
                # Check for modification
                old_path = old_skills[skill_name] / "SKILL.md"
                new_path = self._known_skills[skill_name] / "SKILL.md"
                
                old_mtime = old_mtimes.get(old_path, 0)
                new_mtime = self._mtimes.get(new_path, 0)
                
                if old_mtime != new_mtime:
                    changes.append(SkillChangeEvent(
                        skill_name=skill_name,
                        skill_path=self._known_skills[skill_name],
                        change_type=ChangeType.MODIFIED,
                        file_path=new_path,
                    ))
        
        return changes
