import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { AgentMonitorService, Agent, TimelineEvent } from '../services/agent-monitor.service';
import { environment } from '../../environments/environment';
import { DisplayEvent, EventStreamListComponent } from '../event-stream-list/event-stream-list.component';

const EVENT_TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  'SessionStart':       { icon: 'play_circle',   color: '#4caf50' },
  'SessionEnd':         { icon: 'stop_circle',   color: '#6e7681' },
  'UserPromptSubmit':   { icon: 'chat',           color: '#2196f3' },
  'PreToolUse':         { icon: 'build',          color: '#7c3aed' },
  'PostToolUse':        { icon: 'check_circle',   color: '#38A169' },
  'PostToolUseFailure': { icon: 'error',          color: '#f44336' },
  'Stop':               { icon: 'flag',            color: '#ffc107' },
  'PermissionRequest':  { icon: 'lock',            color: '#E53E3E' },
  'SubagentStart':      { icon: 'group_add',      color: '#00CED1' },
  'SubagentStop':       { icon: 'group_remove',   color: '#6e7681' },
  'Notification':       { icon: 'notifications',  color: '#ffc107' },
  'PreCompact':         { icon: 'compress',        color: '#6e7681' },
  'TeammateIdle':       { icon: 'person_off',     color: '#6e7681' },
  'TaskCompleted':      { icon: 'task_alt',        color: '#4caf50' },
  'ConfigChange':       { icon: 'settings',        color: '#a78bfa' },
  'WorktreeCreate':     { icon: 'account_tree',   color: '#00CED1' },
  'WorktreeRemove':     { icon: 'delete_sweep',   color: '#6e7681' },
};

