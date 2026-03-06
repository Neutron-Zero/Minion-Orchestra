# Minion Orchestra

**[minionorchestra.com](https://minionorchestra.com)**

Real-time monitoring dashboard for AI coding agents. Track what your agents are doing, what tools they're calling, and why they made decisions -- all from a single dashboard.

<!-- TODO: Hero screenshot - Kanban board with agents in multiple status columns, subagents visible -->
<!-- TODO: Screenshot - Agent Detail page showing transcript tab with conversation + tool calls -->
<!-- TODO: Screenshot - Agent Timeline with swim lanes showing concurrent agents over time -->
<!-- TODO: Screenshot - Insights page with activity heatmap and daily activity chart -->

## Features

- **Kanban board** -- agents organized by status (idle, working, waiting, failed, completed)
- **Agent timeline** -- swim lanes showing per-agent activity over configurable time ranges
- **Agent detail** -- deep dive with activity log, event stream, and conversation transcript
- **Transcript viewing** -- full conversation history with collapsible tool calls
- **Session history** -- searchable archive of all past sessions with export (JSON/CSV)
- **Prompt history** -- searchable log of all prompts sent to agents
- **Insights** -- activity heatmap, daily activity chart, real-time activity pulse
- **Subagent tracking** -- parent-child hierarchy with inline display
- **macOS notifications** -- native alerts for permission requests, failures, and completions
- **Terminal control** -- focus agent terminals and send input from the dashboard
- **Event stream** -- real-time filterable stream of all hook events

## Supported Agents

| Agent | Hook Events | Subagents | Scope | Setup |
|-------|-------------|-----------|-------|-------|
| Claude Code | 17 | Yes | Global | Automatic on install |
| GitHub Copilot CLI | 6 | No | Per-repo | [Manual per repo](docs/setup-copilot-cli.md) |

See detailed setup instructions: [Claude Code](docs/setup-claude-code.md) | [GitHub Copilot CLI](docs/setup-copilot-cli.md)

## Claude Code Quick Start

```bash
npm install
npm start
```

Open http://localhost:3000. Hooks are configured automatically during install -- start any Claude Code session and agents appear in the dashboard.

## GitHub Copilot CLI Quick Start

```bash
npm install
npm start
```

Then from the root of each repo you want to monitor:

```bash
bash {path-to-minion-orchestra}/app/hooks/setup-copilot.sh
```

---

Built by [Neutron Zero](https://neutronzero.com) | [Website](https://minionorchestra.com) | [Report an Issue](https://github.com/Neutron-Zero/Minion-Orchestra/issues)
