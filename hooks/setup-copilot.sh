#!/bin/bash
#
# Sets up Minion Orchestra hooks for GitHub Copilot CLI in the current repo.
#
# Usage: Run from any repo root:
#   bash /path/to/minion-orchestra/app/hooks/setup-copilot.sh
#
# What it does:
#   Creates .github/hooks/minion-orchestra.json in the current repo,
#   pointing each Copilot hook event to copilot_hook.py in this project.

set -e

# Resolve the directory where this script (and copilot_hook.py) lives
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/copilot_hook.py"

if [ ! -f "$HOOK_SCRIPT" ]; then
    echo "Error: copilot_hook.py not found at $HOOK_SCRIPT"
    exit 1
fi

# Clean up old installation that copied the hook to ~/.minion-orchestra/hooks/
OLD_HOOKS="$HOME/.minion-orchestra/hooks"
if [ -d "$OLD_HOOKS" ]; then
    rm -rf "$OLD_HOOKS"
    echo "Cleaned up old installation at $OLD_HOOKS"
fi

# Create .github/hooks/ config in current repo
REPO_ROOT="$(pwd)"
HOOKS_DIR="$REPO_ROOT/.github/hooks"

if [ ! -d "$REPO_ROOT/.git" ]; then
    echo "Warning: $(pwd) does not appear to be a git repo root"
fi

mkdir -p "$HOOKS_DIR"

cat > "$HOOKS_DIR/minion-orchestra.json" << HOOKEOF
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "python3 $HOOK_SCRIPT sessionStart",
        "timeoutSec": 5
      }
    ],
    "sessionEnd": [
      {
        "type": "command",
        "bash": "python3 $HOOK_SCRIPT sessionEnd",
        "timeoutSec": 5
      }
    ],
    "userPromptSubmitted": [
      {
        "type": "command",
        "bash": "python3 $HOOK_SCRIPT userPromptSubmitted",
        "timeoutSec": 5
      }
    ],
    "preToolUse": [
      {
        "type": "command",
        "bash": "python3 $HOOK_SCRIPT preToolUse",
        "timeoutSec": 5
      }
    ],
    "postToolUse": [
      {
        "type": "command",
        "bash": "python3 $HOOK_SCRIPT postToolUse",
        "timeoutSec": 5
      }
    ],
    "errorOccurred": [
      {
        "type": "command",
        "bash": "python3 $HOOK_SCRIPT errorOccurred",
        "timeoutSec": 5
      }
    ]
  }
}
HOOKEOF

echo "Created $HOOKS_DIR/minion-orchestra.json"
echo "Hook script: $HOOK_SCRIPT"
echo "Copilot CLI hooks will send events to ${MINION_ORCHESTRA_URL:-http://localhost:3000}"
