# Claude Code Setup

Minion Orchestra monitors Claude Code sessions via the [hooks system](https://docs.anthropic.com/en/docs/claude-code/hooks). The setup script registers 17 hook events in your global `~/.claude/settings.json`, so every Claude Code session on your machine sends events to the dashboard automatically.

## Setup

Hooks are configured automatically when you install:

```bash
npm install
```

To run setup manually:

```bash
npm run setup
```

To remove hooks:

```bash
npm run uninstall
```

## How It Works

The setup script (`setup.py`) copies `hooks/claude_hook.py` to `~/.minion-orchestra/hooks/` and adds entries to `~/.claude/settings.json` pointing each hook event there. When Claude Code fires a hook, the script sends a JSON payload to the Minion Orchestra server via HTTP POST.

Hooks are **global** -- once configured, every Claude Code session on your machine is monitored regardless of which project you're working in.

## Hook Events (17)

| Event | What it captures |
|-------|-----------------|
| SessionStart | New Claude Code session begins |
| SessionEnd | Session ends |
| Stop | Agent stops |
| UserPromptSubmit | User sends a prompt |
| PreToolUse | Agent is about to use a tool |
| PostToolUse | Agent finished using a tool |
| PostToolUseFailure | Tool call failed |
| PermissionRequest | Agent is waiting for user approval |
| SubagentStart | Subagent spawned |
| SubagentStop | Subagent finished |
| TeammateIdle | Teammate agent is idle |
| TaskCompleted | Agent completed a task |
| Notification | Agent sent a notification |
| ConfigChange | Configuration changed |
| PreCompact | Context is about to be compacted |
| WorktreeCreate | Git worktree created |
| WorktreeRemove | Git worktree removed |

## Features Available with Claude Code

- Kanban board with all status columns (idle, working, waiting, failed, completed)
- Conversation transcript viewing on the Agent Detail page
- Subagent tracking with parent-child hierarchy
- Terminal focus and input from the dashboard
- macOS native notifications for permission requests

## Custom Server URL

By default, the hook sends events to `http://localhost:3000`. To use a different server:

```bash
export MINION_ORCHESTRA_URL=http://your-server:3000
```

## Logs

Hook client logs are written to `packages/server/logs/hook-client.log`.
