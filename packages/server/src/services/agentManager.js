/**
 * Agent Manager Service
 * Handles all agent-related operations including storage, updates, and cleanup
 */

class AgentManager {
  constructor() {
    this.agents = new Map();
    this.recentLogs = new Map(); // id -> Set of recent message hashes
  }

  /**
   * Get all agents
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by socket ID
   */
  getAgentBySocketId(socketId) {
    return this.agents.get(socketId);
  }

  /**
   * Find agent by agent ID
   */
  findAgentById(agentId) {
    for (const [socketId, agent] of this.agents.entries()) {
      if (agent.id === agentId) {
        return { agent, socketId };
      }
    }
    return { agent: null, socketId: null };
  }

  /**
   * Add or update an agent
   */
  setAgent(socketId, agent) {
    this.agents.set(socketId, agent);
  }

  /**
   * Remove an agent
   */
  removeAgent(socketId) {
    return this.agents.delete(socketId);
  }

  /**
   * Remove agent by ID
   */
  removeAgentById(agentId) {
    const { socketId } = this.findAgentById(agentId);
    if (socketId) {
      return this.removeAgent(socketId);
    }
    return false;
  }

  /**
   * Clear all agents
   */
  clearAllAgents() {
    this.agents.clear();
  }

  /**
   * Get agent count
   */
  getAgentCount() {
    return this.agents.size;
  }

  /**
   * Create a new agent object with default values
   */
  createAgent(params = {}) {
    return {
      id: params.id || `agent-${Date.now()}`,
      socketId: params.socketId || `rest-${params.id}`,
      name: params.name || 'Claude Agent',
      type: params.type || 'claude-code',
      status: params.status || 'idle',
      currentTask: params.currentTask,
      currentTool: params.currentTool,
      currentToolDescription: params.currentToolDescription,
      startTime: params.startTime || new Date(),
      lastActivity: params.lastActivity || new Date(),
      progress: params.progress || 0,
      tokensUsed: params.tokensUsed || 0,
      toolCalls: params.toolCalls || 0,
      logs: params.logs || [],
      metrics: params.metrics || {
        cpuUsage: 0,
        memoryUsage: 0,
        requestsPerSecond: 0,
        averageResponseTime: 0
      },
      recentTools: params.recentTools || [],
      lastToolUsed: params.lastToolUsed || null,
      lastToolTime: params.lastToolTime || null
    };
  }

  /**
   * Update agent tool usage
   */
  updateAgentTool(agentId, toolName, toolDescription = null) {
    const { agent, socketId } = this.findAgentById(agentId);
    if (!agent) return false;

    agent.toolCalls++;
    agent.currentTool = toolName;
    agent.currentToolDescription = toolDescription;
    agent.lastToolUsed = toolName;
    agent.lastToolTime = new Date();
    agent.lastActivity = new Date();

    // Update recent tools history (keep last 5)
    if (!agent.recentTools) agent.recentTools = [];
    
    // Only add if it's different from the last tool
    if (agent.recentTools.length === 0 || agent.recentTools[agent.recentTools.length - 1] !== toolName) {
      agent.recentTools.push(toolName);
      if (agent.recentTools.length > 5) {
        agent.recentTools.shift();
      }
    }

    this.setAgent(socketId, agent);
    return true;
  }

  /**
   * Clear agent tool
   */
  clearAgentTool(agentId) {
    const { agent, socketId } = this.findAgentById(agentId);
    if (!agent) return false;

    agent.currentTool = undefined;
    agent.currentToolDescription = undefined;
    agent.lastActivity = new Date();

    this.setAgent(socketId, agent);
    return true;
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId, status) {
    const { agent, socketId } = this.findAgentById(agentId);
    if (!agent) return false;

    agent.status = status;
    agent.lastActivity = new Date();

    // Clear current task and tool when agent goes idle
    if (status === 'idle') {
      agent.currentTask = undefined;
      agent.currentTool = undefined;
    }

    this.setAgent(socketId, agent);
    return true;
  }

  /**
   * Update agent task
   */
  updateAgentTask(agentId, task) {
    const { agent, socketId } = this.findAgentById(agentId);
    if (!agent) return false;

    agent.currentTask = task;
    agent.status = 'working';
    agent.lastActivity = new Date();

    this.setAgent(socketId, agent);
    return true;
  }

  /**
   * Add log to agent
   */
  addAgentLog(agentId, logEntry) {
    const { agent, socketId } = this.findAgentById(agentId);
    if (!agent) return false;

    if (!agent.logs) agent.logs = [];
    agent.logs.push(logEntry);
    if (agent.logs.length > 100) agent.logs.shift();

    this.setAgent(socketId, agent);
    return true;
  }

  /**
   * Check for duplicate log
   */
  isDuplicateLog(agentId, message, level) {
    const messageHash = `${agentId}-${message}-${level}`;
    const now = Date.now();

    // Initialize recent logs for this agent if needed
    if (!this.recentLogs.has(agentId)) {
      this.recentLogs.set(agentId, new Map());
    }

    const agentRecentLogs = this.recentLogs.get(agentId);

    // Check if this message was sent recently (within 5 seconds)
    if (agentRecentLogs.has(messageHash)) {
      const lastTime = agentRecentLogs.get(messageHash);
      if (now - lastTime < 5000) {
        return true; // Duplicate message
      }
    }

    // Store this message with timestamp
    agentRecentLogs.set(messageHash, now);

    // Clean up old entries (older than 30 seconds)
    for (const [hash, timestamp] of agentRecentLogs.entries()) {
      if (now - timestamp > 30000) {
        agentRecentLogs.delete(hash);
      }
    }

    return false;
  }
}

module.exports = new AgentManager();