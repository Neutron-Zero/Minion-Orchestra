import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { AgentMonitorService } from '../services/agent-monitor.service';
import { environment } from '../../environments/environment';

interface Session {
  id: string;
  agent_name: string;
  status: string;
  working_directory: string;
  start_time: string;
  end_time: string | null;
  pid: number;
  metadata: Record<string, any> | null;
}

@Component({
  selector: 'app-history',
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HistoryComponent implements OnInit {
  sessions: Session[] = [];
  loading = false;
  searchTerm = '';
  statusFilter = '';
  sinceDate = '';
  untilDate = '';
  total = 0;
  offset = 0;
  limit = 50;
  hasMore = true;

  statusOptions = [
    { value: '', label: 'All' },
    { value: 'idle', label: 'Idle' },
    { value: 'working', label: 'Working' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'offline', label: 'Offline' }
  ];

  constructor(
    private http: HttpClient,
    private router: Router,
    private agentService: AgentMonitorService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadSessions();
  }

  loadSessions(append = false): void {
    if (this.loading) return;
    this.loading = true;
    this.cdr.markForCheck();

    const params: Record<string, string | number> = { limit: this.limit, offset: this.offset };
    if (this.searchTerm) params['search'] = this.searchTerm;
    if (this.statusFilter) params['status'] = this.statusFilter;
    if (this.sinceDate) params['since'] = this.sinceDate;
    if (this.untilDate) params['until'] = this.untilDate;

    this.http.get<any>(`${environment.serverUrl}/api/history`, { params }).subscribe({
      next: (data) => {
        if (data.success) {
          this.sessions = append
            ? [...this.sessions, ...(data.sessions || [])]
            : (data.sessions || []);
          this.total = data.total || 0;
          this.hasMore = this.sessions.length < this.total;
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

  onFilterChange(): void {
    this.offset = 0;
    this.loadSessions();
  }

  onSearch(): void {
    this.offset = 0;
    this.loadSessions();
  }

  onScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom && this.hasMore && !this.loading) {
      this.offset += this.limit;
      this.loadSessions(true);
    }
  }

  navigateToAgent(id: string): void {
    this.router.navigate(['/agent', id]);
  }

  isSubagent(session: Session): boolean {
    if (!session) return false;
    if (session.metadata && session.metadata['type'] === 'subagent') return true;
    if (session.id && session.id.includes('-sub-')) return true;
    return false;
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'working': return '#4caf50';
      case 'completed': return '#2196f3';
      case 'failed': return '#f44336';
      case 'idle': return '#6366f1';
      case 'offline': return '#6e7681';
      default: return '#6e7681';
    }
  }

  getFolderName(path: string): string {
    if (!path) return '-';
    const segments = path.replace(/\/+$/, '').split('/');
    return segments[segments.length - 1] || path;
  }

  formatTimestamp(ts: string): string {
    if (!ts) return '-';
    const date = new Date(ts);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  formatDuration(startTime: string, endTime: string | null): string {
    if (!startTime) return '-';
    const start = new Date(startTime);
    if (isNaN(start.getTime())) return '-';
    const end = endTime ? new Date(endTime) : new Date();
    if (isNaN(end.getTime())) return '-';
    const elapsed = end.getTime() - start.getTime();
    if (elapsed < 0) return '-';

    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  getAgentColor(id: string): string {
    return this.agentService.getAgentColor(id);
  }

  trackBySession(index: number, session: Session): string {
    return session.id;
  }
}