@Component({
  selector: 'app-logs',
  templateUrl: './logs.component.html',
  styleUrls: ['./logs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LogsComponent implements OnInit, OnDestroy {
  @ViewChild(EventStreamListComponent) private eventStreamList?: EventStreamListComponent;

  displayEvents: DisplayEvent[] = [];
  searchTerm = '';
  agentFilter = '';
  eventTypeFilter = '';
  isConnected = false;
  stickyScroll = true;
  newEventsCount = 0;
  loading = false;

  agents: Agent[] = [];
  eventTypes: string[] = [];
  expandedSet = new Set<string>();

  private allEvents: TimelineEvent[] = [];
  private realtimeEvents: TimelineEvent[] = [];
  private eventSub?: Subscription;
  private agentSub?: Subscription;
  private connSub?: Subscription;
  private readonly MAX_DISPLAY = 500;

  constructor(
    private http: HttpClient,
    private agentService: AgentMonitorService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadInitialEvents();

    this.eventSub = this.agentService.getEvents().subscribe(events => {
      const prevCount = this.realtimeEvents.length;
      this.realtimeEvents = events;
      this.mergeAndApply();
      this.cdr.markForCheck();
      if (this.stickyScroll) {
        setTimeout(() => this.scrollToBottom(), 20);
      } else if (events.length > prevCount) {
        this.newEventsCount += events.length - prevCount;
        this.cdr.markForCheck();
      }
    });

    this.agentSub = this.agentService.getAgents().subscribe(agents => {
      this.agents = agents;
      this.cdr.markForCheck();
    });

    this.connSub = this.agentService.isConnected().subscribe(c => {
      this.isConnected = c;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.eventSub?.unsubscribe();
    this.agentSub?.unsubscribe();
    this.connSub?.unsubscribe();
  }

  private loadInitialEvents(): void {
    this.loading = true;
    this.http.get<any>(`${environment.serverUrl}/api/events`, {
      params: { limit: '200' }
    }).subscribe({
      next: (res) => {
        if (res.success) {
          // API returns newest-first, reverse for chronological
          this.allEvents = (res.events || []).reverse();
          this.extractEventTypes();
          this.mergeAndApply();
        }
        this.loading = false;
        this.cdr.markForCheck();
        if (this.stickyScroll) {
          setTimeout(() => this.scrollToBottom(), 50);
        }
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private mergeAndApply(): void {
    // Merge initial + realtime, dedup by timestamp+agent+type
    const seen = new Set<string>();
    const merged: TimelineEvent[] = [];
    for (const e of [...this.allEvents, ...this.realtimeEvents]) {
      const key = `${e.timestamp}|${e.agent_id}|${e.event_type}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(e);
      }
    }
    // Sort chronological
    merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    this.applyFilters(merged);
  }

  private applyFilters(events: TimelineEvent[]): void {
    let filtered = events;

    if (this.agentFilter) {
      filtered = filtered.filter(e => e.agent_id === this.agentFilter);
    }
    if (this.eventTypeFilter) {
      filtered = filtered.filter(e => e.event_type === this.eventTypeFilter);
    }
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(e =>
        (e.message || '').toLowerCase().includes(term) ||
        e.event_type.toLowerCase().includes(term) ||
        (e.agent_id || '').toLowerCase().includes(term) ||
        JSON.stringify(e.metadata || {}).toLowerCase().includes(term)
      );
    }

    this.displayEvents = filtered.slice(-this.MAX_DISPLAY).map(e => this.enrichEvent(e));
  }

  private extractEventTypes(): void {
    const types = new Set<string>();
    for (const e of this.allEvents) {
      types.add(e.event_type);
    }
    this.eventTypes = Array.from(types).sort();
  }

  private enrichEvent(event: TimelineEvent): DisplayEvent {
    const date = new Date(event.timestamp);
    const config = EVENT_TYPE_CONFIG[event.event_type] || { icon: 'circle', color: '#6e7681' };

    // Get agent display name from working directory
    const agents = this.agentService.getAgentsSnapshot();
    const agent = agents.find(a => a.id === event.agent_id);
    let agentName = event.agent_name || '';
    if (agent?.workingDirectory) {
      const parts = agent.workingDirectory.split('/').filter((p: string) => p);
      agentName = parts[parts.length - 1] || agentName;
    }

    // Extract tool info from metadata
    const meta = event.metadata || {};
    const toolName = meta.tool_name || meta.tool || null;
    let toolDetail: string | null = null;
    if (toolName && meta.tool_input) {
      const input = meta.tool_input;
      toolDetail = input.file_path || input.command || input.pattern || input.url || input.file || null;
      if (toolDetail && toolDetail.length > 80) {
        toolDetail = toolDetail.substring(0, 80) + '...';
      }
    }

    // Build summary
    let summary = event.message || '';
    if (!summary && toolName) {
      summary = toolName;
      if (toolDetail) summary += ' ' + toolDetail;
    }
    if (!summary) {
      summary = event.event_type;
    }
    if (summary.length > 120) {
      summary = summary.substring(0, 120) + '...';
    }

    const eventKey = `${event.timestamp}|${event.agent_id}|${event.event_type}`;

    return {
      ...event,
      _formattedTime: date.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      _agentName: agentName,
      _agentColor: this.agentService.getAgentColor(event.agent_id) || '#7c3aed',
      _eventIcon: config.icon,
      _eventColor: config.color,
      _toolName: toolName,
      _toolDetail: toolDetail,
      _summary: summary,
      _isExpanded: this.expandedSet.has(eventKey),
      _metadataJson: JSON.stringify(event.metadata || {}, null, 2),
    };
  }

  onFilterChange(): void {
    this.mergeAndApply();
    this.cdr.markForCheck();
  }

  onSearch(): void {
    this.mergeAndApply();
    this.cdr.markForCheck();
  }

  toggleExpand(event: DisplayEvent): void {
    const key = `${event.timestamp}|${event.agent_id}|${event.event_type}`;
    if (this.expandedSet.has(key)) {
      this.expandedSet.delete(key);
      event._isExpanded = false;
    } else {
      this.expandedSet.add(key);
      event._isExpanded = true;
    }
    this.cdr.markForCheck();
  }

  copyJson(event: DisplayEvent, e: MouseEvent): void {
    e.stopPropagation();
    navigator.clipboard.writeText(event._metadataJson);
  }

  clearEvents(): void {
    this.allEvents = [];
    this.realtimeEvents = [];
    this.agentService.clearEvents();
    this.displayEvents = [];
    this.expandedSet.clear();
    this.cdr.markForCheck();
  }

  jumpToLatest(): void {
    this.newEventsCount = 0;
    this.stickyScroll = true;
    this.scrollToBottom();
    this.cdr.markForCheck();
  }

  private scrollToBottom(): void {
    if (!this.eventStreamList?.scrollContainer) return;
    const el = this.eventStreamList.scrollContainer.nativeElement;
    el.scrollTop = el.scrollHeight;
  }
}
