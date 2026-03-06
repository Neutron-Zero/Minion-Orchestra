import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { WebsocketService } from './websocket.service';
import { DemoService } from './demo.service';
import { getDemoAgents, getDemoEvents, getDemoTranscript, getDemoLogs } from './demo-data';
import { environment } from '../../environments/environment';

export interface Agent {
  id: string;
  name: string;
  type: string;
  status: 'idle' | 'working' | 'completed' | 'failed' | 'paused' | 'awaiting-permission' | 'permission-requested';
  currentTask?: string;
  lastTask?: string;
  currentTool?: string;
  currentToolDescription?: string;
  workingDirectory?: string;
  progress?: number;
  startTime?: Date;
  lastActivity?: Date;
  tokensUsed?: number;
  toolCalls?: number;
  logs?: string[];
  metrics?: AgentMetrics;
  recentTools?: string[];
  lastToolUsed?: string;
  lastToolTime?: Date;
  pid?: number;
  parentPid?: number;
  activeDuration?: number;
}

export interface AgentMetrics {
  cpuUsage?: number;
  memoryUsage?: number;
  requestsPerSecond?: number;
  averageResponseTime?: number;
}

export interface TaskQueue {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
}

export interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  agentId: string;
}

export interface TimelineEvent {
  event_type: string;
  agent_id: string;
  agent_name: string;
  session_id: string;
  timestamp: string;
  message: string | null;
  metadata: any;
}

export interface TranscriptEntry {
  agent_id: string;
  session_id: string;
  entry_type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_use_id: string | null;
  timestamp: string;
  line_number: number;
  metadata: any;
  _expanded?: boolean;
}

export interface Notification {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: Date;
  duration?: number;
}

@Injectable({
  providedIn: 'root'
})
export class AgentMonitorService implements OnDestroy {
  private agents$ = new BehaviorSubject<Agent[]>([]);
  private taskQueue$ = new BehaviorSubject<TaskQueue>({
    pending: 0, inProgress: 0, completed: 0, failed: 0
  });
  private logs$ = new BehaviorSubject<LogEntry[]>([]);
  private notifications$ = new BehaviorSubject<Notification[]>([]);
  private events$ = new BehaviorSubject<TimelineEvent[]>([]);
  private eventRetention = 500;
  private transcript$ = new BehaviorSubject<TranscriptEntry[]>([]);

  private wsSubscription?: Subscription;
  private connectionSubscription?: Subscription;
  private retryTimeout?: ReturnType<typeof setTimeout>;
  private logRetention = 1000;
  private updateInterval = 5000;
  private debugMode = false;
  private configSent = false;

  // Notification preferences (loaded from server config)
  private notificationsEnabled = true;
  private notifyPrefs: Record<string, boolean> = {
    on_waiting: true,
    on_failed: true,
    on_completed: true,
    on_permission_request: true,
  };

  private agentColorMap = new Map<string, string>();
  private usedColorIndex = 0;
  private readonly AGENT_COLORS = [
    '#4caf50', '#ffc107', '#2196f3', '#E53E3E', '#7c3aed',
    '#00CED1', '#FF1493', '#38A169', '#4169E1', '#f44336',
  ];

  constructor(
    private websocket: WebsocketService,
    private http: HttpClient,
    private demo: DemoService,
  ) {
    if (this.demo.isDemoMode) {
      this.seedDemoData();
      return;
    }
    this.loadPersistedData();
    this.connectToServer();
    this.requestNotificationPermission();
    this.loadNotificationPrefs();
  }

  private demoInterval?: ReturnType<typeof setInterval>;

  private seedDemoData(): void {
    this.agents$.next(getDemoAgents());
    this.events$.next(getDemoEvents());
    this.transcript$.next(getDemoTranscript());
    this.logs$.next(getDemoLogs());

    // Re-emit periodically so real-time charts accumulate data points.
    // Use the same cached array to avoid triggering timeline rebuilds.
    const cachedAgents = getDemoAgents();
    this.demoInterval = setInterval(() => {
      this.agents$.next(cachedAgents);
      this.logs$.next(getDemoLogs());
    }, 1000);
  }

