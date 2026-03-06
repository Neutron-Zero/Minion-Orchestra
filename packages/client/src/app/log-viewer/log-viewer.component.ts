import { Component, OnInit, OnDestroy, Input, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { AgentMonitorService, LogEntry } from '../services/agent-monitor.service';

interface ParsedToolMessage {
  before: string;
  tool: string;
  after: string;
}

interface DisplayLog extends LogEntry {
  _formattedTime: string;
  _formattedAgent: string;
  _agentName: string;
  _agentColor: string;
  _toolParsed: ParsedToolMessage | null;
}

@Component({
  selector: 'app-log-viewer',
  templateUrl: './log-viewer.component.html',
  styleUrls: ['./log-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LogViewerComponent implements OnInit, OnDestroy {
  @Input() agentId?: string;
  @Input() maxHeight: string = '400px';
  @ViewChild('scrollContainer') private scrollContainer?: ElementRef;

  filteredLogs: DisplayLog[] = [];
  searchTerm = '';
  levelFilter = 'all';
  isConnected = false;

  private allLogs: LogEntry[] = [];
  private sub?: Subscription;
  private connSub?: Subscription;
  private readonly MAX_DISPLAY = 500;
  private readonly toolPattern = /\b(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch|NotebookEdit)\b/;

  constructor(private agentService: AgentMonitorService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.connSub = this.agentService.isConnected().subscribe(connected => {
      this.isConnected = connected;
      this.cdr.markForCheck();
    });

    const logs$ = this.agentId
      ? this.agentService.getAgentLogs(this.agentId)
      : this.agentService.getLogs();

    this.sub = logs$.subscribe(logs => {
      this.allLogs = logs;
      this.applyFilters();
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.connSub?.unsubscribe();
  }

  getLogClass(level: string): string {
    return `log-${level}`;
  }

  getLogIcon(level: string): string {
    switch (level) {
      case 'error': return 'error';
      case 'warning': return 'warning';
      case 'info': return 'info';
      case 'debug': return 'bug_report';
      default: return 'notes';
    }
  }

  clearLogs(): void {
    this.agentService.clearLogs();
  }

  applyFilters(): void {
    let filtered = this.allLogs;

    if (this.levelFilter !== 'all') {
      filtered = filtered.filter(log => log.level === this.levelFilter);
    }

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(term) ||
        log.agentId.toLowerCase().includes(term)
      );
    }

    this.filteredLogs = filtered.slice(-this.MAX_DISPLAY).reverse().map(log => this.enrichLog(log));
  }

  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.applyFilters();
    this.cdr.markForCheck();
  }

  onLevelFilterChange(level: string): void {
    this.levelFilter = level;
    this.applyFilters();
    this.cdr.markForCheck();
  }

  exportLogs(format: 'json' | 'csv'): void {
    const data = format === 'json'
      ? JSON.stringify(this.filteredLogs, null, 2)
      : this.convertToCSV(this.filteredLogs);

    const blob = new Blob([data], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `logs_${new Date().getTime()}.${format}`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  trackByLog(index: number, log: DisplayLog): string {
    return log._formattedTime + log.agentId + log.message;
  }

  private enrichLog(log: LogEntry): DisplayLog {
    const date = new Date(log.timestamp);
    const agents = this.agentService.getAgentsSnapshot();
    const agent = agents.find(a => a.id === log.agentId);
    let agentName = '';
    if (agent?.workingDirectory) {
      const parts = agent.workingDirectory.split('/').filter((p: string) => p);
      agentName = parts[parts.length - 1] || '';
    } else if (agent?.name) {
      agentName = agent.name;
    }

    return {
      ...log,
      _formattedTime: date.toLocaleTimeString('en-GB', { hour12: false }),
      _formattedAgent: this.agentService.getFormattedAgentId(log.agentId).toUpperCase(),
      _agentName: agentName,
      _agentColor: this.agentService.getAgentColor(log.agentId) || '#E53E3E',
      _toolParsed: this.parseToolMessage(log.message)
    };
  }

  private parseToolMessage(message: string): ParsedToolMessage | null {
    if (!message) return null;
    const match = message.match(this.toolPattern);
    if (!match) return null;
    return {
      before: message.substring(0, match.index!),
      tool: match[0],
      after: message.substring(match.index! + match[0].length)
    };
  }

  private convertToCSV(logs: DisplayLog[]): string {
    const headers = 'Timestamp,Level,Agent ID,Message\n';
    const rows = logs.map(log =>
      `"${log.timestamp}","${log.level}","${log._formattedAgent}","${log.message.replace(/"/g, '""')}"`
    ).join('\n');
    return headers + rows;
  }
}
