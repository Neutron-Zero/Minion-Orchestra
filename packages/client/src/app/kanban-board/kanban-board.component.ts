import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { Agent, AgentMonitorService } from '../services/agent-monitor.service';

interface AgentNode {
  agent: Agent;
  children: Agent[];
}

interface KanbanColumn {
  key: string;
  label: string;
  color: string;
  agentNodes: AgentNode[];
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
  @Output() viewDetails = new EventEmitter<Agent>();

  columns: KanbanColumn[] = [];
  private _agents: Agent[] = [];

  private static readonly COLUMN_DEFS: { key: string; label: string; color: string; statuses: string[] }[] = [
    { key: 'idle', label: 'Idle', color: '#6366f1', statuses: ['idle'] },
    { key: 'working', label: 'Working', color: '#4caf50', statuses: ['working'] },
    { key: 'waiting', label: 'Waiting for Input', color: '#ffc107', statuses: ['waiting', 'awaiting-permission', 'permission-requested'] },
    { key: 'failed', label: 'Failed', color: '#f44336', statuses: ['failed'] },
    { key: 'completed', label: 'Completed', color: '#6e7681', statuses: ['completed', 'offline', 'paused'] },
  ];

  constructor(private agentService: AgentMonitorService) {}

  private buildColumns(): void {
    // Build a set of known agent PIDs for parent lookup
    const pidToAgent = new Map<number, Agent>();
    for (const a of this._agents) {
      if (a.pid) pidToAgent.set(a.pid, a);
    }

    // Separate children (agents whose parentPid matches a known agent's pid).
    // Only attach children that are still active; completed/offline children
    // become top-level so they appear in their own kanban column.
    const DETACHED_STATUSES = new Set(['completed', 'offline', 'paused']);
    const childrenByParentId = new Map<string, Agent[]>();
    const topLevel: Agent[] = [];

    for (const a of this._agents) {
      const parent = a.parentPid ? pidToAgent.get(a.parentPid) : undefined;
      if (parent && parent.id !== a.id && !DETACHED_STATUSES.has(a.status)) {
        const list = childrenByParentId.get(parent.id) || [];
        list.push(a);
        childrenByParentId.set(parent.id, list);
      } else {
        topLevel.push(a);
      }
    }

    this.columns = KanbanBoardComponent.COLUMN_DEFS.map(def => {
      let filtered = topLevel
        .filter(a => def.statuses.includes(a.status))
        .sort((a, b) => {
          const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : (a.startTime ? new Date(a.startTime).getTime() : 0);
          const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : (b.startTime ? new Date(b.startTime).getTime() : 0);
          return bTime - aTime;
        });

      // Cap the completed column to the 100 most recent
      if (def.key === 'completed') {
        filtered = filtered.slice(0, 100);
      }

      const agentNodes: AgentNode[] = filtered.map(a => ({
        agent: a,
        children: (childrenByParentId.get(a.id) || []).sort((x, y) => {
          const xTime = x.lastActivity ? new Date(x.lastActivity).getTime() : 0;
          const yTime = y.lastActivity ? new Date(y.lastActivity).getTime() : 0;
          return yTime - xTime;
        })
      }));

      return { key: def.key, label: def.label, color: def.color, agentNodes };
    });
  }

  getAgentCount(col: KanbanColumn): number {
    return col.agentNodes.reduce((sum, n) => sum + 1 + n.children.length, 0);
  }

  getAgentColor(agentId: string): string {
    return this.agentService.getAgentColor(agentId);
  }

  getFormattedAgentId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }

  getFormattedSubagentId(id: string): string {
    if (!id) return 'subagent';
    const digits = id.replace(/\D/g, '');
    const suffix = digits.slice(-5).padStart(5, '0');
    return `subagent-${suffix}`;
  }

  getFolderName(agent: Agent): string {
    if (agent.workingDirectory) {
      const parts = agent.workingDirectory.split('/').filter(p => p);
      return parts[parts.length - 1] || '';
    }
    return '';
  }

  getActiveTime(agent: Agent): string {
    const totalSeconds = Math.floor(agent.activeDuration || 0);
    if (totalSeconds <= 0) return '0m 00s';
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

  trackByNode(index: number, node: AgentNode): string {
    return node.agent.id;
  }

  trackByTool(index: number, tool: string): string {
    return tool;
  }

}
