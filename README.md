# Minion Orchestra

**[minionorchestra.com](https://minionorchestra.com)**

Real-time monitoring dashboard for Claude Code agents with automatic activity tracking via hooks.

## Features

- Real-time agent monitoring via WebSocket
- Activity visualization and charts
- Automatic event tracking via Claude Code hooks
- Task queue tracking and status updates
- Comprehensive logging

## Quick Start

```bash
# Install dependencies
npm install

# Start both server and Angular dev server
npm start

# Or start with debug mode (shows detailed hook logs)
npm run start:debug
```

The dashboard will be available at http://localhost:4201

The installation process automatically configures Claude Code hooks to send events to the server. No manual configuration needed.

## Standalone HTML Build

Bundles the entire Angular client into a single HTML file (~1MB) that can be opened directly in a browser without a dev server.

```bash
npm run build:standalone

# Start only the server (still needed for WebSocket/API)
cd packages/server && npm start

# Open minion-orchestra-dashboard.html in your browser
```

- Chrome/Edge: Works directly with file:// protocol
- Firefox/Safari: May require serving via HTTP (`python3 -m http.server 8080`)

## Architecture

```
packages/
  client/    Angular 13 dashboard (Material UI, Chart.js, Socket.IO client)
  server/    Express + Socket.IO server (port 3000)
```

### Server
- HTTP API for receiving hook events (`/api/hook`)
- WebSocket broadcasting for real-time dashboard updates
- In-memory agent state management
- Auto-cleanup of dead agents via PID monitoring

### Client
- Real-time agent cards with status, current tool, and progress
- Task queue overview (pending, in-progress, completed, failed)
- Analytics and charts
- Settings and setup guide

## Claude Code Integration

The setup script (`npm run setup`) configures Claude Code hooks:

1. Points `~/.claude/settings.json` hook entries to the script at `hooks/minion_orchestra_hook.py` in this project
2. Registers these 17 Claude Code hook events:
   - SessionStart, SessionEnd, Stop
   - UserPromptSubmit
   - PreToolUse, PostToolUse, PostToolUseFailure
   - PermissionRequest
   - SubagentStart, SubagentStop
   - TeammateIdle, TaskCompleted
   - Notification, ConfigChange
   - PreCompact
   - WorktreeCreate, WorktreeRemove
3. Preserves any existing hooks you have configured
4. Cleans up stale files from previous installations

### Manual Setup

```bash
npm run setup                         # Run setup manually
npm install --ignore-scripts          # Install without auto-setup
MINION_ORCHESTRA_URL=http://host:3000 npm run setup  # Custom server
```

### Removing Hooks

```bash
npm run uninstall
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start server + Angular dev server |
| `npm run start:debug` | Start with verbose hook logging |
| `npm run build:standalone` | Build single-file HTML dashboard |
| `npm run setup` | Configure Claude Code hooks |
| `npm run dev` | Development mode with hot reload |
| `npm test` | Run client tests |

---

Built by [Neutron Zero](https://neutronzero.com) | [Website](https://minionorchestra.com) | [Report an Issue](https://github.com/Neutron-Zero/MinionOrchestra/issues)
