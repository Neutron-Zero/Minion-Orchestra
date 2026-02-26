/**
 * Task Queue Service
 * Manages the task queue state and statistics
 */

class TaskQueue {
  constructor() {
    this.queue = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      failed: 0
    };
  }

  /**
   * Get current queue state
   */
  getQueue() {
    return this.queue;
  }

  /**
   * Reset the entire queue
   */
  reset() {
    this.queue.pending = 0;
    this.queue.inProgress = 0;
    this.queue.completed = 0;
    this.queue.failed = 0;
  }

  /**
   * Update task status
   */
  updateTaskStatus(oldStatus, newStatus) {
    // Decrement old status count
    if (oldStatus) {
      switch (oldStatus) {
        case 'pending':
          if (this.queue.pending > 0) this.queue.pending--;
          break;
        case 'working':
        case 'in_progress':
          if (this.queue.inProgress > 0) this.queue.inProgress--;
          break;
      }
    }

    // Increment new status count
    if (newStatus) {
      switch (newStatus) {
        case 'pending':
          this.queue.pending++;
          break;
        case 'working':
        case 'in_progress':
          this.queue.inProgress++;
          break;
        case 'completed':
          this.queue.completed++;
          break;
        case 'failed':
          this.queue.failed++;
          break;
      }
    }
  }

  /**
   * Increment specific status count
   */
  increment(status) {
    switch (status) {
      case 'pending':
        this.queue.pending++;
        break;
      case 'working':
      case 'inProgress':
        this.queue.inProgress++;
        break;
      case 'completed':
        this.queue.completed++;
        break;
      case 'failed':
        this.queue.failed++;
        break;
    }
  }

  /**
   * Decrement specific status count
   */
  decrement(status) {
    switch (status) {
      case 'pending':
        if (this.queue.pending > 0) this.queue.pending--;
        break;
      case 'working':
      case 'inProgress':
        if (this.queue.inProgress > 0) this.queue.inProgress--;
        break;
      case 'completed':
        if (this.queue.completed > 0) this.queue.completed--;
        break;
      case 'failed':
        if (this.queue.failed > 0) this.queue.failed--;
        break;
    }
  }
}

module.exports = new TaskQueue();