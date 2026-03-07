import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AgentMonitorService, Agent, TranscriptEntry } from '../services/agent-monitor.service';
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
  @ViewChild('transcriptScroll') private transcriptScroll?: ElementRef;

  agent: any = null;
  logs: AgentLog[] = [];
  events: any[] = [];
  loading = true;
  error = '';
  duration = '';
  activeTab: 'log' | 'transcript' = (localStorage.getItem('mo_agent_detail_tab') as 'log' | 'transcript') || 'log';

  setTab(tab: 'log' | 'transcript'): void {
    this.activeTab = tab;
    localStorage.setItem('mo_agent_detail_tab', tab);
    if (tab === 'transcript') {
      setTimeout(() => this.scrollTranscriptToBottom(), 50);
    }
  }

  // Transcript
  transcriptEntries: TranscriptEntry[] = [];
  filteredTranscript: TranscriptEntry[] = [];
  transcriptSearchTerm = '';
  private stickyScroll = true;

  hitlInput = '';
  subagents: Agent[] = [];

  private agentId = '';
  private durationTimer?: ReturnType<typeof setInterval>;
  private routeSub?: Subscription;
  private logSub?: Subscription;
  private transcriptSub?: Subscription;
  private agentSub?: Subscription;
  private subagentSub?: Subscription;
  private readonly toolRegex = /\b(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch|NotebookEdit)\b/g;

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router,
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
    this.logSub?.unsubscribe();
    this.transcriptSub?.unsubscribe();
    this.agentSub?.unsubscribe();
    this.subagentSub?.unsubscribe();
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
          this.subscribeToLogs();
          this.subscribeToAgentUpdates();
          this.subscribeToSubagents();
          this.loadTranscript();
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

  private subscribeToAgentUpdates(): void {
    this.agentSub?.unsubscribe();
    this.agentSub = this.agentService.getAgentById(this.agentId).subscribe(agent => {
      if (agent) {
        this.agent = { ...this.agent, ...agent };
        this.cdr.markForCheck();
      }
    });
  }

  private subscribeToSubagents(): void {
    this.subagentSub?.unsubscribe();
    this.subagentSub = this.agentService.getAgents().subscribe(agents => {
      if (!this.agent?.pid) {
        this.subagents = [];
        return;
      }
      this.subagents = agents.filter(a => a.parentPid === this.agent.pid && a.id !== this.agentId);
      this.cdr.markForCheck();
    });
  }

  navigateToSubagent(id: string): void {
    this.router.navigate(['/agent', id]);
  }

  private subscribeToLogs(): void {
    this.logSub?.unsubscribe();
    const knownKeys = new Set(this.logs.map(l => `${l.timestamp}|${l.message}`));
    this.logSub = this.agentService.getAgentLogs(this.agentId).subscribe(logs => {
      let added = false;
      for (const log of logs) {
        const key = `${new Date(log.timestamp).toISOString()}|${log.message}`;
        if (!knownKeys.has(key)) {
          knownKeys.add(key);
          this.logs.unshift({
            timestamp: new Date(log.timestamp).toISOString(),
            level: log.level,
            message: log.message,
            _parsed: this.parseToolsInMessage(log.message),
          });
          added = true;
        }
      }
      if (added) {
        this.logs = this.logs.slice(0, 100);
        this.cdr.markForCheck();
      }
    });
  }

  // --- Transcript ---

  private loadTranscript(): void {
    this.http.get<any>(`${environment.serverUrl}/api/agents/${this.agentId}/transcript`, {
      params: { limit: '1000' }
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.transcriptEntries = res.entries || [];
          this.applyTranscriptFilter();
          this.subscribeToTranscript();
          this.cdr.markForCheck();
          if (this.stickyScroll && this.activeTab === 'transcript') {
            setTimeout(() => this.scrollTranscriptToBottom(), 50);
          }
        }
      }
    });
  }

  private subscribeToTranscript(): void {
    this.transcriptSub?.unsubscribe();
    const knownKeys = new Set(this.transcriptEntries.map(e => `${e.line_number}|${e.entry_type}`));

    this.transcriptSub = this.agentService.getTranscriptEntries(this.agentId).subscribe(entries => {
      let added = false;
      for (const entry of entries) {
        const key = `${entry.line_number}|${entry.entry_type}`;
        if (!knownKeys.has(key)) {
          knownKeys.add(key);
          this.transcriptEntries.push(entry);
          added = true;
        }
      }
      if (added) {
        this.transcriptEntries.sort((a, b) => a.line_number - b.line_number);
        this.applyTranscriptFilter();
        this.cdr.markForCheck();
        if (this.stickyScroll && this.activeTab === 'transcript') {
          setTimeout(() => this.scrollTranscriptToBottom(), 20);
        }
      }
    });
  }

  applyTranscriptFilter(): void {
    if (!this.transcriptSearchTerm) {
      this.filteredTranscript = this.transcriptEntries;
      return;
    }
    const term = this.transcriptSearchTerm.toLowerCase();
    this.filteredTranscript = this.transcriptEntries.filter(e =>
      (e.content || '').toLowerCase().includes(term) ||
      (e.tool_name || '').toLowerCase().includes(term)
    );
  }

  private scrollTranscriptToBottom(): void {
    if (!this.transcriptScroll) return;
    const el = this.transcriptScroll.nativeElement;
    el.scrollTop = el.scrollHeight;
  }

  isThinking(entry: TranscriptEntry): boolean {
    if (!entry.metadata) return false;
    const meta = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : entry.metadata;
    return meta?.is_thinking === true;
  }

  getToolSummary(entry: TranscriptEntry): string {
    if (!entry.tool_input) return '';
    try {
      const input = JSON.parse(entry.tool_input);
      return input.description || input.command || input.file_path || input.pattern || input.url || '';
    } catch {
      return '';
    }
  }

  formatJson(raw: string | null): string {
    if (!raw) return '';
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  truncate(text: string | null, max: number): string {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
  }

  trackByTranscript(index: number, entry: TranscriptEntry): string {
    return `${entry.line_number}|${entry.entry_type}`;
  }

  // --- Duration ---

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

  // --- Formatting ---

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

  approveAgent(): void {
    this.agentService.sendAgentAction(this.agentId, 'approve');
  }

  denyAgent(): void {
    this.agentService.sendAgentAction(this.agentId, 'deny');
  }


  sendHitlInput(): void {
    const text = this.hitlInput.trim();
    if (!text) return;
    this.agentService.sendAgentInput(this.agentId, text);
    this.hitlInput = '';
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