  private requestNotificationPermission(): void {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  loadNotificationPrefs(): void {
    const saved = localStorage.getItem('notification-prefs');
    if (saved) {
      try {
        const prefs = JSON.parse(saved);
        this.notificationsEnabled = prefs.enabled !== false;
        this.notifyPrefs = {
          on_waiting: prefs.on_waiting !== false,
          on_failed: prefs.on_failed !== false,
          on_completed: prefs.on_completed !== false,
          on_permission_request: prefs.on_permission_request !== false,
        };
      } catch {}
    }
  }

  saveNotificationPrefs(prefs: Record<string, boolean>): void {
    const current = {
      enabled: this.notificationsEnabled,
      ...this.notifyPrefs,
      ...prefs,
    };
    localStorage.setItem('notification-prefs', JSON.stringify(current));
    this.loadNotificationPrefs();
  }

  private sendBrowserNotification(agentId: string, eventLabel: string, task?: string): void {
    if (!this.notificationsEnabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const title = 'Minion Orchestra';
    const body = task
      ? `${this.formatAgentId(agentId)} - ${eventLabel}\n${task}`
      : `${this.formatAgentId(agentId)} - ${eventLabel}`;

    new Notification(title, {
      body,
      icon: 'assets/logo.png',
    });
  }

  private maybeNotifyBrowser(agentId: string, status: string, task?: string): void {
    const statusConfig: Record<string, { label: string; pref: string }> = {
      'idle': { label: 'Task Completed', pref: 'on_completed' },
      'completed': { label: 'Task Completed', pref: 'on_completed' },
      'failed': { label: 'Task Failed', pref: 'on_failed' },
      'awaiting-permission': { label: 'Needs Attention', pref: 'on_waiting' },
      'permission-requested': { label: 'Permission Requested', pref: 'on_permission_request' },
    };
    const entry = statusConfig[status];
    if (entry && this.notifyPrefs[entry.pref] !== false) {
      this.sendBrowserNotification(agentId, entry.label, task);
    }
  }

  ngOnDestroy(): void {
    if (this.demoInterval) clearInterval(this.demoInterval);
    this.wsSubscription?.unsubscribe();
    this.connectionSubscription?.unsubscribe();
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
    this.websocket.disconnect();
  }

  // --- Connection ---

  private connectToServer(): void {
    this.connectWebSocket();
    this.startConnectionMonitor();
  }

  private connectWebSocket(): void {
    if (!this.wsSubscription) {
      this.wsSubscription = this.websocket.messages$.subscribe(message => {
        if (this.debugMode) {
          console.log('WS Message:', message);
        }
        switch (message.type) {
          case 'agent_update':
            this.handleAgentUpdate(message.data);
            break;
          case 'task_update':
            this.handleTaskUpdate(message.data);
            break;
          case 'log':
            this.handleLog(message.data);
            break;
          case 'event':
            this.handleEvent(message.data);
            break;
          case 'transcript':
            this.handleTranscript(message.data);
            break;
          case 'metrics':
            this.handleMetrics(message.data);
            break;
          case 'agent_disconnect':
          case 'stop':
            this.handleAgentDisconnect(message.data);
            break;
        }
      });
    }
    this.websocket.connect(environment.serverUrl);
  }

  private startConnectionMonitor(): void {
    this.connectionSubscription = this.websocket.isConnected$.subscribe(connected => {
      if (connected) {
        if (!this.configSent) {
          this.sendInitialConfig();
        }
      } else {
        this.retryTimeout = setTimeout(() => {
          this.connectWebSocket();
        }, 5000);
      }
    });
  }

  private sendInitialConfig(): void {
    const cleanupInterval = localStorage.getItem('cleanup-interval') || '5000';
    this.updateCleanupInterval(parseInt(cleanupInterval));
    this.configSent = true;
  }

  // --- Message Handlers ---

  private handleAgentUpdate(data: any): void {
    const previousAgents = this.agents$.value;

    if (data.type === 'disconnect') {
      this.handleAgentDisconnect(data);
      return;
    }

    if (Array.isArray(data)) {
      // Preserve lastTask from previous state
      const updated = data.map((agent: Agent) => {
        const prev = previousAgents.find(a => a.id === agent.id);
        if (prev) {
          agent.lastTask = agent.currentTask || prev.lastTask || prev.currentTask;
        }
        return agent;
      });
      this.agents$.next(updated);
      this.persistAgents(updated);

      updated.forEach((agent: Agent) => {
        const prev = previousAgents.find(a => a.id === agent.id);
        if (!prev) {
          this.addNotification('info', `New agent connected: ${this.formatAgentId(agent.id)}`);
        } else if (prev.status !== agent.status) {
          this.maybeNotifyBrowser(agent.id, agent.status, agent.lastTask);
        }
      });
    } else {
      const agents = [...this.agents$.value];
      const index = agents.findIndex(a => a.id === data.id);

      if (index >= 0) {
        const oldStatus = agents[index].status;
        const lastTask = data.currentTask || agents[index].lastTask || agents[index].currentTask;
        agents[index] = { ...agents[index], ...data, lastTask };
        if (oldStatus !== data.status) {
          this.addNotification(
            data.status === 'failed' ? 'error' : 'info',
            `Agent ${this.formatAgentId(data.id)} status: ${data.status}`
          );
          this.maybeNotifyBrowser(data.id, data.status, lastTask);
        }
      } else {
        agents.push(data);
        this.addNotification('info', `New agent connected: ${this.formatAgentId(data.id)}`);
      }

      this.agents$.next(agents);
      this.persistAgents(agents);
    }
  }

  private handleTaskUpdate(data: any): void {
    this.taskQueue$.next(data);
  }

  private handleLog(data: any): void {
    const currentLogs = this.logs$.value;
    const newLog: LogEntry = {
      timestamp: new Date(data.timestamp),
      level: data.level,
      message: data.message,
      agentId: data.agentId
    };

    const isDuplicate = currentLogs.some(log =>
      log.message === newLog.message &&
      log.agentId === newLog.agentId &&
      Math.abs(new Date(log.timestamp).getTime() - newLog.timestamp.getTime()) < 100
    );

    if (!isDuplicate) {
      const updatedLogs = [...currentLogs, newLog];
      if (updatedLogs.length > this.logRetention) {
        updatedLogs.splice(0, updatedLogs.length - this.logRetention);
      }
      this.logs$.next(updatedLogs);
      this.persistLogs(updatedLogs);

      if (data.level === 'error') {
        this.addNotification('error', `Error from ${data.agentId}: ${data.message}`);
      }
    }
  }

  private handleMetrics(data: any): void {
    const agents = [...this.agents$.value];
    const agent = agents.find(a => a.id === data.agentId);
    if (agent) {
      agent.metrics = data.metrics;
      this.agents$.next(agents);
      this.persistAgents(agents);
    }
  }

  private handleAgentDisconnect(data: any): void {
    const agents = this.agents$.value;
    const filteredAgents = agents.filter(agent => agent.id !== data.agentId);

    if (filteredAgents.length !== agents.length) {
      this.agents$.next(filteredAgents);
      this.persistAgents(filteredAgents);
      this.addNotification('info', `Agent ${this.formatAgentId(data.agentId)} disconnected`);
    }
  }

  private handleEvent(data: any): void {
    const current = this.events$.value;
    const newEvent: TimelineEvent = {
      event_type: data.event_type,
      agent_id: data.agent_id,
      agent_name: data.agent_name || '',
      session_id: data.session_id,
      timestamp: data.timestamp,
      message: data.message,
      metadata: data.metadata,
    };
    // Dedup by timestamp + agent + event_type
    const isDup = current.some(e =>
      e.timestamp === newEvent.timestamp &&
      e.agent_id === newEvent.agent_id &&
      e.event_type === newEvent.event_type
    );
    if (isDup) return;
    const updated = [...current, newEvent];
    if (updated.length > this.eventRetention) {
      updated.splice(0, updated.length - this.eventRetention);
    }
    this.events$.next(updated);
  }

  private handleTranscript(data: any): void {
    const entry: TranscriptEntry = {
      agent_id: data.agent_id,
      session_id: data.session_id,
      entry_type: data.entry_type,
      content: data.content,
      tool_name: data.tool_name,
      tool_input: data.tool_input,
      tool_use_id: data.tool_use_id,
      timestamp: data.timestamp,
      line_number: data.line_number,
      metadata: data.metadata,
    };
    const current = this.transcript$.value;
    const isDup = current.some(e =>
      e.agent_id === entry.agent_id &&
      e.line_number === entry.line_number &&
      e.entry_type === entry.entry_type
    );
    if (isDup) return;
    const updated = [...current, entry];
    if (updated.length > 2000) {
      updated.splice(0, updated.length - 2000);
    }
    this.transcript$.next(updated);
  }

  private addNotification(type: Notification['type'], message: string): void {
    const notifications = [...this.notifications$.value, {
      type,
      message,
      timestamp: new Date(),
      duration: 5000
    }];
    // Cap notifications at 100
    if (notifications.length > 100) {
      notifications.splice(0, notifications.length - 100);
    }
    this.notifications$.next(notifications);
  }

  // --- Persistence ---

  private loadPersistedData(): void {
    try {
      const debugMode = localStorage.getItem('debug-mode');
      if (debugMode) this.debugMode = debugMode === 'true';

      const agentsData = localStorage.getItem('minion-command-agents');
      if (agentsData) {
        const agents = JSON.parse(agentsData).map((agent: any) => ({
          ...agent,
          startTime: agent.startTime ? new Date(agent.startTime) : undefined,
          lastActivity: agent.lastActivity ? new Date(agent.lastActivity) : undefined
        }));
        this.agents$.next(agents);
      }

      const logsData = localStorage.getItem('minion-command-logs');
      if (logsData) {
        const logs = JSON.parse(logsData).map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp)
        }));
        this.logs$.next(logs);
      }
    } catch (error) {
      console.error('Error loading persisted data:', error);
    }
  }

  private persistAgents(agents: Agent[]): void {
    try {
      localStorage.setItem('minion-command-agents', JSON.stringify(agents));
    } catch (error) {
      console.error('Error persisting agents:', error);
    }
  }

  private persistLogs(logs: LogEntry[]): void {
    try {
      localStorage.setItem('minion-command-logs', JSON.stringify(logs));
    } catch (error) {
      console.error('Error persisting logs:', error);
    }
  }

  // --- Public Observables ---

  getAgents(): Observable<Agent[]> {
    return this.agents$.asObservable();
  }

  getAgentsSnapshot(): Agent[] {
    return this.agents$.value;
  }

  getTaskQueue(): Observable<TaskQueue> {
    return this.taskQueue$.asObservable();
  }

  getAgentById(id: string): Observable<Agent | undefined> {
    return this.agents$.pipe(
      map(agents => agents.find(a => a.id === id))
    );
  }

  getLogs(): Observable<LogEntry[]> {
    return this.logs$.pipe(
      map(logs => [...logs].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      ))
    );
  }

  getNotifications(): Observable<Notification[]> {
    return this.notifications$.asObservable();
  }

  getAgentLogs(agentId: string): Observable<LogEntry[]> {
    return this.logs$.pipe(
      map(logs => logs
        .filter(log => log.agentId === agentId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      )
    );
  }

  isConnected(): Observable<boolean> {
    if (this.demo.isDemoMode) {
      return new BehaviorSubject(true).asObservable();
    }
    return this.websocket.isConnected$;
  }

  getEvents(): Observable<TimelineEvent[]> {
    return this.events$.asObservable();
  }

  getEventsSnapshot(): TimelineEvent[] {
    return this.events$.value;
  }

  clearEvents(): void {
    this.events$.next([]);
  }

  getTranscriptEntries(agentId: string): Observable<TranscriptEntry[]> {
    return this.transcript$.pipe(
      map(entries => entries
        .filter(e => e.agent_id === agentId)
        .sort((a, b) => a.line_number - b.line_number)
      )
    );
  }

  // --- Control Methods ---

  clearLogs(): void {
    this.logs$.next([]);
    this.persistLogs([]);
  }

  setLogRetention(count: number): void {
    this.logRetention = count;
  }

  setUpdateInterval(ms: number): void {
    this.updateInterval = ms;
  }

  clearNotifications(): void {
    this.notifications$.next([]);
  }

  pauseAgent(agentId: string): void {
    this.websocket.pauseAgent(agentId);
  }

  resumeAgent(agentId: string): void {
    this.websocket.resumeAgent(agentId);
  }

  reassignTask(taskId: string, newAgentId: string): void {
    this.websocket.reassignTask(taskId, newAgentId);
  }

  focusAgent(agentId: string): void {
    this.http.post(`${environment.serverUrl}/api/actions/focus`, { agentId }).subscribe({
      error: (err) => console.error('Error focusing agent:', err)
    });
  }

  sendAgentInput(agentId: string, text: string): void {
    this.http.post(`${environment.serverUrl}/api/actions/input`, { agentId, text }).subscribe({
      error: (err) => console.error('Error sending input:', err)
    });
  }

  updateCleanupInterval(intervalMs: number): void {
    this.http.post<any>(`${environment.serverUrl}/config`, { cleanupInterval: intervalMs }).subscribe({
      next: (data) => {
        if (data.success) {
          localStorage.setItem('cleanup-interval', intervalMs.toString());
        }
      },
      error: (err) => console.error('Error updating cleanup interval:', err)
    });
  }

  removeAgent(agentId: string): void {
    const filteredAgents = this.agents$.value.filter(agent => agent.id !== agentId);
    this.agents$.next(filteredAgents);
    this.persistAgents(filteredAgents);
  }

  clearAllAgents(): void {
    this.agents$.next([]);
    this.persistAgents([]);
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    localStorage.setItem('debug-mode', enabled.toString());
  }

  isDebugMode(): boolean {
    return this.debugMode;
  }

  // --- Formatting Utilities ---

  getFormattedAgentId(id: string): string {
    return this.formatAgentId(id);
  }

  private formatAgentId(id: string): string {
    if (!id) return 'Unknown';
    const agent = this.agents$.value.find(a => a.id === id);
    const type = agent?.type || '';
    const shortId = id.length > 5 ? id.slice(-5) : id;
    if (type === 'copilot-cli') {
      return `copilot-${shortId}`;
    }
    return `agent-${shortId}`;
  }

  getAgentColor(agentId: string): string {
    if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
      return this.AGENT_COLORS[0];
    }
    if (this.agentColorMap.has(agentId)) {
      return this.agentColorMap.get(agentId)!;
    }
    const color = this.AGENT_COLORS[this.usedColorIndex % this.AGENT_COLORS.length];
    this.usedColorIndex++;
    this.agentColorMap.set(agentId, color);
    return color;
  }
}
