import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { Agent, AgentMonitorService } from '../services/agent-monitor.service';

interface KanbanColumn {
  key: string;
  label: string;
  color: string;
  agents: Agent[];
}

@Component({
  selector: 'app-kanban-board',
  templateUrl: './kanban-board.component.html',
  styleUrls: ['./kanban-board.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KanbanBoardComponent {
  @Input() set agents(value: Agent[]) {
    this._agents = value || [];
    this.buildColumns();
  }
  @Output() pause = new EventEmitter<Agent>();
  @Output() resume = new EventEmitter<Agent>();
  @Output() remove = new EventEmitter<Agent>();
  @Output() focus = new EventEmitter<Agent>();

  columns: KanbanColumn[] = [];
  private _agents: Agent[] = [];

  private static readonly COLUMN_DEFS: { key: string; label: string; color: string; statuses: string[] }[] = [
    { key: 'failed', label: 'Failed', color: '#f44336', statuses: ['failed'] },
    { key: 'waiting', label: 'Waiting', color: '#ffc107', statuses: ['waiting', 'awaiting-permission', 'permission-requested'] },
    { key: 'working', label: 'Working', color: '#4caf50', statuses: ['working'] },
    { key: 'idle', label: 'Idle', color: '#6366f1', statuses: ['idle'] },
    { key: 'completed', label: 'Completed', color: '#2196f3', statuses: ['completed'] },
    { key: 'offline', label: 'Offline', color: '#6e7681', statuses: ['offline', 'paused'] },
  ];

  constructor(private agentService: AgentMonitorService) {}

  private buildColumns(): void {
    this.columns = KanbanBoardComponent.COLUMN_DEFS.map(def => ({
      key: def.key,
      label: def.label,
      color: def.color,
      agents: this._agents
        .filter(a => def.statuses.includes(a.status))
        .sort((a, b) => {
          // Sort by last activity, most recent first
          const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
          const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
          return bTime - aTime;
        })
    }));
  }

  getAgentColor(agentId: string): string {
    return this.agentService.getAgentColor(agentId);
  }

  getFormattedAgentId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }

  getFolderName(agent: Agent): string {
    if (agent.workingDirectory) {
      const parts = agent.workingDirectory.split('/').filter(p => p);
      return parts[parts.length - 1] || '';
    }
    return '';
  }

  getElapsedTime(startTime?: Date | string): string {
    if (!startTime) return '';
    const start = new Date(startTime);
    if (isNaN(start.getTime())) return '';
    const diff = Date.now() - start.getTime();
    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hours > 0) return `${hours}h ${pad(minutes)}m`;
    return `${minutes}m ${pad(seconds)}s`;
  }

  getCountTextColor(bgColor: string): string {
    // Yellow/light backgrounds need dark text
    if (bgColor === '#ffc107' || bgColor === '#ffeb3b') return '#1a1a1a';
    return '#fff';
  }

  trackByColumn(index: number, col: KanbanColumn): string {
    return col.key;
  }

  trackByAgent(index: number, agent: Agent): string {
    return agent.id;
  }

  trackByTool(index: number, tool: string): string {
    return tool;
  }
}
