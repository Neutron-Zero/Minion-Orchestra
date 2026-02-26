import { Component, OnInit } from '@angular/core';
import { AgentMonitorService, Agent } from '../services/agent-monitor.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-analytics',
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss']
})
export class AnalyticsComponent implements OnInit {
  agents$: Observable<Agent[]>;

  constructor(private agentService: AgentMonitorService) {
    this.agents$ = this.agentService.getAgents();
  }

  ngOnInit(): void {
  }

  getStatusIcon(status: string): string {
    switch(status) {
      case 'working': return 'engineering';
      case 'completed': return 'check_circle';
      case 'failed': return 'error';
      case 'paused': return 'pause_circle';
      default: return 'pending';
    }
  }

  getStatusColorHex(status: string): string {
    switch(status) {
      case 'working': return '#4caf50';
      case 'completed': return '#2196f3';
      case 'failed': return '#f44336';
      case 'paused': return '#a78bfa';
      default: return '#9e9e9e';
    }
  }

  getProgressColor(progress: number | undefined): string {
    if (!progress) return 'primary';
    if (progress === 100) return 'accent';
    if (progress > 75) return 'primary';
    return 'primary';
  }

  getElapsedTime(startTime?: Date | string): string {
    if (!startTime) return '-';
    const startDate = new Date(startTime);
    if (isNaN(startDate.getTime())) return '-';
    const elapsed = Date.now() - startDate.getTime();
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  getTimeAgo(time?: Date | string): string {
    if (!time) return '-';
    const timeDate = new Date(time);
    if (isNaN(timeDate.getTime())) return '-';
    const elapsed = Date.now() - timeDate.getTime();
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes === 1) return '1 minute ago';
    return `${minutes} minutes ago`;
  }

  pauseAgent(agent: Agent): void {
    this.agentService.pauseAgent(agent.id);
  }

  resumeAgent(agent: Agent): void {
    this.agentService.resumeAgent(agent.id);
  }

  viewAgentLogs(agentId: string): void {
    // Navigate to logs view filtered by agent
    console.log('View logs for agent:', agentId);
  }

  getFormattedAgentId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }

  removeAgent(agent: Agent): void {
    this.agentService.removeAgent(agent.id);
  }

  getAgentColors(): string[] {
    return [
      '#E53E3E', // Bright Red
      '#38A169', // Forest Green  
      '#3182CE', // Royal Blue
      '#7c3aed', // Purple
      '#8A2BE2', // Blue Violet
      '#00CED1', // Dark Turquoise
      '#DC143C', // Crimson
      '#228B22', // Forest Green (different shade)
      '#4169E1', // Royal Blue (different shade)
      '#FF1493'  // Deep Pink
    ];
  }
}
