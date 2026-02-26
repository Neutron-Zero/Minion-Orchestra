/**
 * Log API Routes
 * Handles log-related HTTP endpoints
 */

const express = require('express');
const router = express.Router();
const agentManager = require('../services/agentManager');

/**
 * POST /api/log - Log entry endpoint
 */
router.post('/log', (req, res) => {
    try {
        const io = req.app.get('io');
        const { agentId, level, message, timestamp } = req.body;
        
        // Find existing agent by ID
        let { agent, socketId } = agentManager.findAgentById(agentId);
        
        if (!agent) {
            // Create new agent if doesn't exist
            agent = agentManager.createAgent({
                id: agentId,
                socketId: `rest-${agentId}`,
                name: 'Claude Agent',
                type: 'claude-code',
                status: 'working',
                startTime: new Date(),
                lastActivity: new Date()
            });
            
            agentManager.setAgent(`rest-${agentId}`, agent);
            socketId = `rest-${agentId}`;
        } else {
            // Update the stored reference
            agentManager.setAgent(socketId, agent);
        }
        
        // Update agent based on log message content
        if (message) {
            if (message.includes('Using tool:') || message.includes('🔧')) {
                agent.toolCalls++;
                agent.status = 'working';
            } else if (message.includes('completed') || message.includes('✅')) {
                agent.status = 'completed';
            } else if (message.includes('error') || message.includes('❌')) {
                agent.status = 'failed';
            } else if (message.includes('prompt') || message.includes('💬')) {
                agent.status = 'working';
            } else if (message.includes('Claude is wa')) {
                // Handle "Claude is waiting..." message
                agent.status = 'idle';
                agent.currentTask = 'Waiting for input';
            }
        }
        
        const logEntry = {
            timestamp: new Date(timestamp || Date.now()),
            level: level || 'info',
            message: message || '',
            agentId: agent.id
        };
        
        // Store in agent logs
        agentManager.addAgentLog(agent.id, logEntry);
        
        // Broadcast to all clients
        io.emit('log', logEntry);
        
        console.log(`Log entry from ${agentId}: ${message}`);
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error in /api/log:', error);
        console.error('Request body:', req.body);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;