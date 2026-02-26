import { Component, OnInit, Input, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { Observable } from 'rxjs';
import { AgentMonitorService, LogEntry } from '../services/agent-monitor.service';

@Component({
  selector: 'app-log-viewer',
  templateUrl: './log-viewer.component.html',
  styleUrls: ['./log-viewer.component.scss']
})
export class LogViewerComponent implements OnInit, AfterViewChecked {
  @Input() agentId?: string;
  @Input() maxHeight: string = '400px';
  @ViewChild('scrollContainer') private scrollContainer?: ElementRef;
  
  logs$: Observable<LogEntry[]>;
  filteredLogs: LogEntry[] = [];
  autoScroll = true;
  searchTerm = '';
  levelFilter = 'all';
  showExportOptions = false;

  constructor(private agentService: AgentMonitorService) {
    this.logs$ = this.agentService.getLogs();
  }

  ngOnInit(): void {
    if (this.agentId) {
      this.logs$ = this.agentService.getAgentLogs(this.agentId);
    }
    
    // Subscribe to logs and apply filters
    this.logs$.subscribe(logs => {
      this.applyFilters(logs);
    });
  }

  ngAfterViewChecked() {
    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  scrollToBottom(): void {
    if (this.scrollContainer) {
      const element = this.scrollContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  getLogClass(level: string): string {
    return `log-${level}`;
  }

  getLogIcon(level: string): string {
    switch(level) {
      case 'error': return 'error';
      case 'warning': return 'warning';
      case 'info': return 'info';
      case 'debug': return 'bug_report';
      default: return 'notes';
    }
  }

  formatTimestamp(date: Date): string {
    return new Date(date).toLocaleTimeString();
  }

  toggleAutoScroll(): void {
    this.autoScroll = !this.autoScroll;
  }

  clearLogs(): void {
    this.agentService.clearLogs();
  }
  
  applyFilters(logs: LogEntry[]): void {
    let filtered = [...logs];
    
    // Apply level filter
    if (this.levelFilter !== 'all') {
      filtered = filtered.filter(log => log.level === this.levelFilter);
    }
    
    // Apply search filter
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(term) ||
        log.agentId.toLowerCase().includes(term)
      );
    }
    
    this.filteredLogs = filtered;
  }
  
  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.logs$.subscribe(logs => this.applyFilters(logs));
  }
  
  onLevelFilterChange(level: string): void {
    this.levelFilter = level;
    this.logs$.subscribe(logs => this.applyFilters(logs));
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
  
  private convertToCSV(logs: LogEntry[]): string {
    const headers = 'Timestamp,Level,Agent ID,Message\n';
    const rows = logs.map(log => 
      `"${log.timestamp}","${log.level}","${this.getFormattedAgentId(log.agentId)}","${log.message.replace(/"/g, '""')}"`
    ).join('\n');
    return headers + rows;
  }

  getFormattedAgentId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }

  getAgentColor(agentId: string): string {
    if (!agentId) return '#E53E3E'; // Default color
    return this.agentService.getAgentColor(agentId);
  }

  getLogBackgroundColor(agentId: string): string {
    if (!agentId) return 'rgba(229, 62, 62, 0.08)'; // Default background
    const color = this.agentService.getAgentColor(agentId);
    // Convert hex to rgba with 8% opacity for more visible log highlighting
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 0.08)`;
  }
}