"""Tests for skill watching utilities."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import pytest

from kimi_agent_sdk.skills.watcher import (
    SkillWatcher,
    SkillChangeEvent,
    ChangeType,
)


class TestSkillWatcher:
    """Tests for SkillWatcher."""

    @pytest.mark.asyncio
    async def test_start_stop(self) -> None:
        """Test starting and stopping the watcher."""
        with tempfile.TemporaryDirectory() as tmpdir:
            watcher = SkillWatcher(tmpdir, poll_interval=0.1)
            
            # Should not raise
            await watcher.start()
            assert watcher._running
            
            await watcher.stop()
            assert not watcher._running

    @pytest.mark.asyncio
    async def test_context_manager(self) -> None:
        """Test using watcher as async context manager."""
        with tempfile.TemporaryDirectory() as tmpdir:
            async with SkillWatcher(tmpdir, poll_interval=0.1) as watcher:
                assert watcher._running
            
            assert not watcher._running

    @pytest.mark.asyncio
    async def test_nonexistent_directory(self) -> None:
        """Test error when directory doesn't exist."""
        watcher = SkillWatcher("/nonexistent/path")
        
        with pytest.raises(FileNotFoundError):
            await watcher.start()

    @pytest.mark.asyncio
    async def test_file_instead_of_directory(self) -> None:
        """Test error when path is a file."""
        with tempfile.NamedTemporaryFile() as tmpfile:
            watcher = SkillWatcher(tmpfile.name)
            
            with pytest.raises(NotADirectoryError):
                await watcher.start()

    @pytest.mark.asyncio
    async def test_detect_new_skill(self) -> None:
        """Test detecting a newly created skill."""
        with tempfile.TemporaryDirectory() as tmpdir:
            changes: list[SkillChangeEvent] = []
            
            def on_change(event: SkillChangeEvent) -> None:
                changes.append(event)
            
            async with SkillWatcher(tmpdir, poll_interval=0.1, on_change=on_change):
                # Wait for initial scan
                await asyncio.sleep(0.2)
                
                # Create a new skill
                skill_dir = Path(tmpdir) / "new-skill"
                skill_dir.mkdir()
                (skill_dir / "SKILL.md").write_text("""---
name: new-skill
description: A new skill.
---

# New Skill
""")
                
                # Wait for detection
                await asyncio.sleep(0.2)
            
            assert len(changes) >= 1
            created_events = [e for e in changes if e.change_type == ChangeType.CREATED]
            assert len(created_events) >= 1
            assert created_events[0].skill_name == "new-skill"

    @pytest.mark.asyncio
    async def test_detect_modified_skill(self) -> None:
        """Test detecting a modified skill."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create initial skill
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text("""---
name: test-skill
description: Original description.
---

# Test Skill
""")
            
            changes: list[SkillChangeEvent] = []
            
            def on_change(event: SkillChangeEvent) -> None:
                changes.append(event)
            
            async with SkillWatcher(tmpdir, poll_interval=0.1, on_change=on_change):
                # Wait for initial scan
                await asyncio.sleep(0.2)
                
                # Modify the skill
                (skill_dir / "SKILL.md").write_text("""---
name: test-skill
description: Modified description.
---

# Test Skill

Modified content.
""")
                
                # Wait for detection
                await asyncio.sleep(0.2)
            
            modified_events = [e for e in changes if e.change_type == ChangeType.MODIFIED]
            assert len(modified_events) >= 1
            assert modified_events[0].skill_name == "test-skill"

    @pytest.mark.asyncio
    async def test_detect_deleted_skill(self) -> None:
        """Test detecting a deleted skill."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create initial skill
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text("""---
name: test-skill
description: A skill to be deleted.
---

# Test Skill
""")
            
            changes: list[SkillChangeEvent] = []
            
            def on_change(event: SkillChangeEvent) -> None:
                changes.append(event)
            
            async with SkillWatcher(tmpdir, poll_interval=0.1, on_change=on_change):
                # Wait for initial scan
                await asyncio.sleep(0.2)
                
                # Delete the skill
                (skill_dir / "SKILL.md").unlink()
                
                # Wait for detection
                await asyncio.sleep(0.2)
            
            deleted_events = [e for e in changes if e.change_type == ChangeType.DELETED]
            assert len(deleted_events) >= 1
            assert deleted_events[0].skill_name == "test-skill"

    @pytest.mark.asyncio
    async def test_async_callback(self) -> None:
        """Test async callback function."""
        with tempfile.TemporaryDirectory() as tmpdir:
            changes: list[SkillChangeEvent] = []
            
            async def on_change_async(event: SkillChangeEvent) -> None:
                await asyncio.sleep(0.01)  # Simulate async work
                changes.append(event)
            
            async with SkillWatcher(tmpdir, poll_interval=0.1, on_change=on_change_async):
                await asyncio.sleep(0.2)
                
                skill_dir = Path(tmpdir) / "async-skill"
                skill_dir.mkdir()
                (skill_dir / "SKILL.md").write_text("""---
name: async-skill
description: Testing async callback.
---

# Async Skill
""")
                
                await asyncio.sleep(0.2)
            
            created_events = [e for e in changes if e.change_type == ChangeType.CREATED]
            assert len(created_events) >= 1

    @pytest.mark.asyncio
    async def test_get_known_skills(self) -> None:
        """Test getting known skills."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create some skills
            for name in ["skill-a", "skill-b"]:
                skill_dir = Path(tmpdir) / name
                skill_dir.mkdir()
                (skill_dir / "SKILL.md").write_text(f"""---
