/**
 * Agent API Routes
 * Handles agent-related HTTP endpoints for Claude hooks
 */

const express = require('express');
const router = express.Router();
const agentManager = require('../services/agentManager');
const taskQueue = require('../services/taskQueue');
const { broadcastAgentUpdate, broadcastTaskQueueUpdate } = require('../websocket/socketHandlers');

/**
 * Handle Claude hook events
 */
function handleHookEvent(req, res, io) {
   const hookEventName = req.body.data?.hook_event_name || req.body.type;
   const hookAgentId = req.body.agentId;
   
   if (!hookEventName || !hookAgentId) {
      return false;
   }
   
   const { agent, socketId } = agentManager.findAgentById(hookAgentId);
   
   switch (hookEventName) {
      case 'PreToolUse':
         handlePreToolUse(agent, socketId, req.body, io);
         break;
         
      case 'PostToolUse':
         handlePostToolUse(agent, socketId, io);
         break;
         
      case 'UserPromptSubmit':
         handleUserPromptSubmit(agent, socketId, req.body, io);
         break;
         
      case 'Stop':
      case 'SubagentStop':
         handleStopEvent(agent, socketId, hookEventName, io);
         break;
         
      default:
         return false;
   }
   
   res.json({ success: true });
   return true;
}

/**
 * Handle PreToolUse event
 */
function handlePreToolUse(agent, socketId, data, io) {
   if (!agent) return;
   
   const toolDescription = data.data?.tool_input?.description || data.data?.description;
   const toolName = data.data?.tool_name;
   
   if (toolName) {
      agentManager.updateAgentTool(agent.id, toolName, toolDescription);
      
      // Emit log entry for tool usage
      const toolLogMessage = toolDescription ? 
         `🔧 ${toolDescription}` : 
         `🔧 Using ${toolName || 'unknown tool'}`;
      
      const toolLogEntry = {
         timestamp: new Date(),
         level: 'info',
         message: toolLogMessage,
         agentId: agent.id
      };
      
      io.emit('log', toolLogEntry);
   }
   
   broadcastAgentUpdate(io);
}

/**
 * Handle PostToolUse event
 */
function handlePostToolUse(agent, socketId, io) {
   if (!agent) return;
   
   agentManager.clearAgentTool(agent.id);
   broadcastAgentUpdate(io);
}

/**
 * Handle UserPromptSubmit event
 */
function handleUserPromptSubmit(agent, socketId, data, io) {
   if (!agent) return;
   
   const prompt = data.data?.prompt || 'New prompt received';
   const truncatedPrompt = prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '');
   
   agentManager.updateAgentTask(agent.id, truncatedPrompt);
   
   const logEntry = {
      timestamp: new Date(),
      level: 'info',
      message: `💬 User prompt: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`,
      agentId: agent.id
   };
   
   io.emit('log', logEntry);
   broadcastAgentUpdate(io);
}

/**
 * Handle Stop events
 */
function handleStopEvent(agent, socketId, eventName, io) {
   if (!agent) return;
   
   agentManager.updateAgentStatus(agent.id, 'completed');
   agentManager.clearAgentTool(agent.id);
   
   const logEntry = {
      timestamp: new Date(),
      level: 'info',
      message: eventName === 'SubagentStop' ? '🤖 Subagent completed task' : '✅ Task completed',
      agentId: agent.id
   };
   
   io.emit('log', logEntry);
   broadcastAgentUpdate(io);
}

/**
 * POST /api/agent - Agent update endpoint
 */
router.post('/agent', (req, res) => {
   try {
      const io = req.app.get('io');
      const { id, name, type, status, lastActivity, currentTool } = req.body;
      
      // Try to handle as hook event first
      if (handleHookEvent(req, res, io)) {
         return;
      }
      
      // Handle disconnect message
      if (req.body.type === 'disconnect') {
         const targetAgentId = req.body.agentId;
         const removed = agentManager.removeAgentById(targetAgentId);
         
         if (removed) {
            const { agent } = agentManager.findAgentById(targetAgentId);
            if (agent) {
               taskQueue.decrement(agent.status);
            }
            
            broadcastAgentUpdate(io);
            broadcastTaskQueueUpdate(io);
            io.emit('agent_update', { type: 'disconnect', agentId: targetAgentId });
         }
         
         return res.json({ success: true });
      }
      
      // Handle clear-all message
      if (req.body.type === 'clear-all') {
         console.log('Clearing all agents');
         agentManager.clearAllAgents();
         taskQueue.reset();
         
         broadcastAgentUpdate(io);
         broadcastTaskQueueUpdate(io);
         
         return res.json({ success: true });
      }
      
      // Regular agent update logic
      const { agent, socketId } = agentManager.findAgentById(id);
      
      if (!agent) {
         // Create new agent
         const newAgent = agentManager.createAgent({
            id: id,
            socketId: `rest-${id}`,
            name: name || 'Claude Agent',
            type: type || 'claude-code',
            status: status || 'idle',
            currentTool: currentTool,
            lastActivity: new Date(lastActivity || Date.now())
         });
         
         agentManager.setAgent(`rest-${id}`, newAgent);
      } else {
         // Update existing agent
         agent.name = name || agent.name;
         agent.status = status || agent.status;
         agent.lastActivity = new Date(lastActivity || Date.now());
         
         if (currentTool !== undefined) {
            agent.currentTool = currentTool;
         }
         
         if (status === 'idle') {
            agent.currentTask = undefined;
            agent.currentTool = undefined;
         }
         
         agentManager.setAgent(socketId, agent);
      }
      
      console.log(`Agent ${id} updated via API`);
      broadcastAgentUpdate(io);
      res.json({ success: true });
      
   } catch (error) {
      console.error('Error in /api/agent:', error);
      console.error('Request body:', req.body);
      res.status(500).json({ success: false, error: error.message });
   }
});

module.exports = router;