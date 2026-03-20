#!/bin/bash
#
# Sets up Minion Orchestra hooks for GitHub Copilot CLI in the current repo.
#
# Usage: Run from any repo root:
#   bash /path/to/minion-orchestra-app/setup-copilot.sh
#
# What it does:
#   Copies copilot_hook.py to ~/.minion-orchestra/hooks/, then creates
#   .github/hooks/minion-orchestra.json in the current repo pointing to it.

set -e

# Resolve the hooks directory relative to this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SOURCE="$SCRIPT_DIR/hooks/copilot_hook.py"

if [ ! -f "$HOOK_SOURCE" ]; then
    echo "Error: copilot_hook.py not found at $HOOK_SOURCE"
    exit 1
fi

# Copy hook script to ~/.minion-orchestra/hooks/
MO_HOOKS_DIR="$HOME/.minion-orchestra/hooks"
mkdir -p "$MO_HOOKS_DIR"
cp "$HOOK_SOURCE" "$MO_HOOKS_DIR/copilot_hook.py"
HOOK_SCRIPT="$MO_HOOKS_DIR/copilot_hook.py"

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
