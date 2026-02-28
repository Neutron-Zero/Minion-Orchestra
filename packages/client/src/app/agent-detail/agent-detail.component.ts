import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { AgentMonitorService } from '../services/agent-monitor.service';
import { environment } from '../../environments/environment';

interface ParsedPart {
  text: string;
  isTool: boolean;
}

interface AgentLog {
  timestamp: string;
  level: string;
  message: string;
  _parsed: ParsedPart[];
}

@Component({
  selector: 'app-agent-detail',
  templateUrl: './agent-detail.component.html',
  styleUrls: ['./agent-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AgentDetailComponent implements OnInit, OnDestroy {
  agent: any = null;
  logs: AgentLog[] = [];
  events: any[] = [];
  loading = true;
  error = '';
  duration = '';

  private agentId = '';
  private durationTimer?: ReturnType<typeof setInterval>;
  private routeSub?: Subscription;
  private readonly toolRegex = /\b(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch|NotebookEdit)\b/g;

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private agentService: AgentMonitorService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.routeSub = this.route.params.subscribe(params => {
      this.agentId = params['id'];
      this.loadAgent();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
    }
  }

  loadAgent(): void {
    this.loading = true;
    this.error = '';

    this.http.get<any>(`${environment.serverUrl}/api/agents/${this.agentId}`).subscribe({
      next: (data) => {
        if (data.success) {
          this.agent = data.agent;
          this.logs = (data.logs || [])
            .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 100)
            .map((log: any) => ({ ...log, _parsed: this.parseToolsInMessage(log.message) }));
          this.events = data.events || [];
          this.updateDuration();
          this.startDurationTimer();
        } else {
          this.error = 'Failed to load agent details.';
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Could not connect to server.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private startDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
    }
    this.durationTimer = setInterval(() => {
      this.updateDuration();
      this.cdr.markForCheck();
    }, 1000);
  }

  private updateDuration(): void {
    if (!this.agent?.startTime) {
      this.duration = '';
      return;
    }
    const diff = Date.now() - new Date(this.agent.startTime).getTime();
    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');

    this.duration = hours > 0
      ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s`
      : `${minutes}m ${pad(seconds)}s`;
  }

  formatTimestamp(timestamp: string | Date): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-GB', { hour12: false }) +
      '.' + date.getMilliseconds().toString().padStart(3, '0');
  }

  formatStartTime(timestamp: string | Date): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    }) + ' ' + date.toLocaleTimeString('en-GB', { hour12: false });
  }

  getFolderName(workingDirectory: string): string {
    if (!workingDirectory) return '';
    const parts = workingDirectory.split('/').filter(p => p);
    return parts[parts.length - 1] || '';
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'working': return '#4caf50';
      case 'completed': return '#2196f3';
      case 'failed': return '#f44336';
      case 'paused': return '#a78bfa';
      case 'idle': return '#6366f1';
      case 'awaiting-permission': return '#ffc107';
      case 'permission-requested': return '#ffc107';
      default: return '#6e7681';
    }
  }

  getLevelIcon(level: string): string {
    switch (level) {
      case 'info': return 'info';
      case 'warning': return 'warning';
      case 'error': return 'error';
      case 'debug': return 'bug_report';
      default: return 'notes';
    }
  }

  getLevelIconColor(level: string): string {
    switch (level) {
      case 'info': return 'rgba(255,255,255,0.5)';
      case 'warning': return '#ffc107';
      case 'error': return '#f44336';
      default: return 'rgba(255,255,255,0.3)';
    }
  }

  getAgentColor(agentId: string): string {
    if (!agentId) return '#7c3aed';
    return this.agentService.getAgentColor(agentId);
  }

  getFormattedAgentId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }

  trackByLog(index: number, log: AgentLog): number {
    return index;
  }

  trackByPart(index: number, part: ParsedPart): number {
    return index;
  }

  private parseToolsInMessage(message: string): ParsedPart[] {
    if (!message) return [{ text: '', isTool: false }];

    const parts: ParsedPart[] = [];
    let lastIndex = 0;
    const regex = /\b(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch|NotebookEdit)\b/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ text: message.substring(lastIndex, match.index), isTool: false });
      }
      parts.push({ text: match[0], isTool: true });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < message.length) {
      parts.push({ text: message.substring(lastIndex), isTool: false });
    }

    return parts.length === 0 ? [{ text: message, isTool: false }] : parts;
  }
}
