/**
 * Minion Command Server - Refactored Version
 * Main server entry point with modular architecture
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

// Import configuration
const config = require('./src/config/config');

// Import services
const agentManager = require('./src/services/agentManager');
const taskQueue = require('./src/services/taskQueue');
const CleanupService = require('./src/services/cleanupService');

// Import routes
const configRoutes = require('./src/routes/configRoutes');
const agentRoutes = require('./src/routes/agentRoutes');
const taskRoutes = require('./src/routes/taskRoutes');
const logRoutes = require('./src/routes/logRoutes');
const hookRoutes = require('./src/routes/hookRoutes');

// Import WebSocket handlers
const { initializeSocketHandlers } = require('./src/websocket/socketHandlers');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = socketIO(server, {
    cors: {
        origin: config.getCorsOrigins(),
        methods: ['GET', 'POST'],
    },
});

// Middleware with permissive CORS for standalone HTML
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (file:// protocol, Postman, etc.)
        if (!origin) return callback(null, true);
        
        // Allow configured origins
        const allowedOrigins = config.getCorsOrigins();
        if (allowedOrigins.includes(origin) || 
            allowedOrigins.includes('file://*') || 
            origin.startsWith('file://')) {
            return callback(null, true);
        }
        
        // Allow all localhost origins
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
        }
        
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json());

// Make io available to routes
app.set('io', io);

// Initialize cleanup service
const cleanupService = new CleanupService(agentManager, taskQueue, io);
app.set('cleanupService', cleanupService);

// Mount routes
app.use('/', configRoutes);
app.use('/api', agentRoutes);
app.use('/api', taskRoutes);
app.use('/api', logRoutes);
app.use('/api', hookRoutes);

// Initialize WebSocket handlers
initializeSocketHandlers(io);

// Start server
const PORT = config.getPort();
server.listen(PORT, () => {
    // Use ANSI escape codes for orange color similar to app theme
    const orange = '\x1b[38;5;202m'; // Orange color
    const reset = '\x1b[0m'; // Reset color

    console.log(`
${orange}╔══════════════════════════════════════════════════════╗${reset}
${orange}║${reset}                                                      ${orange}║${reset}
${orange}║${reset}      * Minion Command Server Started!                ${orange}║${reset}
${orange}║${reset}                                                      ${orange}║${reset}
${orange}║${reset}      WebSocket: http://localhost:${PORT}                ${orange}║${reset}
${orange}║${reset}      Health Check: http://localhost:${PORT}/health      ${orange}║${reset}
${orange}║${reset}                                                      ${orange}║${reset}
${orange}║${reset}      Waiting for minions to connect...               ${orange}║${reset}
${orange}║${reset}                                                      ${orange}║${reset}
${orange}╚══════════════════════════════════════════════════════╝${reset}`);

    // Start the cleanup timer
    cleanupService.startCleanupTimer();
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    // Stop the cleanup timer first
    cleanupService.stopCleanupTimer();

    // Disconnect all WebSocket clients
    io.sockets.sockets.forEach((socket) => {
        socket.disconnect(true);
    });

    // Close WebSocket server
    io.close(() => {
        console.log('WebSocket server closed');
    });

    // Stop accepting new connections and close HTTP server
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });

    // Force close after 5 seconds if graceful shutdown fails
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 5000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server, io };
