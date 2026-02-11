#!/usr/bin/env python3
"""
Validate Skills CLI Tool

Quick command-line tool to validate skill structure.

Usage:
    python validate_skills.py /path/to/skills
    python validate_skills.py /path/to/skills/my-skill
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from kimi_agent_sdk.skills import SkillValidator


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Validate Kimi skills")
    parser.add_argument("path", type=Path, help="Path to skill directory or skills parent directory")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show detailed output")
    
    args = parser.parse_args()
    
    validator = SkillValidator()
    
    # Check if path is a single skill or a directory of skills
    if (args.path / "SKILL.md").exists():
        # Single skill
        paths = [args.path]
    else:
        # Directory of skills
        paths = [p for p in args.path.iterdir() if p.is_dir()]
    
    if not paths:
        print(f"❌ No skills found at {args.path}")
        return 1
    
    all_valid = True
    
    for skill_path in sorted(paths):
        result = validator.validate(skill_path)
        
        if result.is_valid and not result.warnings:
            print(f"✅ {skill_path.name}")
        elif result.is_valid:
            print(f"⚠️  {skill_path.name} (with warnings)")
            all_valid = False
        else:
            print(f"❌ {skill_path.name}")
            all_valid = False
        
        if args.verbose or not result.is_valid:
            for error in result.errors:
                print(f"   ❌ {error}")
            for warning in result.warnings:
                print(f"   ⚠️  {warning}")
    
    return 0 if all_valid else 1


if __name__ == "__main__":
    sys.exit(main())
