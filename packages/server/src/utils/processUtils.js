/**
 * Process Utility Functions
 * Helper functions for process management and cleanup
 */

/**
 * Check if a process ID exists
 * @param {number} pid - Process ID to check
 * @returns {boolean} True if process exists
 */
function pidExists(pid) {
  try {
    // kill -0 checks if process exists without actually killing it
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // If kill throws, the process doesn't exist
    return false;
  }
}

/**
 * Extract PID from agent ID
 * @param {string} agentId - Agent ID in format 'claude-pid-12345'
 * @returns {number|null} Extracted PID or null if not found
 */
function extractPidFromAgentId(agentId) {
  if (!agentId) return null;
  
  const match = agentId.match(/^claude-pid-(\d+)$/);
  if (match) {
    return parseInt(match[1]);
  }
  return null;
}

/**
 * Clean up dead agents based on PID
 * @param {AgentManager} agentManager - Agent manager instance
 * @param {TaskQueue} taskQueue - Task queue instance
 * @returns {number} Number of agents removed
 */
function cleanupDeadAgents(agentManager, taskQueue) {
  let removedCount = 0;
  const toRemove = [];

  for (const [socketId, agent] of agentManager.agents.entries()) {
    // Skip invalid agents
    if (!agent || !agent.id) {
      toRemove.push(socketId);
      continue;
    }

    // Extract PID from agent ID
    const pid = extractPidFromAgentId(agent.id);
    if (pid && !pidExists(pid)) {
      toRemove.push(socketId);
      
      // Update task queue
      taskQueue.decrement(agent.status);
      
      removedCount++;
    }
  }

  // Remove dead agents
  toRemove.forEach(socketId => agentManager.removeAgent(socketId));

  return removedCount;
}

module.exports = {
  pidExists,
  extractPidFromAgentId,
  cleanupDeadAgents
};