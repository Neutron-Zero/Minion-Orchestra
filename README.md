# Minion Orchestra

**[minionorchestra.com](https://minionorchestra.com)**

Real-time monitoring dashboard for Claude Code agents with automatic activity tracking via hooks.

## Features

- Real-time agent monitoring via WebSocket
- Activity visualization and charts
- Automatic event tracking via Claude Code hooks
- Auto-detection of running Claude Code sessions
- Task queue tracking and status updates
- Comprehensive logging

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (serves both API and dashboard)
npm start
```

Open http://localhost:3000 in your browser.

The installation process automatically configures Claude Code hooks to send events to the server. No manual configuration needed.

## Architecture

```
packages/
  client/    Angular dashboard (Material UI, Chart.js, Socket.IO client)
  server/    Python/FastAPI + Socket.IO server (port 3000)
hooks/       Claude Code hook script
```

### Server
- Python/FastAPI serving both the API and the pre-built dashboard
- WebSocket broadcasting for real-time dashboard updates
- In-memory agent state management
- Auto-detection of running Claude Code processes on startup
- Auto-cleanup of dead agents via PID monitoring

### Client
- Pre-built and served by the Python server (no Node needed at runtime)
- Real-time agent cards with status, current tool, and progress
- Activity log with file paths and agent folder names
- Task queue overview (pending, in-progress, completed, failed)
- Analytics and charts

## Development

```bash
# Start server + Angular dev server with hot reload
npm run dev

# Rebuild the client after making changes
npm run build
```

When developing the client, use `npm run dev` for hot reload on port 4201. After making changes, run `npm run build` to update the pre-built files served by the Python server.

## Claude Code Integration

The setup script (`npm run setup`) configures Claude Code hooks:

1. Points `~/.claude/settings.json` hook entries to `hooks/minion_orchestra_hook.py`
2. Registers 17 Claude Code hook events (SessionStart, PreToolUse, PostToolUse, etc.)
3. Preserves any existing hooks you have configured

### Manual Setup

```bash
npm run setup                         # Run setup manually
npm install --ignore-scripts          # Install without auto-setup
npm run uninstall                     # Remove hooks
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start server (API + dashboard on port 3000) |
| `npm run start:debug` | Start with verbose hook logging |
| `npm run dev` | Development mode (server + Angular hot reload) |
| `npm run build` | Rebuild the client |
| `npm run setup` | Configure Claude Code hooks |
| `npm test` | Run client tests |

---

Built by [Neutron Zero](https://neutronzero.com) | [Website](https://minionorchestra.com) | [Report an Issue](https://github.com/Neutron-Zero/MinionOrchestra/issues)
