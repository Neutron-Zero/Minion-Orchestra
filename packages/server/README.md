# Minion Command Server

Node.js backend server for Minion Command that receives Claude Code hook events and provides real-time monitoring via WebSocket.

## Features

- Receives Claude Code hook events
- WebSocket server for real-time updates
- Agent state management
- Comprehensive event logging
- Automatic cleanup of inactive agents
- PID monitoring for process tracking

## Technologies

- Node.js / Express
- Socket.io for WebSocket
- File-based logging

## Getting Started

See the [main README](../../README.md) for installation and usage instructions.

## Architecture

```
src/
├── config/
│   └── config.js          # Server configuration
├── services/
│   ├── agentManager.js    # Agent state management
│   ├── taskQueue.js       # Task tracking
│   └── cleanupService.js  # Process monitoring
├── routes/
│   ├── hookRoutes.js      # Claude Code hook endpoints
│   ├── configRoutes.js    # Configuration endpoints
│   └── taskRoutes.js      # Task API
├── websocket/
│   └── socketHandlers.js  # Real-time communication
└── utils/
    └── processUtils.js    # Process utilities
```

## API Endpoints

### Primary Endpoint
- `POST /api/hook` - Receives all Claude Code hook events

### Support Endpoints
- `GET /health` - Server health check
- `POST /config` - Update server configuration
- `POST /reset` - Reset task queue

## Configuration

Default settings in `src/config/config.js`:
- Port: 3000
- Cleanup interval: 5 seconds
- CORS origins: localhost:4200, 4201, 4202

Hook events are logged to `logs/hooks.log` for debugging and audit purposes.