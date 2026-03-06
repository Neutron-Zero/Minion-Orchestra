# GitHub Copilot CLI Setup

Minion Orchestra monitors GitHub Copilot CLI sessions via the [Copilot hooks system](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-in-the-cli). Unlike Claude Code, Copilot hooks are configured per-repo, so you need to run setup in each repository you want to monitor.

## Requirements

- GitHub Copilot subscription (Individual, Business, or Enterprise)
- `gh` CLI v2.80+ with the Copilot extension
- Python 3 on PATH
- For org/enterprise plans: admin must enable "Copilot CLI" in GitHub org settings

## Setup

From the root of any repo you want to monitor:

```bash
bash {path-to-minion-orchestra}/app/hooks/setup-copilot.sh
```

This creates `.github/hooks/minion-orchestra.json` in the current repo, pointing each Copilot hook event to `copilot_hook.py` in the Minion Orchestra project.

After setup, any `gh copilot` session in that repo sends events to Minion Orchestra automatically.

## Hook Events (6)

| Event | What it captures |
|-------|-----------------|
| sessionStart | New Copilot CLI session begins |
| sessionEnd | Session ends |
| userPromptSubmitted | User sends a prompt |
| preToolUse | Agent is about to use a tool |
| postToolUse | Agent finished using a tool |
| errorOccurred | An error occurred |

## Current Limitations

As of March 2026, GitHub Copilot CLI hooks are in active development. These limitations are expected to improve as GitHub adds more hook events and configuration options.

1. **Per-repo only** -- hooks must be configured in each repository individually. There is no global config equivalent to Claude Code's `~/.claude/settings.json`.
2. **6 hook events** -- compared to Claude Code's 17. Missing events include permission requests, subagent lifecycle, context compaction, worktree events, and others.
3. **No subagent hooks** -- if Copilot spawns sub-agents, there are no start/stop events for them. Sub-agents will not appear in the dashboard.
4. **No permission/waiting events** -- Copilot agents will never appear in the "Waiting for Input" Kanban column.

## Custom Server URL

By default, the hook sends events to `http://localhost:3000`. To use a different server:

```bash
export MINION_ORCHESTRA_URL=http://your-server:3000
```

## Logs

Hook client logs are written to `packages/server/logs/hook-client.log`.
