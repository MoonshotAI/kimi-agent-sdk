"""
Skill validation utilities.

Provides comprehensive validation for skill structure, format, and content.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence


@dataclass(frozen=True)
class SkillValidationResult:
    """Result of skill validation.
    
    Attributes:
        is_valid: Whether the skill passed all validation checks
        errors: List of error messages
        warnings: List of warning messages
        skill_name: Name of the skill (if detected)
        description: Description of the skill (if detected)
    """
    
    is_valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    skill_name: str | None = None
    description: str | None = None
    
    def __bool__(self) -> bool:
        """Return True if validation passed."""
        return self.is_valid


class SkillValidator:
    """Validator for skill directories and SKILL.md files.
    
    Validates:
    - Directory structure
    - YAML frontmatter format and required fields
    - Markdown content structure
    - Naming conventions
    - Description quality
    
    Example:
        ```python
        validator = SkillValidator()
        
        # Validate a skill directory
        result = validator.validate("/path/to/my-skill")
        
        if result.is_valid:
            print(f"✅ Skill '{result.skill_name}' is valid")
        else:
            print("❌ Validation failed:")
            for error in result.errors:
                print(f"  - {error}")
        ```
    """
    
    # Maximum lengths per spec
    MAX_NAME_LENGTH = 64
    MAX_DESCRIPTION_LENGTH = 1024
    MAX_COMPATIBILITY_LENGTH = 500
    
    # Allowed frontmatter properties
    ALLOWED_PROPERTIES = {"name", "description", "license", "allowed-tools", "metadata", "compatibility"}
    
    def __init__(self) -> None:
        """Initialize the validator."""
        self._errors: list[str] = []
        self._warnings: list[str] = []
    
    def validate(self, skill_path: str | Path) -> SkillValidationResult:
        """Validate a skill directory.
        
        Args:
            skill_path: Path to the skill directory
            
        Returns:
            SkillValidationResult with validation details
        """
        self._errors = []
        self._warnings = []
        
        path = Path(skill_path)
        
        # Check directory exists
        if not path.exists():
            self._errors.append(f"Skill path does not exist: {path}")
            return self._create_result()
        
        if not path.is_dir():
            self._errors.append(f"Skill path is not a directory: {path}")
            return self._create_result()
        
        # Check SKILL.md exists
        skill_md = path / "SKILL.md"
        if not skill_md.exists():
            self._errors.append(f"SKILL.md not found in {path}")
            return self._create_result()
        
        if not skill_md.is_file():
            self._errors.append(f"SKILL.md is not a file: {skill_md}")
            return self._create_result()
        
        # Read and validate content
        try:
            content = skill_md.read_text(encoding="utf-8")
        except UnicodeDecodeError as e:
            self._errors.append(f"SKILL.md is not valid UTF-8: {e}")
            return self._create_result()
        except OSError as e:
            self._errors.append(f"Cannot read SKILL.md: {e}")
            return self._create_result()
        
        return self._validate_content(content, path.name)
    
    def validate_text(self, content: str, skill_name: str = "unknown") -> SkillValidationResult:
        """Validate SKILL.md content directly.
        
        Args:
            content: The SKILL.md content to validate
            skill_name: Expected skill name (for cross-checking)
            
        Returns:
            SkillValidationResult with validation details
        """
        self._errors = []
        self._warnings = []
        return self._validate_content(content, skill_name)
    
    def _validate_content(self, content: str, dir_name: str) -> SkillValidationResult:
        """Validate SKILL.md content."""
        # Check frontmatter exists at the very beginning
        if not content.startswith("---"):
            self._errors.append("YAML frontmatter must start at line 1 (must begin with '---')")
            return self._create_result()
        
        # Extract frontmatter
        frontmatter_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
        if not frontmatter_match:
            self._errors.append("Invalid frontmatter format: must have opening '---' and closing '---'")
            return self._create_result()
        
        frontmatter_text = frontmatter_match.group(1)
        
        # Parse YAML frontmatter
        try:
            import yaml
            frontmatter = yaml.safe_load(frontmatter_text)
            if not isinstance(frontmatter, dict):
                self._errors.append("Frontmatter must be a YAML dictionary")
                return self._create_result()
        except ImportError:
            self._errors.append("PyYAML is required for validation (pip install pyyaml)")
            return self._create_result()
        except yaml.YAMLError as e:
            self._errors.append(f"Invalid YAML in frontmatter: {e}")
            return self._create_result()
        
        # Validate required fields
        self._validate_required_fields(frontmatter)
        
        # Validate field values
        self._validate_field_values(frontmatter, dir_name)
        
        # Check for unexpected properties
        self._validate_properties(frontmatter)
        
        # Validate body content
        body = content[frontmatter_match.end():].strip()
        self._validate_body(body)
        
        return self._create_result(frontmatter)
    
    def _validate_required_fields(self, frontmatter: dict) -> None:
        """Validate required fields exist."""
        if "name" not in frontmatter:
            self._errors.append("Missing required field: 'name'")
        
        if "description" not in frontmatter:
            self._errors.append("Missing required field: 'description'")
    
    def _validate_field_values(self, frontmatter: dict, dir_name: str) -> None:
        """Validate field values."""
        # Validate name
        name = frontmatter.get("name", "")
        if name:
            if not isinstance(name, str):
                self._errors.append(f"'name' must be a string, got {type(name).__name__}")
            else:
                name = name.strip()
                if not name:
                    self._errors.append("'name' cannot be empty")
                elif not re.match(r"^[a-z0-9-]+$", name):
                    self._errors.append(
                        f"'name' '{name}' should be kebab-case "
                        "(lowercase letters, digits, and hyphens only)"
                    )
                elif name.startswith("-") or name.endswith("-") or "--" in name:
                    self._errors.append(
                        f"'name' '{name}' cannot start/end with hyphen or contain consecutive hyphens"
                    )
                elif len(name) > self.MAX_NAME_LENGTH:
                    self._errors.append(
                        f"'name' is too long ({len(name)} chars). Maximum is {self.MAX_NAME_LENGTH}."
                    )
                elif name != dir_name:
                    self._warnings.append(
                        f"'name' ('{name}') does not match directory name ('{dir_name}')"
                    )
        
        # Validate description
        description = frontmatter.get("description", "")
        if description:
            if not isinstance(description, str):
                self._errors.append(f"'description' must be a string, got {type(description).__name__}")
            else:
                description = description.strip()
                if not description:
                    self._errors.append("'description' cannot be empty")
                elif "<" in description or ">" in description:
                    self._errors.append("'description' cannot contain angle brackets (< or >)")
                elif len(description) > self.MAX_DESCRIPTION_LENGTH:
                    self._errors.append(
                        f"'description' is too long ({len(description)} chars). "
                        f"Maximum is {self.MAX_DESCRIPTION_LENGTH}."
                    )
                elif len(description) < 50:
                    self._warnings.append(
                        f"'description' is quite short ({len(description)} chars). "
                        "Consider adding more detail for better triggering."
                    )
        
        # Validate compatibility if present
        compatibility = frontmatter.get("compatibility")
        if compatibility is not None:
            if not isinstance(compatibility, str):
                self._errors.append(
                    f"'compatibility' must be a string, got {type(compatibility).__name__}"
                )
            elif len(compatibility) > self.MAX_COMPATIBILITY_LENGTH:
                self._errors.append(
                    f"'compatibility' is too long ({len(compatibility)} chars). "
                    f"Maximum is {self.MAX_COMPATIBILITY_LENGTH}."
                )
    
    def _validate_properties(self, frontmatter: dict) -> None:
        """Check for unexpected properties."""
        unexpected = set(frontmatter.keys()) - self.ALLOWED_PROPERTIES
        if unexpected:
            self._errors.append(
                f"Unexpected properties in frontmatter: {', '.join(sorted(unexpected))}. "
                f"Allowed: {', '.join(sorted(self.ALLOWED_PROPERTIES))}"
            )
    
    def _validate_body(self, body: str) -> None:
        """Validate markdown body."""
        if not body:
            self._warnings.append("SKILL.md body is empty")
            return
        
        # Check for common sections
        has_h1 = bool(re.search(r"^# ", body, re.MULTILINE))
        has_h2 = bool(re.search(r"^## ", body, re.MULTILINE))
        
        if not has_h1:
            self._warnings.append("No H1 heading (# Title) found in body")
        
        if not has_h2:
            self._warnings.append("No H2 sections (## Section) found in body")
        
        # Check body length
        lines = body.split("\n")
        if len(lines) > 500:
            self._warnings.append(
                f"Body is quite long ({len(lines)} lines). "
                "Consider moving detailed content to references/."
            )
        
        # Check for code blocks
        code_blocks = re.findall(r"```(\w+)", body)
        if not code_blocks:
            self._warnings.append("No code blocks found. Consider adding examples.")
    
    def _create_result(self, frontmatter: dict | None = None) -> SkillValidationResult:
        """Create validation result."""
        return SkillValidationResult(
            is_valid=len(self._errors) == 0,
            errors=self._errors.copy(),
            warnings=self._warnings.copy(),
            skill_name=frontmatter.get("name") if frontmatter else None,
            description=frontmatter.get("description") if frontmatter else None,
        )
