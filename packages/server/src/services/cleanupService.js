/**
 * Cleanup Service
 * Manages periodic cleanup of dead agents
 */

const config = require('../config/config');
const { cleanupDeadAgents } = require('../utils/processUtils');

class CleanupService {
    constructor(agentManager, taskQueue, io) {
        this.agentManager = agentManager;
        this.taskQueue = taskQueue;
        this.io = io;
    }

    /**
     * Start the cleanup timer
     */
    startCleanupTimer() {
        const intervalMs = config.getCleanupInterval();
        
        // Clear existing timer if any
        if (config.getCleanupTimer()) {
            clearInterval(config.getCleanupTimer());
        }
        
        const timer = setInterval(() => {
            const removedCount = cleanupDeadAgents(this.agentManager, this.taskQueue);
            
            if (removedCount > 0) {
                console.log(`Cleaned up ${removedCount} dead agent(s)`);
                
                // Broadcast updates
                if (this.io) {
                    this.io.emit('agent_update', this.agentManager.getAllAgents());
                    this.io.emit('task_update', this.taskQueue.getQueue());
                }
            }
        }, intervalMs);
        
        config.setCleanupTimer(timer);
        console.log(`Started PID monitoring (interval: ${intervalMs}ms)`);
    }

    /**
     * Stop the cleanup timer
     */
    stopCleanupTimer() {
        const timer = config.getCleanupTimer();
        if (timer) {
            clearInterval(timer);
            config.setCleanupTimer(null);
            console.log('Stopped PID monitoring');
        }
    }

    /**
     * Restart the cleanup timer with new interval
     */
    restartCleanupTimer(newIntervalMs) {
        if (config.setCleanupInterval(newIntervalMs)) {
            this.startCleanupTimer();
            return true;
        }
        return false;
    }
}

module.exports = CleanupService;