name: {name}
description: Skill {name}.
---

# Skill {name}
""")
            
            async with SkillWatcher(tmpdir, poll_interval=0.1) as watcher:
                await asyncio.sleep(0.2)
                
                known = watcher.get_known_skills()
                assert "skill-a" in known
                assert "skill-b" in known

    @pytest.mark.asyncio
    async def test_force_refresh(self) -> None:
        """Test force refresh functionality."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create initial skill
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text("""---
name: test-skill
description: Original.
---

# Test
""")
            
            async with SkillWatcher(tmpdir, poll_interval=10.0) as watcher:
                await asyncio.sleep(0.2)
                
                # Modify without waiting for poll
                (skill_dir / "SKILL.md").write_text("""---
name: test-skill
description: Modified.
---

# Test

Modified.
""")
                
                # Force refresh
                changes = await watcher.force_refresh()
                
                assert len(changes) == 1
                assert changes[0].skill_name == "test-skill"
                assert changes[0].change_type == ChangeType.MODIFIED

    @pytest.mark.asyncio
    async def test_ignore_non_skill_directories(self) -> None:
        """Test that directories without SKILL.md are ignored."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a directory without SKILL.md
            regular_dir = Path(tmpdir) / "not-a-skill"
            regular_dir.mkdir()
            (regular_dir / "some-file.txt").write_text("Not a skill")
            
            changes: list[SkillChangeEvent] = []
            
            def on_change(event: SkillChangeEvent) -> None:
                changes.append(event)
            
            async with SkillWatcher(tmpdir, poll_interval=0.1, on_change=on_change):
                await asyncio.sleep(0.2)
                
                # Modify the non-skill directory
                (regular_dir / "some-file.txt").write_text("Still not a skill")
                
                await asyncio.sleep(0.2)
            
            # Should not detect any changes
            assert len(changes) == 0

    @pytest.mark.asyncio
    async def test_multiple_changes(self) -> None:
        """Test detecting multiple changes in sequence."""
        with tempfile.TemporaryDirectory() as tmpdir:
            changes: list[SkillChangeEvent] = []
            
            def on_change(event: SkillChangeEvent) -> None:
                changes.append(event)
            
            async with SkillWatcher(tmpdir, poll_interval=0.1, on_change=on_change):
                await asyncio.sleep(0.2)
                
                # Create skill 1
                skill1 = Path(tmpdir) / "skill-1"
                skill1.mkdir()
                (skill1 / "SKILL.md").write_text("""---
name: skill-1
description: First skill.
---

# Skill 1
""")
                
                await asyncio.sleep(0.2)
                
                # Create skill 2
                skill2 = Path(tmpdir) / "skill-2"
                skill2.mkdir()
                (skill2 / "SKILL.md").write_text("""---
name: skill-2
description: Second skill.
---

# Skill 2
""")
                
                await asyncio.sleep(0.2)
            
            created_events = [e for e in changes if e.change_type == ChangeType.CREATED]
            assert len(created_events) >= 2
            skill_names = {e.skill_name for e in created_events}
            assert "skill-1" in skill_names
            assert "skill-2" in skill_names

    @pytest.mark.asyncio
    async def test_idempotent_start(self) -> None:
        """Test that starting an already running watcher is a no-op."""
        with tempfile.TemporaryDirectory() as tmpdir:
            watcher = SkillWatcher(tmpdir, poll_interval=0.1)
            
            await watcher.start()
            first_task = watcher._task
            
            # Starting again should not create new task
            await watcher.start()
            assert watcher._task is first_task
            
            await watcher.stop()

    @pytest.mark.asyncio
    async def test_idempotent_stop(self) -> None:
        """Test that stopping an already stopped watcher is a no-op."""
        with tempfile.TemporaryDirectory() as tmpdir:
            watcher = SkillWatcher(tmpdir, poll_interval=0.1)
            
            await watcher.start()
            await watcher.stop()
            
            # Stopping again should not raise
            await watcher.stop()
            assert not watcher._running

    @pytest.mark.asyncio
    async def test_change_event_attributes(self) -> None:
        """Test that change events have correct attributes."""
        with tempfile.TemporaryDirectory() as tmpdir:
            received_event: SkillChangeEvent | None = None
            
            def on_change(event: SkillChangeEvent) -> None:
                nonlocal received_event
                received_event = event
            
            async with SkillWatcher(tmpdir, poll_interval=0.1, on_change=on_change):
                await asyncio.sleep(0.2)
                
                skill_dir = Path(tmpdir) / "test-skill"
                skill_dir.mkdir()
                (skill_dir / "SKILL.md").write_text("""---
name: test-skill
description: Test.
---

# Test
""")
                
                await asyncio.sleep(0.2)
            
            assert received_event is not None
            assert received_event.skill_name == "test-skill"
            assert received_event.skill_path == skill_dir
            assert received_event.file_path == skill_dir / "SKILL.md"
            assert received_event.change_type == ChangeType.CREATED

    def test_change_type_enum(self) -> None:
        """Test ChangeType enum values."""
        assert ChangeType.CREATED.name == "CREATED"
        assert ChangeType.MODIFIED.name == "MODIFIED"
        assert ChangeType.DELETED.name == "DELETED"
        
        # Test auto values are distinct
        assert len({ChangeType.CREATED, ChangeType.MODIFIED, ChangeType.DELETED}) == 3
