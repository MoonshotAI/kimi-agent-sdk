# Skill Development Toolkit Example

This example demonstrates how to use the `kimi_agent_sdk.skills` module for skill development workflows.

## Features

- **Skill Validation**: Validate skill structure and content before deployment
- **Hot-reload Watching**: Monitor skill files for changes during development
- **Development Server**: Example of integrating skill watching into a development workflow

## Quick Start

```bash
# Install dependencies
pip install kimi-agent-sdk pyyaml

# Run the example
python skill_dev_server.py /path/to/your/skills
```

## Examples

### 1. Validate a Skill

```python
from kimi_agent_sdk.skills import SkillValidator

validator = SkillValidator()
result = validator.validate("/path/to/my-skill")

if result.is_valid:
    print(f"✅ Skill '{result.skill_name}' is valid!")
else:
    print("❌ Validation failed:")
    for error in result.errors:
        print(f"  - {error}")
    for warning in result.warnings:
        print(f"  ⚠️  {warning}")
```

### 2. Watch Skills for Changes

```python
import asyncio
from kimi_agent_sdk.skills import SkillWatcher, SkillChangeEvent

async def on_skill_change(event: SkillChangeEvent):
    print(f"Skill {event.skill_name} was {event.change_type.name}")
    # Reload the skill in your application

async with SkillWatcher("/path/to/skills", on_change=on_skill_change) as watcher:
    print("Watching for changes... (Press Ctrl+C to stop)")
    await asyncio.sleep(3600)  # Watch for an hour
```

### 3. Development Server with Auto-reload

See `skill_dev_server.py` for a complete example that:
- Validates all skills on startup
- Watches for changes
- Provides a simple HTTP API to query skill status

## API Reference

### SkillValidator

Validates skill structure, frontmatter, and content.

```python
validator = SkillValidator()

# Validate from directory
result = validator.validate("/path/to/skill")

# Or validate text directly
result = validator.validate_text(skill_md_content, skill_name="my-skill")

# Check results
result.is_valid      # bool
result.errors        # list[str]
result.warnings      # list[str]
result.skill_name    # str | None
result.description   # str | None
```

### SkillWatcher

Monitors skill directories for changes.

```python
# Basic usage
watcher = SkillWatcher("/path/to/skills", poll_interval=1.0)
await watcher.start()
# ... later ...
await watcher.stop()

# Context manager (recommended)
async with SkillWatcher("/path/to/skills") as watcher:
    await asyncio.sleep(3600)

# Force refresh
changes = await watcher.force_refresh()
for change in changes:
    print(f"{change.skill_name}: {change.change_type}")
```

## Testing Your Skills

```python
# Test that a skill passes validation
from kimi_agent_sdk.skills import SkillValidator

def test_my_skill():
    validator = SkillValidator()
    result = validator.validate("./my-skill")
    
    assert result.is_valid, f"Validation failed: {result.errors}"
    assert result.skill_name == "my-skill"
    assert len(result.warnings) == 0
```
