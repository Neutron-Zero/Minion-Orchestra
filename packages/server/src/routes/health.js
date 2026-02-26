/**
 * Health Check Routes
 * System health and configuration endpoints
 */

const express = require('express');
const router = express.Router();
const agentManager = require('../services/agentManager');
const taskQueue = require('../services/taskQueue');

// Store configuration
let cleanupIntervalMs = 5000; // Default 5 seconds
let cleanupTimer = null;

/**
 * GET /health - Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    agents: agentManager.getAgentCount(),
    taskQueue: taskQueue.getQueue(),
    cleanupInterval: cleanupIntervalMs
  });
});

/**
 * POST /config - Update configuration
 */
router.post('/config', (req, res) => {
  const { cleanupInterval } = req.body;
  
  if (cleanupInterval && cleanupInterval >= 1000 && cleanupInterval <= 300000) {
    const oldInterval = cleanupIntervalMs;
    cleanupIntervalMs = cleanupInterval;
    
    // Restart the cleanup timer with new interval
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
    }
    
    // Note: startCleanupTimer needs to be called from main server
    // This is handled by exporting getters/setters
    
    console.log(`Cleanup interval changed from ${oldInterval}ms to ${cleanupIntervalMs}ms`);
    
    res.json({ 
      success: true, 
      cleanupInterval: cleanupIntervalMs,
      message: 'Cleanup interval updated'
    });
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
  
  // Broadcast update (requires io instance)
  if (router.io) {
    router.io.emit('task_update', taskQueue.getQueue());
  }
  
  res.json({ 
    status: 'reset', 
    taskQueue: taskQueue.getQueue()
  });
});

// Export configuration getters/setters
router.getCleanupInterval = () => cleanupIntervalMs;
router.setCleanupInterval = (ms) => { cleanupIntervalMs = ms; };
router.getCleanupTimer = () => cleanupTimer;
router.setCleanupTimer = (timer) => { cleanupTimer = timer; };

module.exports = router;