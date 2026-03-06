import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { Agent, AgentMonitorService, TimelineEvent } from '../services/agent-monitor.service';
import { DemoService } from '../services/demo.service';
import { environment } from '../../environments/environment';

interface AgentLane {
  agent: Agent;
  color: string;
  segments: LaneSegment[];
}

interface LaneSegment {
  /** Percentage offset from left (0-100) */
  left: number;
  /** Percentage width (0-100) */
  width: number;
  status: string;
  color: string;
  startTime: Date;
  endTime: Date;
  toolCount: number;
  label: string;
}

interface TimeRangeOption {
  label: string;
  minutes: number;
}

@Component({
  selector: 'app-agent-timeline',
  templateUrl: './agent-timeline.component.html',
  styleUrls: ['./agent-timeline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AgentTimelineComponent implements OnInit, OnDestroy {
  @Input() agents: Agent[] = [];
  @Input() set initialRange(val: number) {
    if (val > 0) {
      this.selectedRange = val;
    }
  }
  @Output() focus = new EventEmitter<Agent>();
  @Output() viewDetails = new EventEmitter<Agent>();

  lanes: AgentLane[] = [];
  timeLabels: string[] = [];

  timeRanges: TimeRangeOption[] = [
    { label: '1m', minutes: 1 },
    { label: '5m', minutes: 5 },
    { label: '10m', minutes: 10 },
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '6h', minutes: 360 },
    { label: '12h', minutes: 720 },
    { label: '24h', minutes: 1440 },
  ];
  selectedRange = 5;

  private eventSub?: Subscription;
  private agentSub?: Subscription;
  private refreshInterval?: ReturnType<typeof setInterval>;
  private events: TimelineEvent[] = [];

  private historicalEvents: TimelineEvent[] = [];

  constructor(
    private http: HttpClient,
    private agentService: AgentMonitorService,
    private cdr: ChangeDetectorRef,
    private demo: DemoService,
  ) {}

  private demoBuilt = false;

  ngOnInit(): void {
    this.loadHistoricalEvents();

    this.eventSub = this.agentService.getEvents().subscribe(events => {
      this.mergeEvents(events);
      if (!this.demo.isDemoMode || !this.demoBuilt) this.rebuild();
    });

    this.agentSub = this.agentService.getAgents().subscribe(agents => {
      this.agents = agents;
      if (!this.demo.isDemoMode || !this.demoBuilt) {
        this.rebuild();
        if (this.demo.isDemoMode) this.demoBuilt = true;
      }
    });

    // Refresh every second to advance the time axis (skip in demo mode)
    if (!this.demo.isDemoMode) {
      this.refreshInterval = setInterval(() => {
        this.rebuild();
      }, 1000);
    }
  }

  private lastFetchedRange = 0;

  private toLocalISO(date: Date): string {
    const pad = (n: number, len = 2) => n.toString().padStart(len, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  }

  private loadHistoricalEvents(): void {
    this.lastFetchedRange = this.selectedRange;
    const since = this.toLocalISO(new Date(Date.now() - this.selectedRange * 60 * 1000));
    this.http.get<any>(`${environment.serverUrl}/api/events`, {
      params: { limit: '5000', since }
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.historicalEvents = (res.events || []).reverse();
          this.mergeEvents(this.agentService.getEventsSnapshot());
          this.rebuild();
        }
      }
    });
  }

  private mergeEvents(realtimeEvents: TimelineEvent[]): void {
    const seen = new Set<string>();
    const merged: TimelineEvent[] = [];
    for (const e of [...this.historicalEvents, ...realtimeEvents]) {
      const key = `${e.timestamp}|${e.agent_id}|${e.event_type}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(e);
      }
    }
    this.events = merged;
  }

  ngOnDestroy(): void {
    this.eventSub?.unsubscribe();
    this.agentSub?.unsubscribe();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  setRange(minutes: number): void {
    this.selectedRange = minutes;
    if (minutes > this.lastFetchedRange) {
      this.loadHistoricalEvents();
    } else {
      this.rebuild();
    }
  }

  private rebuild(): void {
    const now = Date.now();
    const rangeMs = this.selectedRange * 60 * 1000;
    const windowStart = now - rangeMs;

    this.buildTimeLabels(windowStart, now);
    this.buildLanes(windowStart, now, rangeMs);
    this.cdr.markForCheck();
  }

  private buildTimeLabels(windowStart: number, now: number): void {
    const count = 6;
    this.timeLabels = [];
    for (let i = 0; i <= count; i++) {
      const t = windowStart + (now - windowStart) * (i / count);
      const d = new Date(t);
      this.timeLabels.push(d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
  }

  private buildLanes(windowStart: number, now: number, rangeMs: number): void {
    // Group events by agent_id (only events within the time window)
    const eventsByAgent = new Map<string, TimelineEvent[]>();
    for (const e of this.events) {
      const ts = new Date(e.timestamp).getTime();
      if (ts < windowStart || ts > now) continue;
      const list = eventsByAgent.get(e.agent_id) || [];
      list.push(e);
      eventsByAgent.set(e.agent_id, list);
    }

    // Build a map of known agents by ID
    const agentMap = new Map<string, Agent>();
    for (const a of this.agents) {
      agentMap.set(a.id, a);
    }

    // Create placeholder agents for IDs found in events but not currently connected
    for (const agentId of eventsByAgent.keys()) {
      if (!agentMap.has(agentId)) {
        const events = eventsByAgent.get(agentId)!;
        const name = events[0]?.agent_name || '';
        agentMap.set(agentId, {
          id: agentId,
          name,
          type: 'claude-code',
          status: 'completed',
          workingDirectory: events[0]?.metadata?.cwd || events[0]?.metadata?.working_directory,
        } as Agent);
      }
    }

    // Show agents that are busy, have events, or are subagents with activity in window
    const busyStatuses = new Set(['working', 'awaiting-permission', 'permission-requested']);
    const relevantAgents = Array.from(agentMap.values()).filter(a => {
      if (busyStatuses.has(a.status)) return true;
      if (eventsByAgent.has(a.id)) return true;
      // Subagents with no own events: check if their activity overlaps the window
      if (a.type === 'subagent') {
        const start = a.startTime ? new Date(a.startTime).getTime() : 0;
        const end = a.lastActivity ? new Date(a.lastActivity).getTime() : start;
        return start > 0 && end >= windowStart && start <= now;
      }
      return false;
    });

    const allLanes = relevantAgents
      .map(agent => {
        const color = this.agentService.getAgentColor(agent.id);
        const agentEvents = eventsByAgent.get(agent.id) || [];
        const segments = this.buildSegments(agent, agentEvents, windowStart, now, rangeMs);
        return { agent, color, segments };
      })
      .filter(lane => lane.segments.length > 0);

    // Sort: parents first, then subagents under their parent
    const parentLanes: AgentLane[] = [];
    const childLanes = new Map<number, AgentLane[]>(); // parentPid -> children

    for (const lane of allLanes) {
      if (lane.agent.parentPid && lane.agent.type === 'subagent') {
        const list = childLanes.get(lane.agent.parentPid) || [];
        list.push(lane);
        childLanes.set(lane.agent.parentPid, list);
      } else {
        parentLanes.push(lane);
      }
    }

    this.lanes = [];
    for (const parent of parentLanes) {
      this.lanes.push(parent);
      const children = childLanes.get(parent.agent.pid!) || [];
      this.lanes.push(...children);
      childLanes.delete(parent.agent.pid!);
    }
    // Orphan subagents (parent not in view)
    for (const children of childLanes.values()) {
      this.lanes.push(...children);
    }
  }

  private buildSegments(agent: Agent, events: TimelineEvent[], windowStart: number, now: number, rangeMs: number): LaneSegment[] {
    if (events.length === 0) {
      // Subagents don't fire their own hooks -- use session metadata
      if (agent.type === 'subagent') {
        const startTs = agent.startTime ? new Date(agent.startTime).getTime() : 0;
        const duration = (agent.activeDuration || 0) * 1000;
        const isBusy = agent.status === 'working' || agent.status === 'awaiting-permission' || agent.status === 'permission-requested';
        const endTs = isBusy ? now : (duration > 0 ? startTs + duration : startTs);

        if (startTs > 0 && endTs > windowStart) {
          const clampedStart = Math.max(startTs, windowStart);
          const clampedEnd = Math.min(endTs, now);
          if (clampedEnd > clampedStart) {
            const status = agent.status === 'failed' ? 'failed' : 'working';
            return [this.makeSegment(clampedStart, clampedEnd, status, agent.toolCalls || 0, windowStart, rangeMs)];
          }
        }
      }
      return [];
    }

    // Plot each event, extending it to the next event's start time.
    // This fills thinking time between tool calls as continuous activity.
    // Cap extension at 2 minutes -- gaps longer than that are real idle time.
    const maxExtend = 120_000;
    const minWidth = Math.max(rangeMs * 0.003, 1000);

    // All events in window, sorted chronologically
    const inWindow = events
      .map(e => ({ event: e, ts: new Date(e.timestamp).getTime(), status: this.eventToStatus(e) }))
      .filter(e => e.ts >= windowStart && e.ts <= now)
      .sort((a, b) => a.ts - b.ts);

    // Track status transitions -- same logic as the Kanban.
    // A new segment only starts when status actually changes.
    // Events with null status (Notification, SubagentStart, etc.) end a "waiting"
    // period since any activity means approval was granted, but otherwise are ignored.
    const skipRender = new Set(['idle', 'completed']);
    const busyStatuses = new Set(['working', 'awaiting-permission', 'permission-requested']);

    const segments: LaneSegment[] = [];
    let currentStatus: string | null = null;
    let segStart = 0;
    let toolCount = 0;

    for (let i = 0; i < inWindow.length; i++) {
      const { event, ts, status } = inWindow[i];

      let effectiveStatus = status;
      if (status === null) {
        if (currentStatus === 'waiting') {
          effectiveStatus = 'working';
        } else {
          continue;
        }
      }

      if (effectiveStatus !== currentStatus) {
        // Close previous segment
        if (currentStatus && !skipRender.has(currentStatus)) {
          segments.push(this.makeSegment(segStart, ts, currentStatus, toolCount, windowStart, rangeMs));
        }
        currentStatus = effectiveStatus;
        segStart = ts;
        toolCount = 0;
      }

      if (event.event_type === 'PreToolUse' || event.event_type === 'PostToolUse') {
        toolCount++;
      }
    }

    // Close final segment
    if (currentStatus && !skipRender.has(currentStatus)) {
      const lastTs = inWindow[inWindow.length - 1].ts;
      const end = busyStatuses.has(agent.status) ? now : lastTs + minWidth;
      segments.push(this.makeSegment(segStart, end, currentStatus, toolCount, windowStart, rangeMs));
    }

    return segments;
  }

  private makeSegment(start: number, end: number, status: string, toolCount: number, windowStart: number, rangeMs: number): LaneSegment {
    const clampedStart = Math.max(start, windowStart);
    const left = ((clampedStart - windowStart) / rangeMs) * 100;
    const width = ((end - clampedStart) / rangeMs) * 100;
    return {
      left: Math.max(0, Math.min(left, 100)),
      width: Math.max(0, Math.min(width, 100 - left)),
      status,
      color: this.statusColor(status),
      startTime: new Date(clampedStart),
      endTime: new Date(end),
      toolCount,
      label: toolCount >= 5 ? `${status} (${toolCount} tools)` : status,
    };
  }

  private eventToStatus(event: TimelineEvent): string | null {
    switch (event.event_type) {
      case 'SessionStart': return 'idle';
      case 'UserPromptSubmit': return 'working';
      case 'PreToolUse': return 'working';
      case 'Stop': return 'idle';
      case 'SessionEnd': return 'completed';
      case 'PermissionRequest': return 'waiting';
      case 'PostToolUse': return 'working';
      case 'PostToolUseFailure': return 'failed';
      default: return null;
    }
  }

  private statusColor(status: string): string {
    switch (status) {
      case 'working': return '#4caf50';
      case 'idle': return '#6366f1';
      case 'waiting':
      case 'awaiting-permission':
      case 'permission-requested': return '#ffc107';
      case 'failed': return '#f44336';
      case 'completed': return '#6e7681';
      default: return '#6e7681';
    }
  }

  getAgentColor(agentId: string): string {
    return this.agentService.getAgentColor(agentId);
  }

  getFormattedAgentId(agent: Agent): string {
    if (agent.type === 'subagent') {
      const digits = agent.id.replace(/\D/g, '');
      return `subagent-${digits.slice(-5).padStart(5, '0')}`;
    }
    return this.agentService.getFormattedAgentId(agent.id);
  }

  getTaskLabel(agent: Agent): string {
    if (agent.type === 'subagent') return agent.name || '';
    return agent.currentTask || '';
  }

  getFolderName(agent: Agent): string {
    if (agent.workingDirectory) {
      const parts = agent.workingDirectory.split('/').filter(p => p);
      return parts[parts.length - 1] || '';
    }
    return '';
  }

  trackByLane(index: number, lane: AgentLane): string {
    return lane.agent.id;
  }

  trackBySegment(index: number, seg: LaneSegment): string {
    return `${seg.left}-${seg.width}`;
  }
}
