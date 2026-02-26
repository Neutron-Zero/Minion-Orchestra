/**
 * Hook API Routes
 * Comprehensive endpoint for all Claude Code hook events
 * Logs all incoming payloads and responses
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const agentManager = require('../services/agentManager');
const taskQueue = require('../services/taskQueue');
const { broadcastAgentUpdate, broadcastTaskQueueUpdate } = require('../websocket/socketHandlers');

// Log file path
const LOG_DIR = path.join(__dirname, '../../logs');
const HOOK_LOG_FILE = path.join(LOG_DIR, 'hooks.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Log hook data to file
 */
function logHookData(eventType, payload, response = null) {
    try {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            eventType,
            payload,
            response
        };
        
        const logLine = JSON.stringify(logEntry) + '\n';
        fs.appendFileSync(HOOK_LOG_FILE, logLine);
        
        // Only log to console if debug mode is enabled
        const isDebug = process.env.DEBUG === 'true' || process.argv.includes('--debug');
        if (isDebug) {
            console.log(`\n🪝 HOOK: ${eventType} at ${timestamp}`);
            console.log('📥 Payload:', JSON.stringify(payload, null, 2));
            if (response) {
                console.log('📤 Response:', JSON.stringify(response, null, 2));
            }
        }
    } catch (error) {
        console.error('Failed to log hook data:', error);
    }
}

/**
 * POST /api/hook - Comprehensive hook endpoint
 * Handles all Claude Code hook events
 */
