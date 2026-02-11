# Changelog


## Unreleased

### Added
- **New module: `kimi_agent_sdk.skills`** - Skill development utilities
  - `SkillValidator`: Comprehensive validation for skill structure, frontmatter format, and content quality
  - `SkillWatcher`: File system monitoring for hot-reload development workflows
  - Full test coverage with 33 test cases
  - Example scripts: `skill_dev_server.py`, `validate_skills.py`

## 0.0.4 (2026-02-10)
- Dependencies: Update kimi-cli to version 1.10, kosong to version 0.42
- API: Re-export `TurnEnd`, `ShellDisplayBlock`, `TodoDisplayItem`, and `SystemPromptTemplateError`

## 0.0.3 (2026-01-21)
- Docs: expand Python SDK guides (QuickStart, Prompt/Session, tools)
- Examples: add Python examples to demonstrate SDK features
- Code: add module-level docstrings to public modules; re-export SDK tools
- Dependencies: Update kimi-cli to version 0.83

## 0.0.2 (2025-01-20)
- Align Python SDK path types with Kimi CLI signatures
- Normalize SDK exceptions and propagate exceptions from CLI/Kosong 

## 0.0.1 (2025-01-16)

- Initial release of the Python SDK.
