import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AgentMonitorService } from '../services/agent-monitor.service';
import { environment } from '../../environments/environment';

interface Prompt {
  timestamp: string;
  message: string;
  agent_id: string;
  session_id: string;
  event_type: string;
  _truncated: string;
  _badgeColor: string;
}

@Component({
  selector: 'app-prompt-history',
  templateUrl: './prompt-history.component.html',
  styleUrls: ['./prompt-history.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PromptHistoryComponent implements OnInit {
  prompts: Prompt[] = [];
  filteredPrompts: Prompt[] = [];
  searchTerm = '';
  loading = false;

  constructor(
    private http: HttpClient,
    private agentService: AgentMonitorService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadPrompts();
  }

  loadPrompts(): void {
    this.loading = true;
    this.cdr.markForCheck();

    const params: Record<string, string | number> = { limit: 200 };
    if (this.searchTerm) params['search'] = this.searchTerm;

    this.http.get<any>(`${environment.serverUrl}/api/prompts`, { params }).subscribe({
      next: (data) => {
        if (data.success) {
          this.prompts = (data.prompts || []).map((p: any) => ({
            ...p,
            _truncated: this.truncateMessage(p.message),
            _badgeColor: this.computeBadgeColor(p.agent_id)
          }));
          this.filteredPrompts = this.prompts;
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onSearch(): void {
    this.loadPrompts();
  }

  formatTimestamp(ts: string): string {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getAgentShortId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }

  getAgentColor(id: string): string {
    return this.agentService.getAgentColor(id);
  }

  trackByPrompt(index: number, prompt: Prompt): string {
    return prompt.timestamp + prompt.agent_id;
  }

  private truncateMessage(msg: string, max: number = 200): string {
    if (!msg || msg.length <= max) return msg || '';
    return msg.substring(0, max) + '...';
  }

  private computeBadgeColor(id: string): string {
    const color = this.agentService.getAgentColor(id);
    if (!color || color.length < 7) return 'rgba(124, 58, 237, 0.15)';
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 0.15)`;
  }
}
