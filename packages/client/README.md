# Minion Command Dashboard

Angular-based real-time monitoring dashboard for Claude Code agents.

## Features

- Real-time agent status monitoring
- Activity charts and visualizations
- Advanced log viewer with search and filters
- Configurable settings and preferences
- Professional dark theme
- Responsive design

## Technologies

- Angular 13
- Angular Material
- Chart.js for visualizations
- Socket.io client for WebSocket connection
- RxJS for reactive programming

## Getting Started

See the [main README](../../README.md) for installation and usage instructions.

## Structure

```
src/
├── app/
│   ├── agent-card/        # Agent status cards
│   ├── agent-dashboard/   # Main dashboard view
│   ├── charts/            # Activity visualizations
│   ├── log-viewer/        # Real-time log display
│   ├── settings/          # Configuration panel
│   └── services/          # WebSocket and data services
└── styles.scss            # Global styles and theme
```