/**
 * Task API Routes
 * Handles task-related HTTP endpoints
 */

const express = require('express');
const router = express.Router();
const agentManager = require('../services/agentManager');
const taskQueue = require('../services/taskQueue');
const { broadcastAgentUpdate, broadcastTaskQueueUpdate } = require('../websocket/socketHandlers');

/**
 * POST /api/task - Task update endpoint
 */
router.post('/task', (req, res) => {
    try {
        const io = req.app.get('io');
        const { agentId, task, status } = req.body;
        
        // Find existing agent by ID
        const { agent, socketId } = agentManager.findAgentById(agentId);
        
        if (!agent) {
            // Create agent if doesn't exist - extract name from task if it's a prompt
            let agentName = 'Claude Agent';
            if (task && task.length > 0) {
                // Use truncated task as agent name
                const taskPreview = task.substring(0, 50);
                agentName = `Claude: ${taskPreview}${task.length > 50 ? '...' : ''}`;
            }
            
            const newAgent = agentManager.createAgent({
                id: agentId,
                socketId: `rest-${agentId}`,
                name: agentName,
                type: 'claude-code',
                status: status || 'working',
                currentTask: task,
                startTime: new Date(),
                lastActivity: new Date()
            });
            
            agentManager.setAgent(`rest-${agentId}`, newAgent);
        } else {
            agent.currentTask = task;
            agent.status = status || 'working';
            agent.lastActivity = new Date();
            agentManager.setAgent(socketId, agent);
        }
        
        // Update task queue
        if (status === 'working') {
            taskQueue.increment('inProgress');
        } else if (status === 'completed') {
            taskQueue.increment('completed');
            taskQueue.decrement('inProgress');
        } else if (status === 'failed') {
            taskQueue.increment('failed');
            taskQueue.decrement('inProgress');
        }
        
        console.log(`Task updated for agent ${agentId}`);
        broadcastAgentUpdate(io);
        broadcastTaskQueueUpdate(io);
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error in /api/task:', error);
        console.error('Request body:', req.body);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;