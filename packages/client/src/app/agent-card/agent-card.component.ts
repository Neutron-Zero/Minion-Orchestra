import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Agent, AgentMonitorService } from '../services/agent-monitor.service';

@Component({
  selector: 'app-agent-card',
  templateUrl: './agent-card.component.html',
  styleUrls: ['./agent-card.component.scss']
})
export class AgentCardComponent {
  @Input() agent!: Agent;
  @Output() pause = new EventEmitter<Agent>();
  @Output() resume = new EventEmitter<Agent>();
  @Output() remove = new EventEmitter<Agent>();

  constructor(private agentService: AgentMonitorService) {}

  // Removed pause/resume - Claude Code agents run independently

  onRemove(): void {
    this.remove.emit(this.agent);
  }

  getFormattedAgentId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }

  getStatusColor(status: string): string {
    switch(status) {
      case 'working': return '#4caf50';
      case 'completed': return '#2196f3';
      case 'failed': return '#f44336';
      case 'paused': return '#ff9800';
      case 'idle': return '#6366f1';
      case 'awaiting-permission': return '#ffc107';
      case 'permission-requested': return '#ffc107';
      default: return '#9e9e9e';
    }
  }

  getStatusIcon(status: string): string {
    switch(status) {
      case 'working': return 'engineering';
      case 'completed': return 'check_circle';
      case 'failed': return 'error';
      case 'paused': return 'pause_circle';
      case 'idle': return 'schedule';
      case 'awaiting-permission': return 'lock_open';
      case 'permission-requested': return 'lock_open';
      default: return 'pending';
    }
  }

  getToolDisplay(agent: any): string {
    if (agent.currentTool) {
      // Use description if available, otherwise fall back to tool name
      if (agent.currentToolDescription) {
        return agent.currentToolDescription;
      }
      const toolName = agent.currentTool.charAt(0).toUpperCase() + agent.currentTool.slice(1);
      return `Using ${toolName}`;
    }
    
    return '';
  }

  getFolderName(agent: Agent): string {
    if (agent.workingDirectory) {
      // Extract the last folder name from the path
      const parts = agent.workingDirectory.split('/').filter(p => p);
      return parts[parts.length - 1] || '';
    }
    return '';
  }

  getSessionDuration(agent: any): string {
    if (!agent.startTime) return '';
    
    const now = new Date();
    const start = new Date(agent.startTime);
    const diff = now.getTime() - start.getTime();
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return '<1m';
    }
  }

  getEnhancedStatusMessage(agent: any): string {
    if (agent.status === 'working' && agent.currentTool) {
      // Use description if available, otherwise fall back to tool name
      if (agent.currentToolDescription) {
        return agent.currentToolDescription;
      }
      return `Using ${agent.currentTool}`;
    }
    
    if (agent.status === 'idle') {
      if (agent.lastToolUsed && agent.lastToolTime) {
        const timeSince = this.getTimeSince(agent.lastToolTime);
        return `Last used ${agent.lastToolUsed} ${timeSince} ago`;
      }
      return 'Waiting for input...';
    }
    
    return agent.status;
  }

  getRecentToolsDisplay(agent: any): string {
    if (!agent.recentTools || agent.recentTools.length === 0) {
      return '';
    }
    
    return agent.recentTools.slice(0, 3).join(' → ');
  }

  private getTimeSince(date: Date | string): string {
    const now = new Date();
    const past = new Date(date);
    const diff = now.getTime() - past.getTime();
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return '<1m';
    }
  }

  getActivityLevel(agent: any): string {
    if (!agent.lastActivity || !agent.startTime) return 'low';
    
    const now = new Date();
    const lastActivity = new Date(agent.lastActivity);
    const sessionStart = new Date(agent.startTime);
    
    const sessionDuration = now.getTime() - sessionStart.getTime();
    const timeSinceActivity = now.getTime() - lastActivity.getTime();
    
    // Recent activity (less than 5 minutes ago)
    if (timeSinceActivity < 300000) return 'high';
    
    // Moderate activity (less than 15 minutes ago)
    if (timeSinceActivity < 900000) return 'medium';
    
    // Low activity
    return 'low';
  }

  getActivityIndicatorClass(agent: any): string {
    const level = this.getActivityLevel(agent);
    return `activity-${level}`;
  }

  getAgentColor(agentId: string): string {
    // Use amber/yellow color for permission states
    if (this.agent?.status === 'awaiting-permission' || this.agent?.status === 'permission-requested') {
      return '#ffc107';
    }
    if (!agentId) return '#E53E3E'; // Default color
    return this.agentService.getAgentColor(agentId);
  }

  getAgentBackgroundColor(agentId: string): string {
    // Use amber/yellow background for permission states
    if (this.agent?.status === 'awaiting-permission' || this.agent?.status === 'permission-requested') {
      return 'rgba(255, 193, 7, 0.1)';
    }
    if (!agentId) return 'rgba(229, 62, 62, 0.05)'; // Default background
    const color = this.agentService.getAgentColor(agentId);
    // Convert hex to rgba with 5% opacity for subtle background tint
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 0.05)`;
  }

  // Another test comment to verify debug logging
}