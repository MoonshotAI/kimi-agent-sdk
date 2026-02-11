#!/usr/bin/env python3
"""
Skill Development Server

A development tool that:
1. Validates all skills in a directory
2. Watches for changes and reports them
3. (Optional) Could be extended to hot-reload into a running Kimi session

Usage:
    python skill_dev_server.py /path/to/skills
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from kimi_agent_sdk.skills import (
    SkillValidator,
    SkillWatcher,
    SkillChangeEvent,
    SkillValidationResult,
)


def validate_all_skills(skills_dir: Path) -> dict[str, SkillValidationResult]:
    """Validate all skills in a directory."""
    validator = SkillValidator()
    results: dict[str, SkillValidationResult] = {}
    
    if not skills_dir.exists():
        print(f"❌ Skills directory does not exist: {skills_dir}")
        return results
    
    for skill_path in skills_dir.iterdir():
        if not skill_path.is_dir():
            continue
        
        result = validator.validate(skill_path)
        results[skill_path.name] = result
    
    return results


def print_validation_results(results: dict[str, SkillValidationResult]) -> bool:
    """Print validation results and return True if all valid."""
    all_valid = True
    
    print("\n" + "=" * 60)
    print("Skill Validation Results")
    print("=" * 60)
    
    for name, result in sorted(results.items()):
        if result.is_valid and not result.warnings:
            print(f"\n✅ {name}: Valid")
        elif result.is_valid:
            print(f"\n⚠️  {name}: Valid with warnings")
            for warning in result.warnings:
                print(f"   ⚠️  {warning}")
        else:
            print(f"\n❌ {name}: Invalid")
            for error in result.errors:
                print(f"   ❌ {error}")
            for warning in result.warnings:
                print(f"   ⚠️  {warning}")
            all_valid = False
    
    print("\n" + "=" * 60)
    valid_count = sum(1 for r in results.values() if r.is_valid)
    print(f"Summary: {valid_count}/{len(results)} skills are valid")
    print("=" * 60 + "\n")
    
    return all_valid


async def watch_skills(skills_dir: Path) -> None:
    """Watch skills directory for changes."""
    
    def on_change(event: SkillChangeEvent) -> None:
        """Handle skill change events."""
        emoji = {
            "CREATED": "🆕",
            "MODIFIED": "📝",
            "DELETED": "🗑️",
        }.get(event.change_type.name, "❓")
        
        print(f"{emoji} {event.change_type.name}: {event.skill_name}")
        
        # If modified or created, re-validate
        if event.change_type.name in ("CREATED", "MODIFIED"):
            validator = SkillValidator()
            result = validator.validate(event.skill_path)
            
            if result.is_valid:
                print(f"   ✅ Validation passed")
            else:
                print(f"   ❌ Validation failed:")
                for error in result.errors:
                    print(f"      - {error}")
    
    print(f"👁️  Watching {skills_dir} for changes...")
    print("Press Ctrl+C to stop\n")
    
    async with SkillWatcher(skills_dir, poll_interval=1.0, on_change=on_change):
        try:
            # Run forever
            while True:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            print("\n👋 Stopping watcher...")


async def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Skill Development Server - validates and watches skills"
    )
    parser.add_argument(
        "skills_dir",
        type=Path,
        help="Directory containing skill subdirectories",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Only validate, don't watch",
    )
    parser.add_argument(
        "--watch-only",
        action="store_true",
        help="Only watch, skip initial validation",
    )
    
    args = parser.parse_args()
    
    # Validate
    if not args.watch_only:
        results = validate_all_skills(args.skills_dir)
        
        if not results:
            print(f"No skills found in {args.skills_dir}")
            return 1
        
        all_valid = print_validation_results(results)
        
        if args.validate_only:
            return 0 if all_valid else 1
    
    # Watch
    try:
        await watch_skills(args.skills_dir)
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")
    
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
