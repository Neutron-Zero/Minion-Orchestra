/**
 * WebSocket Event Handlers
 * Handles all Socket.io events and connections
 */

const agentManager = require('../services/agentManager');
const taskQueue = require('../services/taskQueue');

/**
 * Broadcast agent updates to all connected clients
 */
function broadcastAgentUpdate(io) {
  io.emit('agent_update', agentManager.getAllAgents());
}

/**
 * Broadcast task queue updates to all connected clients
 */
function broadcastTaskQueueUpdate(io) {
  io.emit('task_update', taskQueue.getQueue());
}

/**
 * Initialize WebSocket handlers
 */
function initializeSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`New WebSocket connection: ${socket.id}`);

    // Agent registers itself
    socket.on('register_agent', (data) => {
      // Check if agent with same ID already exists and remove it
      const existingAgentKey = Array.from(agentManager.agents.entries())
        .find(([key, agent]) => agent.id === data.id)?.[0];
      
      if (existingAgentKey) {
        console.log(`Removing duplicate agent: ${data.id}`);
        agentManager.removeAgent(existingAgentKey);
      }
      
      const agent = agentManager.createAgent({
        id: data.id || socket.id,
        socketId: socket.id,
        name: data.name || 'Unknown Agent',
        type: data.type || 'general-purpose',
        status: 'idle',
        startTime: new Date(),
        lastActivity: new Date()
      });
      
      agentManager.setAgent(socket.id, agent);
      console.log(`Agent registered: ${agent.id}`);
      
      // Send current state to new agent
      socket.emit('welcome', { 
        id: agent.id,
        agents: agentManager.getAllAgents(),
        taskQueue: taskQueue.getQueue()
      });
      
      broadcastAgentUpdate(io);
    });

    // Agent sends status update
    socket.on('status_update', (data) => {
      const agent = agentManager.getAgentBySocketId(socket.id);
      if (agent) {
        const oldStatus = agent.status;
        Object.assign(agent, data, { lastActivity: new Date() });
        
        // Update task queue based on status change
        if (oldStatus !== data.status) {
          taskQueue.updateTaskStatus(oldStatus, data.status);
          broadcastTaskQueueUpdate(io);
        }
        
        agentManager.setAgent(socket.id, agent);
        console.log(`Agent ${agent.id} status updated to ${data.status}`);
        broadcastAgentUpdate(io);
      }
    });

    // Agent sends task update
    socket.on('task_update', (data) => {
      const agent = agentManager.getAgentBySocketId(socket.id);
      if (agent) {
        agent.currentTask = data.task;
        agent.progress = data.progress || 0;
        agent.lastActivity = new Date();
        
        if (data.task) {
          agent.startTime = new Date();
          agent.status = 'working';
        }
        
        agentManager.setAgent(socket.id, agent);
        console.log(`Agent ${agent.id} task updated`);
        broadcastAgentUpdate(io);
      }
    });

    // Agent sends metrics update
    socket.on('metrics_update', (data) => {
      const agent = agentManager.getAgentBySocketId(socket.id);
      if (agent) {
        if (data.tokensUsed) agent.tokensUsed += data.tokensUsed;
        if (data.toolCalls) agent.toolCalls += data.toolCalls;
        if (data.metrics) Object.assign(agent.metrics, data.metrics);
        
        agent.lastActivity = new Date();
        agentManager.setAgent(socket.id, agent);
        
        io.emit('metrics', {
          id: agent.id,
          metrics: agent.metrics,
          tokensUsed: agent.tokensUsed,
          toolCalls: agent.toolCalls
        });
        
        broadcastAgentUpdate(io);
      }
    });

    // Agent sends log entry
    socket.on('log', (data) => {
      const agent = agentManager.getAgentBySocketId(socket.id);
      if (agent) {
        // Check for duplicate logs
        if (agentManager.isDuplicateLog(agent.id, data.message, data.level)) {
          return; // Skip duplicate message
        }
        
        const logEntry = {
          timestamp: new Date(),
          level: data.level || 'info',
          message: data.message,
          agentId: agent.id
        };
        
        // Store in agent logs
        agentManager.addAgentLog(agent.id, logEntry);
        
        // Broadcast log to all clients
        io.emit('log', logEntry);
        console.log(`Log from ${agent.id}: ${data.message}`);
      }
    });

    // Control commands from Minion Command
    socket.on('pause_agent', (data) => {
      const { agent, socketId } = agentManager.findAgentById(data.id);
      if (agent && socketId) {
        io.to(socketId).emit('control', { command: 'pause' });
        agentManager.updateAgentStatus(data.id, 'paused');
        broadcastAgentUpdate(io);
      }
    });

    socket.on('resume_agent', (data) => {
      const { agent, socketId } = agentManager.findAgentById(data.id);
      if (agent && socketId) {
        io.to(socketId).emit('control', { command: 'resume' });
        agentManager.updateAgentStatus(data.id, 'working');
        broadcastAgentUpdate(io);
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      const agent = agentManager.getAgentBySocketId(socket.id);
      if (agent) {
        console.log(`Agent disconnected: ${agent.id}`);
        
        // Update task queue
        taskQueue.decrement(agent.status);
        
        agentManager.removeAgent(socket.id);
        broadcastAgentUpdate(io);
        broadcastTaskQueueUpdate(io);
      }
    });
  });
}

module.exports = {
  initializeSocketHandlers,
  broadcastAgentUpdate,
  broadcastTaskQueueUpdate
};