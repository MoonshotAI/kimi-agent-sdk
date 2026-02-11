"""Tests for skill validation utilities."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from kimi_agent_sdk.skills.validator import SkillValidator, SkillValidationResult


class TestSkillValidator:
    """Tests for SkillValidator."""

    def test_valid_skill(self) -> None:
        """Test validation of a valid skill."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: test-skill
description: A test skill for validation. Use when testing the validation system.
---

# Test Skill

## Overview

This is a test skill.

## Usage

Use this skill for testing.
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert result.is_valid
            assert result.skill_name == "test-skill"
            assert "test" in result.description.lower()
            assert len(result.errors) == 0

    def test_missing_skill_md(self) -> None:
        """Test validation when SKILL.md is missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert not result.is_valid
            assert "SKILL.md not found" in result.errors[0]

    def test_missing_frontmatter(self) -> None:
        """Test validation when frontmatter is missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("# No Frontmatter\n\nThis skill has no frontmatter.")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert not result.is_valid
            assert any("line 1" in e.lower() for e in result.errors)

    def test_missing_required_fields(self) -> None:
        """Test validation when required fields are missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: test-skill
---

# Test Skill
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert not result.is_valid
            assert any("description" in e.lower() for e in result.errors)

    def test_invalid_name_format(self) -> None:
        """Test validation of invalid skill name."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "TestSkill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: TestSkill
description: Invalid name format.
---

# Test Skill
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert not result.is_valid
            assert any("kebab-case" in e.lower() for e in result.errors)

    def test_name_directory_mismatch(self) -> None:
        """Test validation when name doesn't match directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "my-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: different-name
description: Name doesn't match directory.
---

# Test Skill
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert result.is_valid  # Warning, not error
            assert any("directory name" in w.lower() for w in result.warnings)

    def test_description_too_short(self) -> None:
        """Test validation of short description."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: test-skill
description: Short.
---

# Test Skill
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert result.is_valid
            assert any("short" in w.lower() for w in result.warnings)

    def test_description_with_angle_brackets(self) -> None:
        """Test validation of description with angle brackets."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: test-skill
description: Use <skill> for something.
---

# Test Skill
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert not result.is_valid
            assert any("angle brackets" in e.lower() for e in result.errors)

    def test_unexpected_properties(self) -> None:
        """Test validation with unexpected frontmatter properties."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: test-skill
description: A test skill.
unexpected_field: value
---

# Test Skill
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert not result.is_valid
            assert any("unexpected" in e.lower() for e in result.errors)

    def test_validate_text_directly(self) -> None:
        """Test validation of text content directly."""
        content = """---
name: test-skill
description: A test skill for direct validation.
---

# Test Skill

## Overview

This is a test.
"""
        
        validator = SkillValidator()
        result = validator.validate_text(content, "test-skill")
        
        assert result.is_valid
        assert result.skill_name == "test-skill"

    def test_nonexistent_path(self) -> None:
        """Test validation of nonexistent path."""
        validator = SkillValidator()
        result = validator.validate("/nonexistent/path/to/skill")
        
        assert not result.is_valid
        assert "does not exist" in result.errors[0].lower()

    def test_file_instead_of_directory(self) -> None:
        """Test validation when path is a file."""
        with tempfile.NamedTemporaryFile() as tmpfile:
            validator = SkillValidator()
            result = validator.validate(tmpfile.name)
            
            assert not result.is_valid
            assert "not a directory" in result.errors[0].lower()

    def test_empty_body_warning(self) -> None:
        """Test warning for empty body."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: test-skill
description: A test skill.
---
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert result.is_valid
            assert any("empty" in w.lower() for w in result.warnings)

    def test_long_body_warning(self) -> None:
        """Test warning for very long body."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            # Create body with more than 500 lines
            body_lines = ["# Test Skill", ""] + [f"Line {i}" for i in range(600)]
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text(f"""---
name: test-skill
description: A test skill with a very long body.
---

{"\n".join(body_lines)}
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert result.is_valid
            assert any("long" in w.lower() for w in result.warnings)

    def test_no_code_blocks_warning(self) -> None:
        """Test warning for missing code blocks."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: test-skill
description: A test skill without code blocks.
---

# Test Skill

This skill has no code blocks.
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert result.is_valid
            assert any("code blocks" in w.lower() for w in result.warnings)

    def test_result_bool_conversion(self) -> None:
        """Test that result can be used as a boolean."""
        valid_result = SkillValidationResult(is_valid=True, errors=[], warnings=[])
        invalid_result = SkillValidationResult(is_valid=False, errors=["error"], warnings=[])
        
        assert bool(valid_result) is True
        assert bool(invalid_result) is False

    def test_invalid_yaml(self) -> None:
        """Test validation of invalid YAML."""
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_dir = Path(tmpdir) / "test-skill"
            skill_dir.mkdir()
            
            skill_md = skill_dir / "SKILL.md"
            skill_md.write_text("""---
name: [invalid: yaml: here
description: Invalid YAML.
---

# Test Skill
""")
            
            validator = SkillValidator()
            result = validator.validate(skill_dir)
            
            assert not result.is_valid
            assert any("yaml" in e.lower() for e in result.errors)
