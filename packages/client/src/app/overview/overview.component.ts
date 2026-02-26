import { Component, OnInit } from '@angular/core';
import { AgentMonitorService, Agent, TaskQueue } from '../services/agent-monitor.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss']
})
export class OverviewComponent implements OnInit {
  agents$: Observable<Agent[]>;
  taskQueue$: Observable<TaskQueue>;

  constructor(private agentService: AgentMonitorService) {
    this.agents$ = this.agentService.getAgents();
    this.taskQueue$ = this.agentService.getTaskQueue();
  }

  ngOnInit(): void {
  }

  getStatusColor(status: string): string {
    switch(status) {
      case 'working': return 'primary';
      case 'completed': return 'accent';
      case 'failed': return 'warn';
      case 'paused': return 'warn';
      default: return '';
    }
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

  pauseAgent(agent: Agent): void {
    this.agentService.pauseAgent(agent.id);
  }

  resumeAgent(agent: Agent): void {
    this.agentService.resumeAgent(agent.id);
  }

  removeAgent(agent: Agent): void {
    this.agentService.removeAgent(agent.id);
  }

  clearAllAgents(): void {
    this.agentService.clearAllAgents();
  }

  // Refresh removed - using real-time WebSocket updates instead

  getFormattedAgentId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }
}
