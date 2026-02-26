import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AgentMonitorService, Agent, TaskQueue } from '../services/agent-monitor.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-agent-dashboard',
  templateUrl: './agent-dashboard.component.html',
  styleUrls: ['./agent-dashboard.component.scss']
})
export class AgentDashboardComponent implements OnInit {
  agents$: Observable<Agent[]>;
  taskQueue$: Observable<TaskQueue>;
  selectedAgentId?: string;
  showLogs = false;
  currentRoute = 'overview';

  constructor(
    private agentService: AgentMonitorService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.agents$ = this.agentService.getAgents();
    this.taskQueue$ = this.agentService.getTaskQueue();
  }

  ngOnInit(): void {
    // Subscribe to route changes
    this.route.url.subscribe(segments => {
      this.currentRoute = segments.length > 0 ? segments[0].path : 'overview';
    });
  }

  navigate(route: string): void {
    this.router.navigate([route]);
  }

  isActive(route: string): boolean {
    return this.currentRoute === route;
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

  getElapsedTime(startTime?: Date): string {
    if (!startTime) return '-';
    const elapsed = Date.now() - startTime.getTime();
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

  viewAgentLogs(agentId: string): void {
    this.selectedAgentId = agentId;
    this.showLogs = true;
  }

  getProgressColor(progress: number | undefined): string {
    if (!progress) return 'primary';
    if (progress === 100) return 'accent';
    if (progress > 75) return 'primary';
    return 'primary';
  }

  openSettings(): void {
    // TODO: Open settings dialog/modal
    console.log('Settings clicked');
  }

  getTotalTokens(): number {
    // Calculate total tokens across all agents
    return 0; // Placeholder
  }

  getTotalToolCalls(): number {
    // Calculate total tool calls across all agents
    return 0; // Placeholder
  }
}