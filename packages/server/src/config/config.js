/**
 * Configuration Module
 * Centralized configuration management
 */

class Config {
    constructor() {
        this.cleanupIntervalMs = 5000; // Default 5 seconds
        this.cleanupTimer = null;
        this.port = process.env.PORT || 3000;
        this.corsOrigins = [
            "http://localhost:4200",
            "http://localhost:4201", 
            "http://localhost:4202",
            "http://localhost:8080",  // Common local server port
            "http://127.0.0.1:8080",
            "file://*",               // Allow file:// protocol
            "null"                    // Some browsers send 'null' origin for file://
        ];
    }

    getCleanupInterval() {
        return this.cleanupIntervalMs;
    }

    setCleanupInterval(ms) {
        if (ms >= 1000 && ms <= 300000) {
            this.cleanupIntervalMs = ms;
            return true;
        }
        return false;
    }

    getCleanupTimer() {
        return this.cleanupTimer;
    }

    setCleanupTimer(timer) {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        this.cleanupTimer = timer;
    }

    getPort() {
        return this.port;
    }

    getCorsOrigins() {
        return this.corsOrigins;
    }
}

module.exports = new Config();