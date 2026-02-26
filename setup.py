#!/usr/bin/env python3
"""
Minion Orchestra - Claude Code Hook Setup

Configures Claude Code to send events to Minion Orchestra by:
1. Registering hook entries in ~/.claude/settings.json
2. Pointing them to the hook script in this project
3. Cleaning up stale files from previous installations
"""

import json
import os
import sys
from pathlib import Path

# ANSI colors
GREEN = '\033[32m'
YELLOW = '\033[33m'
BLUE = '\033[34m'
RED = '\033[31m'
CYAN = '\033[36m'
GRAY = '\033[90m'
RESET = '\033[0m'

# All Claude Code hook events we want to monitor
HOOK_EVENTS = [
    'SessionStart',
    'SessionEnd',
    'Stop',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'PermissionRequest',
    'SubagentStart',
    'SubagentStop',
    'TeammateIdle',
    'TaskCompleted',
    'Notification',
    'ConfigChange',
    'PreCompact',
    'WorktreeCreate',
    'WorktreeRemove',
]

# Stale files to clean up from ~/.claude/hooks/
STALE_FILES = [
    'mission_control_hook.py',
    'mission_control.log',
    'send_to_mission_control.py',
    'test_mission_control.sh',
    'test_mission_control.py',
    'minion_orchestra_hook.py',
    'test_minion_orchestra.sh',
]


def log(message, color=RESET):
    print(f"{color}{message}{RESET}")


def get_hook_script_path():
    """Return the absolute path to the hook script in this project."""
    script_dir = Path(__file__).resolve().parent
    hook_path = script_dir / 'hooks' / 'minion_orchestra_hook.py'
    if not hook_path.exists():
        log(f"Hook script not found at {hook_path}", RED)
        log("Make sure you're running setup from the app directory", YELLOW)
        sys.exit(1)
    return str(hook_path)


def clean_stale_files(hooks_dir):
    """Remove old hook files from ~/.claude/hooks/."""
    if not hooks_dir.exists():
        return

    removed = 0
    for filename in STALE_FILES:
        filepath = hooks_dir / filename
        if filepath.exists():
            filepath.unlink()
            log(f"  Removed stale file: {filepath}", YELLOW)
            removed += 1

    # Remove the directory if empty
    if hooks_dir.exists():
        try:
            remaining = list(hooks_dir.iterdir())
            if not remaining:
                hooks_dir.rmdir()
                log(f"  Removed empty directory: {hooks_dir}", YELLOW)
        except OSError:
            pass

    if removed:
        log(f"  Cleaned up {removed} stale file(s)", GREEN)


def clean_old_hook_entries(settings):
    """Remove old mission_control and stale minion_orchestra entries from settings."""
    hooks = settings.get('hooks', {})
    cleaned = 0

    for event in list(hooks.keys()):
        original_count = len(hooks[event])
        hooks[event] = [
            group for group in hooks[event]
            if not any(
                any(marker in (handler.get('command', '') or '')
                    for marker in ['mission_control', '.claude/hooks/minion_orchestra'])
                for handler in group.get('hooks', [])
            )
            # Also filter old flat format entries (no 'hooks' key)
            and not any(marker in (group.get('command', '') or '')
                        for marker in ['mission_control', '.claude/hooks/minion_orchestra'])
        ]
        cleaned += original_count - len(hooks[event])

        if not hooks[event]:
            del hooks[event]

    # Remove events that are no longer valid
    for old_event in ['PostCompact', 'ContextTruncation']:
        if old_event in hooks:
            cleaned += len(hooks[old_event])
            del hooks[old_event]

    if cleaned:
        log(f"  Cleaned {cleaned} old hook entry/entries from settings", YELLOW)

    return settings


def setup():
    log(f"\n{CYAN}Setting up Claude Code hooks for Minion Orchestra{RESET}\n")

    home = Path.home()
    claude_dir = home / '.claude'
    hooks_dir = claude_dir / 'hooks'
    settings_file = claude_dir / 'settings.json'

    # Ensure ~/.claude/ exists
    claude_dir.mkdir(parents=True, exist_ok=True)

    # Get absolute path to our hook script
    hook_script = get_hook_script_path()
    log(f"  Hook script: {hook_script}", BLUE)

    # Clean up stale files from previous installations
    log("\nCleaning up old installations...", CYAN)
    clean_stale_files(hooks_dir)

    # Load existing settings
    settings = {}
    if settings_file.exists():
        try:
            settings = json.loads(settings_file.read_text())
            log(f"  Found existing Claude settings", BLUE)
        except (json.JSONDecodeError, OSError):
            log(f"  Could not parse existing settings, creating new ones", YELLOW)

    # Clean old hook entries
    settings = clean_old_hook_entries(settings)

    # Register hooks
    if 'hooks' not in settings:
        settings['hooks'] = {}

    log(f"\nRegistering {len(HOOK_EVENTS)} hook events...", CYAN)
    added = 0
    existing = 0

    for event in HOOK_EVENTS:
        if event not in settings['hooks']:
            settings['hooks'][event] = []

        already = any(
            any('minion_orchestra_hook.py' in (handler.get('command', '') or '')
                for handler in group.get('hooks', []))
            for group in settings['hooks'][event]
        )

        if not already:
            settings['hooks'][event].append({
                'hooks': [{'type': 'command', 'command': hook_script}]
            })
            log(f"  + {event}", BLUE)
            added += 1
        else:
            # Update the command path in case the project moved
            for group in settings['hooks'][event]:
                for handler in group.get('hooks', []):
                    if 'minion_orchestra_hook.py' in (handler.get('command', '') or ''):
                        handler['command'] = hook_script
            log(f"  {GRAY}Already configured: {event}{RESET}")
            existing += 1

    # Write settings
    settings_file.write_text(json.dumps(settings, indent=2) + '\n')
    log(f"\n  Updated: {settings_file}", GREEN)

    log(f"\nSetup complete!", GREEN)
    log(f"  {added} hooks added, {existing} already configured", CYAN)
    log(f"\nTo start monitoring:", YELLOW)
    log(f"  1. Start Minion Orchestra: npm start")
    log(f"  2. Use Claude Code - events appear in the dashboard automatically")
    log(f"\nTo use a different server, set MINION_ORCHESTRA_URL environment variable")
    log(f"To remove hooks: npm run uninstall\n")


if __name__ == '__main__':
    try:
        setup()
    except Exception as e:
        log(f"\nSetup failed: {e}", RED)
        sys.exit(1)
