#!/usr/bin/env python3
"""
Minion Orchestra - Uninstall

Removes Minion Orchestra hook entries from Claude Code settings
and cleans up stale files.
"""

import json
import sys
from pathlib import Path

GREEN = '\033[32m'
YELLOW = '\033[33m'
RED = '\033[31m'
CYAN = '\033[36m'
RESET = '\033[0m'

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


def uninstall():
    log(f"\n{CYAN}Uninstalling Minion Orchestra hooks{RESET}\n")

    home = Path.home()
    settings_file = home / '.claude' / 'settings.json'
    hooks_dir = home / '.claude' / 'hooks'

    # Clean settings.json
    removed_count = 0
    if settings_file.exists():
        try:
            settings = json.loads(settings_file.read_text())
            hooks = settings.get('hooks', {})

            for event in list(hooks.keys()):
                original = len(hooks[event])
                hooks[event] = [
                    group for group in hooks[event]
                    if not any(
                        'minion_orchestra' in (handler.get('command', '') or '')
                        for handler in group.get('hooks', [])
                    )
                    # Also filter old flat format entries
                    and 'minion_orchestra' not in (group.get('command', '') or '')
                ]
                removed_count += original - len(hooks[event])

                if not hooks[event]:
                    del hooks[event]

            if not hooks:
                settings.pop('hooks', None)

            settings_file.write_text(json.dumps(settings, indent=2) + '\n')
            log(f"  Removed {removed_count} hook entries from {settings_file}", GREEN)
        except (json.JSONDecodeError, OSError) as e:
            log(f"  Could not update settings: {e}", RED)
    else:
        log(f"  No settings file found at {settings_file}", YELLOW)

    # Clean stale files
    stale_removed = 0
    if hooks_dir.exists():
        for filename in STALE_FILES:
            filepath = hooks_dir / filename
            if filepath.exists():
                filepath.unlink()
                log(f"  Removed: {filepath}", YELLOW)
                stale_removed += 1

        try:
            if not list(hooks_dir.iterdir()):
                hooks_dir.rmdir()
                log(f"  Removed empty directory: {hooks_dir}", YELLOW)
        except OSError:
            pass

    log(f"\nUninstall complete!", GREEN)
    log(f"  {removed_count} hook entries removed, {stale_removed} stale files cleaned up\n")


if __name__ == '__main__':
    try:
        uninstall()
    except Exception as e:
        log(f"\nUninstall failed: {e}", RED)
        sys.exit(1)
