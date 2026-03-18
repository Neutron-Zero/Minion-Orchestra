import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, skip } from 'rxjs';
import { AgentMonitorService, Agent, TranscriptEntry, TimelineEvent } from '../services/agent-monitor.service';
import { environment } from '../../environments/environment';
import { DisplayEvent, EventStreamListComponent } from '../event-stream-list/event-stream-list.component';

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
  @ViewChild(EventStreamListComponent) private eventStreamList?: EventStreamListComponent;

  agent: any = null;
  logs: AgentLog[] = [];
  events: any[] = [];
  loading = true;
  error = '';
  duration = '';
  activeTab: 'transcript' = 'transcript';
  detailView: 'transcript' | 'events' = (localStorage.getItem('mo_detail_view') as 'transcript' | 'events') || 'transcript';

  // Event stream
  agentDisplayEvents: DisplayEvent[] = [];
  eventSearchTerm = '';
  private allAgentEvents: TimelineEvent[] = [];
  private eventSub?: Subscription;

  // Transcript — windowed infinite scroll
  transcriptEntries: TranscriptEntry[] = [];
  filteredTranscript: TranscriptEntry[] = [];
  transcriptSearchTerm = '';
  transcriptTotal = 0;
  newEntriesCount = 0;
  private stickyScroll = true;
  private windowFirstLine = 0;
  private windowLastLine = 0;
  private loadingOlder = false;
  private loadingNewer = false;
  private hasOlder = false;
  private hasNewer = false;
  private readonly WINDOW_SIZE = 1000;
  private readonly FETCH_CHUNK = 100;
  private scrollDebounceTimer: any = null;

  hitlInput = '';
  subagents: Agent[] = [];
  private scrollToTimestamp: string | null = null;
  activeSubagents: Agent[] = [];
  inactiveSubagents: Agent[] = [];
  inactiveSubagentsExpanded = false;

  private readonly activeStatuses = new Set(['working', 'idle', 'awaiting-permission', 'permission-requested', 'paused']);

  private agentId = '';
  private durationTimer?: ReturnType<typeof setInterval>;
  private routeSub?: Subscription;
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
    this.scrollToTimestamp = this.route.snapshot.queryParamMap.get('scrollTo');
    this.routeSub = this.route.params.subscribe(params => {
      this.agentId = params['id'];
      this.loadAgent();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.transcriptSub?.unsubscribe();
    this.eventSub?.unsubscribe();
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
            .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .slice(-100)
            .map((log: any) => ({ ...log, _parsed: this.parseToolsInMessage(log.message) }));
          this.events = data.events || [];
          this.allAgentEvents = (data.events || []).sort((a: any, b: any) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          this.applyEventFilter();
          if (this.detailView === 'events') {
            setTimeout(() => this.scrollEventStreamToBottom(), 50);
          }
          this.updateDuration();
          this.startDurationTimer();
          this.subscribeToAgentUpdates();
          this.subscribeToSubagents();
          this.subscribeToEvents();
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
        this.activeSubagents = [];
        this.inactiveSubagents = [];
        return;
      }
      this.subagents = agents.filter(a => a.parentPid === this.agent.pid && a.id !== this.agentId);
      this.activeSubagents = this.subagents.filter(a => this.activeStatuses.has(a.status));
      this.inactiveSubagents = this.subagents.filter(a => !this.activeStatuses.has(a.status));
      this.cdr.markForCheck();
    });
  }

  navigateToSubagent(id: string): void {
    this.router.navigate(['/agent', id]);
  }

  setDetailView(view: 'transcript' | 'events'): void {
    this.detailView = view;
    localStorage.setItem('mo_detail_view', view);
    this.cdr.markForCheck();
    if (view === 'transcript') {
      setTimeout(() => this.scrollTranscriptToBottom(), 50);
    } else if (view === 'events') {
      setTimeout(() => this.scrollEventStreamToBottom(), 50);
    }
  }

  private scrollEventStreamToBottom(): void {
    if (!this.eventStreamList?.scrollContainer) return;
    const el = this.eventStreamList.scrollContainer.nativeElement;
    el.scrollTop = el.scrollHeight;
  }

  // --- Events ---

  private static readonly EVENT_TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
    'SessionStart':       { icon: 'play_circle',   color: '#4caf50' },
    'SessionEnd':         { icon: 'stop_circle',   color: '#6e7681' },
    'UserPromptSubmit':   { icon: 'chat',           color: '#2196f3' },
    'PreToolUse':         { icon: 'build',          color: '#7c3aed' },
    'PostToolUse':        { icon: 'check_circle',   color: '#38A169' },
    'PostToolUseFailure': { icon: 'error',          color: '#f44336' },
    'Stop':               { icon: 'flag',            color: '#ffc107' },
    'PermissionRequest':  { icon: 'lock',            color: '#E53E3E' },
    'SubagentStart':      { icon: 'group_add',      color: '#00CED1' },
    'SubagentStop':       { icon: 'group_remove',   color: '#00CED1' },
    'Notification':       { icon: 'notifications',  color: '#ffc107' },
  };

  private subscribeToEvents(): void {
    this.eventSub?.unsubscribe();
    this.eventSub = this.agentService.getEvents().subscribe(events => {
      const agentEvents = events.filter(e => e.agent_id === this.agentId);
      if (agentEvents.length > this.allAgentEvents.length) {
        this.allAgentEvents = [...this.allAgentEvents, ...agentEvents.slice(this.allAgentEvents.length)];
        this.applyEventFilter();
        this.cdr.markForCheck();
      }
    });
  }

  private applyEventFilter(): void {
    let filtered = this.allAgentEvents;
    if (this.eventSearchTerm) {
      const term = this.eventSearchTerm.toLowerCase();
      filtered = filtered.filter(e =>
        (e.message || '').toLowerCase().includes(term) ||
        e.event_type.toLowerCase().includes(term) ||
        JSON.stringify(e.metadata || {}).toLowerCase().includes(term)
      );
    }
    this.agentDisplayEvents = filtered.map(e => this.enrichEvent(e));
  }

  onEventSearchChange(): void {
    this.applyEventFilter();
    this.cdr.markForCheck();
  }

  private enrichEvent(event: TimelineEvent): DisplayEvent {
    const date = new Date(event.timestamp);
    const config = AgentDetailComponent.EVENT_TYPE_CONFIG[event.event_type] || { icon: 'circle', color: '#6e7681' };
    const meta = event.metadata || {};
    const toolName = meta.tool_name || meta.tool || null;
    let toolDetail: string | null = null;
    if (toolName && meta.tool_input) {
      toolDetail = meta.tool_input.file_path || meta.tool_input.command || meta.tool_input.pattern || null;
      if (toolDetail && toolDetail.length > 80) toolDetail = toolDetail.substring(0, 80) + '...';
    }
    let summary = event.message || toolName || event.event_type;
    if (summary.length > 120) summary = summary.substring(0, 120) + '...';

    return {
      ...event,
      _formattedTime: date.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      _agentName: this.getFolderName(this.agent?.workingDirectory || ''),
      _agentColor: this.agentService.getAgentColor(this.agentId) || '#7c3aed',
      _eventIcon: config.icon,
      _eventColor: config.color,
      _toolName: toolName,
      _toolDetail: toolDetail,
      _summary: summary,
      _isExpanded: false,
      _metadataJson: JSON.stringify(event.metadata || {}, null, 2),
    } as DisplayEvent;
  }

  toggleEventExpand(event: DisplayEvent): void {
    event._isExpanded = !event._isExpanded;
    this.cdr.markForCheck();
  }

  copyEventJson(event: DisplayEvent, e: MouseEvent): void {
    e.stopPropagation();
    navigator.clipboard.writeText(event._metadataJson);
  }


  // --- Transcript ---

  private loadTranscript(): void {
    const params: Record<string, string> = { limit: String(this.WINDOW_SIZE) };

    // If coming from prompt history, anchor around that timestamp
    if (this.scrollToTimestamp) {
      params['anchor_timestamp'] = this.scrollToTimestamp;
    }

    this.http.get<any>(`${environment.serverUrl}/api/agents/${this.agentId}/transcript`, { params }).subscribe({
      next: (res) => {
        if (res.success) {
          this.transcriptEntries = res.entries || [];
          this.transcriptTotal = res.total || 0;
          this.windowFirstLine = res.first_line || 0;
          this.windowLastLine = res.last_line || 0;
          this.hasOlder = this.windowFirstLine > 1;
          this.hasNewer = this.transcriptEntries.length < this.transcriptTotal &&
            this.windowLastLine < this.transcriptTotal;
          this.newEntriesCount = 0;
          this.applyTranscriptFilter();
          this.subscribeToTranscript();
          this.cdr.markForCheck();

          if (this.scrollToTimestamp && this.activeTab === 'transcript') {
            this.stickyScroll = false;
            const ts = this.scrollToTimestamp;
            this.scrollToTimestamp = null;
            setTimeout(() => this.scrollToEntry(ts), 300);
          } else if (this.stickyScroll && this.activeTab === 'transcript') {
            setTimeout(() => this.scrollTranscriptToBottom(), 50);
          }
        }
      }
    });
  }

  private subscribeToTranscript(): void {
    this.transcriptSub?.unsubscribe();
    const knownIds = new Set(this.transcriptEntries.map(e => e.id));

    this.transcriptSub = this.agentService.getTranscriptEntries(this.agentId).pipe(skip(1)).subscribe(entries => {
      let added = false;
      for (const entry of entries) {
        if (knownIds.has(entry.id)) continue;
        knownIds.add(entry.id);
        if (this.stickyScroll) {
          // At bottom — append to window and trim from top if needed
          this.transcriptEntries.push(entry);
          if (this.transcriptEntries.length > this.WINDOW_SIZE) {
            this.transcriptEntries.splice(0, this.transcriptEntries.length - this.WINDOW_SIZE);
            this.hasOlder = true;
          }
          this.windowLastLine = entry.line_number;
          if (this.transcriptEntries.length > 0) {
            this.windowFirstLine = this.transcriptEntries[0].line_number;
          }
        } else {
          // Scrolled away — count new entries but don't append
          this.newEntriesCount++;
        }
        this.transcriptTotal++;
        added = true;
      }
      if (added) {
        if (this.stickyScroll) {
          this.transcriptEntries.sort((a, b) => a.line_number - b.line_number);
          this.applyTranscriptFilter();
        }
        this.cdr.markForCheck();
        if (this.stickyScroll && this.activeTab === 'transcript') {
          setTimeout(() => this.scrollTranscriptToBottom(), 20);
        }
      }
    });
  }

  applyTranscriptFilter(): void {
    // Merge transcript entries with inline events
    const eventEntries = this.eventsAsTranscriptEntries();
    let merged = [...this.transcriptEntries, ...eventEntries];
    merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (this.transcriptSearchTerm) {
      const term = this.transcriptSearchTerm.toLowerCase();
      merged = merged.filter(e =>
        (e.content || '').toLowerCase().includes(term) ||
        (e.tool_name || '').toLowerCase().includes(term)
      );
    }
    this.filteredTranscript = merged;
  }

  private eventsAsTranscriptEntries(): TranscriptEntry[] {
    // Convert operational events to transcript entries for inline display
    // Skip event types that are already represented in the transcript
    const skipTypes = new Set(['PreToolUse', 'PostToolUse', 'UserPromptSubmit']);
    return this.allAgentEvents
      .filter(e => !skipTypes.has(e.event_type))
      .map(e => {
        const config = AgentDetailComponent.EVENT_TYPE_CONFIG[e.event_type] || { icon: 'circle', color: '#6e7681' };
        const meta = e.metadata || {};
        let summary = e.message || '';
        if (summary === e.event_type) summary = '';
        if (summary.length > 120) summary = summary.substring(0, 120) + '...';
        return {
          id: `event-${e.timestamp}-${e.event_type}`,
          agent_id: e.agent_id || this.agentId,
          session_id: '',
          entry_type: 'event',
          content: summary,
          tool_name: null,
          tool_input: null,
          tool_use_id: null,
          timestamp: e.timestamp,
          line_number: 0,
          metadata: {
            event_type: e.event_type,
            event_icon: config.icon,
            event_color: config.color,
            raw: e.metadata,
          },
        };
      });
  }

  onTranscriptScroll(): void {
    if (!this.transcriptScroll) return;
    const el = this.transcriptScroll.nativeElement;
    const threshold = 50;
    this.stickyScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;

    // Debounce infinite scroll checks
    if (this.scrollDebounceTimer) return;
    this.scrollDebounceTimer = setTimeout(() => {
      this.scrollDebounceTimer = null;
      if (!this.transcriptScroll) return;
      const scrollEl = this.transcriptScroll.nativeElement;

      // Load older entries when near top
      if (scrollEl.scrollTop < 150 && this.hasOlder && !this.loadingOlder) {
        this.loadOlderEntries();
      }

      // Load newer entries when near bottom (if window was anchored mid-stream)
      if (scrollEl.scrollTop + scrollEl.clientHeight > scrollEl.scrollHeight - 150 && this.hasNewer && !this.loadingNewer) {
        this.loadNewerEntries();
      }
    }, 200);
  }

  private loadOlderEntries(): void {
    if (this.loadingOlder || !this.hasOlder) return;
    this.loadingOlder = true;
    const beforeLine = this.windowFirstLine;

    this.http.get<any>(`${environment.serverUrl}/api/agents/${this.agentId}/transcript`, {
      params: { before_line: String(beforeLine), limit: String(this.FETCH_CHUNK) }
    }).subscribe({
      next: (res) => {
        if (res.success && res.entries?.length) {
          const el = this.transcriptScroll?.nativeElement;
          const prevScrollHeight = el?.scrollHeight || 0;

          // Prepend older entries
          this.transcriptEntries = [...res.entries, ...this.transcriptEntries];
          this.windowFirstLine = res.first_line || this.windowFirstLine;

          // Trim from bottom if over window size (only if not at tail)
          if (this.transcriptEntries.length > this.WINDOW_SIZE && !this.stickyScroll) {
            this.transcriptEntries = this.transcriptEntries.slice(0, this.WINDOW_SIZE);
            this.windowLastLine = this.transcriptEntries[this.transcriptEntries.length - 1].line_number;
            this.hasNewer = true;
          }

          this.hasOlder = this.windowFirstLine > 1;
          this.applyTranscriptFilter();
          this.cdr.markForCheck();

          // Maintain scroll position after prepending
          setTimeout(() => {
            if (el) {
              el.scrollTop = el.scrollHeight - prevScrollHeight;
            }
          }, 0);
        } else {
          this.hasOlder = false;
        }
        this.loadingOlder = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingOlder = false;
      }
    });
  }

  private loadNewerEntries(): void {
    if (this.loadingNewer || !this.hasNewer) return;
    this.loadingNewer = true;
    const afterLine = this.windowLastLine + 1;

    this.http.get<any>(`${environment.serverUrl}/api/agents/${this.agentId}/transcript`, {
      params: { start_line: String(afterLine), limit: String(this.FETCH_CHUNK) }
    }).subscribe({
      next: (res) => {
        if (res.success && res.entries?.length) {
          this.transcriptEntries.push(...res.entries);
          this.windowLastLine = res.last_line || this.windowLastLine;

          // Trim from top if over window size
          if (this.transcriptEntries.length > this.WINDOW_SIZE) {
            const excess = this.transcriptEntries.length - this.WINDOW_SIZE;
            this.transcriptEntries.splice(0, excess);
            this.windowFirstLine = this.transcriptEntries[0].line_number;
            this.hasOlder = true;
          }

          this.hasNewer = this.windowLastLine < this.transcriptTotal;
          this.applyTranscriptFilter();
          this.cdr.markForCheck();
        } else {
          this.hasNewer = false;
        }
        this.loadingNewer = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingNewer = false;
      }
    });
  }

  jumpToLatest(): void {
    // Reload the tail of the transcript and scroll to bottom
    this.newEntriesCount = 0;
    this.http.get<any>(`${environment.serverUrl}/api/agents/${this.agentId}/transcript`, {
      params: { limit: String(this.WINDOW_SIZE) }
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.transcriptEntries = res.entries || [];
          this.transcriptTotal = res.total || this.transcriptTotal;
          this.windowFirstLine = res.first_line || 0;
          this.windowLastLine = res.last_line || 0;
          this.hasOlder = this.windowFirstLine > 1;
          this.hasNewer = false;
          this.stickyScroll = true;
          this.applyTranscriptFilter();
          this.cdr.markForCheck();
          setTimeout(() => this.scrollTranscriptToBottom(), 50);
        }
      }
    });
  }

  private scrollToEntry(timestamp: string): void {
    if (!this.transcriptScroll) return;
    const container = this.transcriptScroll.nativeElement;

    // First try exact match
    let target: HTMLElement | null = container.querySelector(`[data-timestamp="${timestamp}"]`);

    // If no exact match, find the closest user bubble by time
    if (!target) {
      const targetTime = new Date(timestamp).getTime();
      const bubbles = container.querySelectorAll('.user-bubble[data-timestamp]');
      let closest: HTMLElement | null = null;
      let closestDiff = Infinity;
      bubbles.forEach((el: Element) => {
        const ts = (el as HTMLElement).getAttribute('data-timestamp');
        if (ts) {
          const diff = Math.abs(new Date(ts).getTime() - targetTime);
          if (diff < closestDiff) {
            closestDiff = diff;
            closest = el as HTMLElement;
          }
        }
      });
      target = closest;
    }

    if (target) {
      target.scrollIntoView({ block: 'start', behavior: 'auto' });
      // Back up a few pixels for visual breathing room
      container.scrollTop = Math.max(0, container.scrollTop - 8);
    }
  }

  private scrollTranscriptToBottom(): void {
    if (!this.transcriptScroll) return;
    const el = this.transcriptScroll.nativeElement;
    el.scrollTop = el.scrollHeight;
  }

  hasImage(entry: TranscriptEntry): boolean {
    if (!entry.metadata) return false;
    const meta = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : entry.metadata;
    return !!meta?.image_data && meta.image_data.length > 0;
  }

  getImageUrl(entry: TranscriptEntry): string {
    return `${environment.serverUrl}/api/images/${entry.id}`;
  }

  isToolError(entry: TranscriptEntry): boolean {
    if (this.isToolDenied(entry) || this.isToolEmpty(entry)) return false;
    if (!entry.metadata) return false;
    const meta = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : entry.metadata;
    return meta?.is_error === true || meta?.success === false;
  }

  isToolDenied(entry: TranscriptEntry): boolean {
    if (entry.entry_type !== 'tool_result') return false;
    const content = (entry.content || '').toLowerCase();
    return content.includes('denied') || content.includes('rejected') || content.includes('not allowed');
  }

  isToolEmpty(entry: TranscriptEntry): boolean {
    if (entry.entry_type !== 'tool_result') return false;
    return !entry.content || !entry.content.trim();
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

  stringifyMeta(obj: any): string {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return JSON.stringify(obj);
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
    return entry.id;
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

  formatTokenCount(count: number): string {
    if (!count || count === 0) return '0';
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K';
    return count.toString();
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