router.post('/hook', (req, res) => {
    try {
        const io = req.app.get('io');
        const { eventType, agentId, agentName, timestamp, data, response } = req.body;
        
        // Log the incoming hook
        logHookData(eventType, req.body);
        
        // Find or create agent
        let { agent, socketId } = agentManager.findAgentById(agentId);
        
        if (!agent) {
            // Create new agent for first event
            agent = agentManager.createAgent({
                id: agentId,
                socketId: `hook-${agentId}`,
                name: agentName || 'Claude Agent',
                type: 'claude-code',
                status: 'idle',
                startTime: new Date(timestamp),
                lastActivity: new Date(timestamp)
            });
            agentManager.setAgent(`hook-${agentId}`, agent);
            socketId = `hook-${agentId}`;
        }
        
        // Process event based on type
        switch (eventType) {
            case 'SessionStart':
                // New session started
                agent.status = 'idle';
                agent.startTime = new Date(timestamp);
                agent.sessionData = data;
                
                // Log session start
                const sessionLog = {
                    timestamp: new Date(timestamp),
                    level: 'info',
                    message: `🚀 Session started - Agent ID: ${agentId}`,
                    agentId: agentId
                };
                io.emit('log', sessionLog);
                
                // If there's a response, log it
                if (response) {
                    logHookData(eventType, req.body, response);
                }
                break;
                
            case 'UserPromptSubmit':
                // User submitted a prompt
                const prompt = data?.prompt || 'New task';
                agent.status = 'working';
                agent.currentTask = prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '');
                taskQueue.increment('inProgress');
                
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: 'info',
                    message: `💬 User: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`,
                    agentId: agentId
                });
                break;
                
            case 'PreToolUse':
                // Tool is about to be used
                const toolName = data?.tool_name || 'Unknown';
                const toolDescription = data?.tool_input?.description;
                agentManager.updateAgentTool(agentId, toolName, toolDescription);
                
                // Check if this is a TodoWrite tool
                if (toolName === 'TodoWrite' && data?.tool_input?.todos) {
                    // Find the in-progress todo
                    const todos = data.tool_input.todos;
                    const inProgressTodo = todos.find(todo => todo.status === 'in_progress');
                    if (inProgressTodo) {
                        // Update the agent's current task with the active form
                        agent.currentTask = inProgressTodo.activeForm || inProgressTodo.content;
                        agentManager.setAgent(socketId, agent);
                        
                        // Emit a special log for the todo task
                        io.emit('log', {
                            timestamp: new Date(timestamp),
                            level: 'info',
                            message: `📋 ${inProgressTodo.activeForm || inProgressTodo.content}`,
                            agentId: agentId
                        });
                    }
                }
                
                // Create message with description if available
                let toolMessage = `🔧 Using ${toolName}`;
                if (toolDescription) {
                    toolMessage = `🔧 ${toolDescription}`;
                }
                
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: 'info',
                    message: toolMessage,
                    agentId: agentId
                });
                break;
                
            case 'PostToolUse':
                // Tool completed
                agentManager.clearAgentTool(agentId);
                
                const tool = data?.tool_name || 'Unknown';
                const success = !data?.error;
                
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: success ? 'info' : 'error',
                    message: success ? `✅ Completed ${tool}` : `❌ Failed ${tool}: ${data?.error}`,
                    agentId: agentId
                });
                break;
                
            case 'SubagentStart':
                // Subagent started - create a new subagent entity
                const subagentId = `${agentId}-sub-${Date.now()}`;
                const subagentDescription = data?.description || 'Subagent Task';
                
                // Create subagent as a new agent
                const subagent = agentManager.createAgent({
                    id: subagentId,
                    socketId: `hook-${subagentId}`,
                    name: `🤖 ${subagentDescription}`,
                    type: 'subagent',
                    status: 'working',
                    currentTask: subagentDescription,
                    startTime: new Date(timestamp),
                    lastActivity: new Date(timestamp)
                });
                agentManager.setAgent(`hook-${subagentId}`, subagent);
                
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: 'info',
                    message: `🤖 Subagent started: ${subagentDescription}`,
                    agentId: agentId
                });
                
                // Broadcast agent update
                broadcastAgentUpdate(io);
                break;
                
            case 'SubagentStop':
                // Subagent stopped - find and update/remove subagent
                // Find any subagents associated with this parent agent
                const allAgents = agentManager.getAllAgents();
                const subagentsToRemove = allAgents.filter(a => 
                    a.type === 'subagent' && 
                    a.id.startsWith(`${agentId}-sub-`)
                );
                
                // Mark subagents as completed and remove after a delay
                subagentsToRemove.forEach(subagent => {
                    subagent.status = 'completed';
                    subagent.currentTask = undefined;
                    subagent.lastActivity = new Date(timestamp);
                    
                    // Remove subagent after 5 seconds
                    setTimeout(() => {
                        agentManager.removeAgentById(subagent.id);
                        broadcastAgentUpdate(io);
                    }, 5000);
                });
                
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: 'info',
                    message: `🤖 Subagent completed`,
                    agentId: agentId
                });
                
                // Broadcast agent update
                broadcastAgentUpdate(io);
                break;
                
            case 'PreCompact':
                // Context compaction starting
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: 'debug',
                    message: `📦 Compacting context...`,
                    agentId: agentId
                });
                break;
                
            case 'PostCompact':
                // Context compaction completed
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: 'debug',
                    message: `📦 Context compacted`,
                    agentId: agentId
                });
                break;
                
            case 'ContextTruncation':
                // Context was truncated
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: 'warning',
                    message: `✂️ Context truncated - conversation too long`,
                    agentId: agentId
                });
                break;
                
            case 'Notification':
                // General notification
                const notificationMsg = data?.message || 'Notification';
                const notificationLevel = data?.level || 'info';
                
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: notificationLevel,
                    message: `📢 ${notificationMsg}`,
                    agentId: agentId
                });
                break;
                
            case 'Stop':
                // Session stopped
                agent.status = 'idle';
                agent.currentTask = undefined;
                agent.currentTool = undefined;
                
                if (taskQueue.getQueue().inProgress > 0) {
                    taskQueue.decrement('inProgress');
                }
                taskQueue.increment('completed');
                
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: 'info',
                    message: `🏁 Session completed`,
                    agentId: agentId
                });
                break;
                
            default:
                // Unknown event type - log it anyway
                io.emit('log', {
                    timestamp: new Date(timestamp),
                    level: 'debug',
                    message: `📍 ${eventType}: ${JSON.stringify(data).substring(0, 100)}`,
                    agentId: agentId
                });
                break;
        }
        
        // Update agent's last activity
        agent.lastActivity = new Date(timestamp);
        agentManager.setAgent(socketId, agent);
        
        // Broadcast updates
        broadcastAgentUpdate(io);
        broadcastTaskQueueUpdate(io);
        
        // Send success response
        res.json({ 
            success: true,
            eventType: eventType,
            agentId: agentId
        });
        
    } catch (error) {
        console.error('Error in /api/hook:', error);
        console.error('Request body:', req.body);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hooks/logs - Get recent hook logs
 */
router.get('/hooks/logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        
        if (!fs.existsSync(HOOK_LOG_FILE)) {
            return res.json({ logs: [] });
        }
        
        const logs = fs.readFileSync(HOOK_LOG_FILE, 'utf-8')
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(log => log !== null)
            .slice(-limit);
        
        res.json({ logs });
        
    } catch (error) {
        console.error('Error reading hook logs:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/hooks/logs - Clear hook logs
 */
router.delete('/hooks/logs', (req, res) => {
    try {
        if (fs.existsSync(HOOK_LOG_FILE)) {
            fs.writeFileSync(HOOK_LOG_FILE, '');
        }
        res.json({ success: true, message: 'Hook logs cleared' });
    } catch (error) {
        console.error('Error clearing hook logs:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;