/**
 * Configuration Routes
 * System configuration and management endpoints
 */

const express = require('express');
const router = express.Router();
const config = require('../config/config');
const agentManager = require('../services/agentManager');
const taskQueue = require('../services/taskQueue');

/**
 * GET /health - Health check endpoint
 */
router.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        agents: agentManager.getAgentCount(),
        taskQueue: taskQueue.getQueue(),
        cleanupInterval: config.getCleanupInterval()
    });
});

/**
 * POST /config - Update configuration
 */
router.post('/config', (req, res) => {
    const { cleanupInterval } = req.body;
    
    if (cleanupInterval && cleanupInterval >= 1000 && cleanupInterval <= 300000) {
        const oldInterval = config.getCleanupInterval();
        
        // Update config and restart timer
        const cleanupService = req.app.get('cleanupService');
        if (cleanupService && cleanupService.restartCleanupTimer(cleanupInterval)) {
            console.log(`Cleanup interval changed from ${oldInterval}ms to ${cleanupInterval}ms`);
            
            res.json({ 
                success: true, 
                cleanupInterval: config.getCleanupInterval(),
                message: 'Cleanup interval updated'
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to update cleanup interval' 
            });
        }
    } else {
        res.status(400).json({ 
            success: false, 
            message: 'cleanupInterval must be between 1000ms (1s) and 300000ms (5min)' 
        });
    }
});

/**
 * POST /reset - Reset task queue
 */
router.post('/reset', (req, res) => {
    taskQueue.reset();
    
    console.log('Task queue reset');
    
    // Broadcast update
    const io = req.app.get('io');
    if (io) {
        io.emit('task_update', taskQueue.getQueue());
    }
    
    res.json({ 
        status: 'reset', 
        taskQueue: taskQueue.getQueue()
    });
});

module.exports = router;