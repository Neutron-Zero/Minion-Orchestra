import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { Agent, AgentMonitorService } from '../services/agent-monitor.service';

interface AgentNode {
  agent: Agent;
  children: AgentNode[];
  expanded: boolean;
}

@Component({
  selector: 'app-agent-tree',
  templateUrl: './agent-tree.component.html',
  styleUrls: ['./agent-tree.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AgentTreeComponent {
  @Input() set agents(value: Agent[]) {
    this._agents = value || [];
    this.buildTree();
  }
  @Output() remove = new EventEmitter<Agent>();
  @Output() focus = new EventEmitter<Agent>();

  tree: AgentNode[] = [];
  private _agents: Agent[] = [];

  constructor(private agentService: AgentMonitorService) {}

  private buildTree(): void {
    // Subagents have IDs like "{parentId}-sub-{timestamp}"
    const parentMap = new Map<string, AgentNode>();
    const orphans: AgentNode[] = [];

    // First pass: create nodes for all non-subagent agents
    for (const agent of this._agents) {
      if (agent.type !== 'subagent') {
        const node: AgentNode = { agent, children: [], expanded: true };
        parentMap.set(agent.id, node);
      }
    }

    // Second pass: attach subagents to parents
    for (const agent of this._agents) {
      if (agent.type === 'subagent') {
        const childNode: AgentNode = { agent, children: [], expanded: false };
        // Find parent by matching ID prefix: "{parentId}-sub-..."
        const parentId = this.extractParentId(agent.id);
        const parent = parentId ? parentMap.get(parentId) : null;
        if (parent) {
          parent.children.push(childNode);
        } else {
          orphans.push(childNode);
        }
      }
    }

    // Build final tree: parents first (sorted by last activity), then orphans
    this.tree = [
      ...Array.from(parentMap.values()).sort((a, b) => {
        const aTime = a.agent.lastActivity ? new Date(a.agent.lastActivity).getTime() : 0;
        const bTime = b.agent.lastActivity ? new Date(b.agent.lastActivity).getTime() : 0;
        return bTime - aTime;
      }),
      ...orphans
    ];
  }

  private extractParentId(subagentId: string): string | null {
    const subIdx = subagentId.lastIndexOf('-sub-');
    if (subIdx > 0) {
      return subagentId.substring(0, subIdx);
    }
    return null;
  }

  toggleNode(node: AgentNode): void {
    node.expanded = !node.expanded;
  }

  getAgentColor(agentId: string): string {
    return this.agentService.getAgentColor(agentId);
  }

  getFormattedAgentId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'working': return 'engineering';
      case 'completed': return 'check_circle';
      case 'failed': return 'error';
      case 'paused': return 'pause_circle';
      case 'idle': return 'schedule';
      case 'waiting':
      case 'awaiting-permission':
      case 'permission-requested': return 'lock_open';
      default: return 'pending';
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'working': return '#4caf50';
      case 'completed': return '#2196f3';
      case 'failed': return '#f44336';
      case 'idle': return '#6366f1';
      case 'waiting':
      case 'awaiting-permission':
      case 'permission-requested': return '#ffc107';
      default: return '#6e7681';
    }
  }

  getFolderName(agent: Agent): string {
    if (agent.workingDirectory) {
      const parts = agent.workingDirectory.split('/').filter(p => p);
      return parts[parts.length - 1] || '';
    }
    return '';
  }

  trackByNode(index: number, node: AgentNode): string {
    return node.agent.id;
  }
}
