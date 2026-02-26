import { Injectable } from '@angular/core';
import { BehaviorSubject, interval, Observable, Subscription, timer } from 'rxjs';
import { map, retry, delayWhen } from 'rxjs/operators';
import { WebsocketService } from './websocket.service';

export interface Agent {
  id: string;
  name: string;
  type: string;
  status: 'idle' | 'working' | 'completed' | 'failed' | 'paused' | 'awaiting-permission' | 'permission-requested';
  currentTask?: string;
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

export interface Notification {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: Date;
  duration?: number;
}

@Injectable({
  providedIn: 'root'
})
export class AgentMonitorService {
  private agents$ = new BehaviorSubject<Agent[]>([]);
  private taskQueue$ = new BehaviorSubject<TaskQueue>({
    pending: 0,
    inProgress: 0,
    completed: 0,
    failed: 0
  });
  private logs$ = new BehaviorSubject<LogEntry[]>([]);
  private notifications$ = new BehaviorSubject<Notification[]>([]);
  private wsSubscription?: Subscription;
  private retryInterval?: Subscription;
  private serverUrl = 'http://localhost:3000';
  private logRetention = 1000;
  private updateInterval = 5000;
  private debugMode = false;
  private configSent = false;

  constructor(private websocket: WebsocketService) {
    console.log('AgentMonitorService constructor called');
    this.loadPersistedData();
    this.connectToServer();
  }

  private sendInitialConfig(): void {
    // Send configuration to server when connected
    const cleanupInterval = localStorage.getItem('cleanup-interval') || '5000';
    this.updateCleanupInterval(parseInt(cleanupInterval));
    this.configSent = true;
  }

  updateCleanupInterval(intervalMs: number): void {
    fetch(`${this.serverUrl}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cleanupInterval: intervalMs
      })
    }).then(response => response.json())
      .then(data => {
        if (data.success) {
          localStorage.setItem('cleanup-interval', intervalMs.toString());
          console.log(`Cleanup interval set to ${intervalMs}ms`);
        } else {
          console.error('Failed to update cleanup interval:', data.message);
        }
      })
      .catch(error => {
        console.error('Error updating cleanup interval:', error);
      });
  }

  private connectToServer(): void {
    this.connectWebSocket();
    // Delay retry loop to avoid race condition with initial connection
    setTimeout(() => {
      this.startRetryLoop();
    }, 2000);
  }

  private connectWebSocket(): void {
    console.log('Connecting to Minion Orchestra server...');
    
    // Only create subscription once
    if (!this.wsSubscription) {
      this.wsSubscription = this.websocket.messages$.subscribe(message => {
      if (this.debugMode) {
        console.log('🔍 WebSocket Message:', message);
      }
      
      switch (message.type) {
        case 'agent_update':
          if (this.debugMode) console.log('📡 Agent Update:', message.data);
          this.handleAgentUpdate(message.data);
          break;
        case 'task_update':
          if (this.debugMode) console.log('📋 Task Update:', message.data);
          this.handleTaskUpdate(message.data);
          break;
        case 'log':
          if (this.debugMode) console.log('📝 Log Entry:', message.data);
          this.handleLog(message.data);
          break;
        case 'metrics':
          if (this.debugMode) console.log('📊 Metrics:', message.data);
          this.handleMetrics(message.data);
          break;
        case 'agent_disconnect':
        case 'stop':
          if (this.debugMode) console.log('🔌 Agent Disconnect:', message.data);
          this.handleAgentDisconnect(message.data);
          break;
      }
    });
    }
    
    // Connect the websocket
    this.websocket.connect(this.serverUrl);
  }

  private startRetryLoop(): void {
    // Monitor connection status and retry if needed
    this.websocket.isConnected$.subscribe(connected => {
      if (connected) {
        console.log('Connected to Minion Orchestra server');
        // Send config when we connect (only if not already sent)
        if (!this.configSent) {
          this.sendInitialConfig();
        }
      } else {
        console.log('Disconnected from Minion Orchestra server');
        // Retry connection after 5 seconds
        setTimeout(() => {
          console.log('Retrying connection to Minion Orchestra server...');
          this.connectWebSocket();
        }, 5000);
      }
    });
  }

  private handleAgentUpdate(data: any): void {
    const previousAgents = this.agents$.value;
    
    // Handle disconnect message
    if (data.type === 'disconnect') {
      this.handleAgentDisconnect(data);
      return;
    }
    
    // If data is an array (from server), replace all agents
    if (Array.isArray(data)) {
      this.agents$.next(data);
      this.persistAgents(data);
      
      // Check for new agents
      data.forEach((agent: Agent) => {
        if (!previousAgents.find(a => a.id === agent.id)) {
          const notifications = this.notifications$.value;
          notifications.push({
            type: 'info',
            message: `New agent connected: ${this.formatAgentId(agent.id)}`,
            timestamp: new Date(),
            duration: 5000
          });
          this.notifications$.next(notifications);
        }
      });
    } else {
      // Otherwise handle single agent update
      const agents = this.agents$.value;
      const index = agents.findIndex(a => a.id === data.id);
      
      if (index >= 0) {
        const oldStatus = agents[index].status;
        agents[index] = { ...agents[index], ...data };
        
        // Notify on status changes
        if (oldStatus !== data.status) {
          const notifications = this.notifications$.value;
          notifications.push({
            type: data.status === 'failed' ? 'error' : 'info',
            message: `Agent ${this.formatAgentId(data.id)} status: ${data.status}`,
            timestamp: new Date(),
            duration: 5000
          });
          this.notifications$.next(notifications);
        }
      } else {
        agents.push(data);
        const notifications = this.notifications$.value;
        notifications.push({
          type: 'info',
          message: `New agent connected: ${this.formatAgentId(data.id)}`,
          timestamp: new Date(),
          duration: 5000
        });
        this.notifications$.next(notifications);
      }
      
      const updatedAgents = [...agents];
      this.agents$.next(updatedAgents);
      this.persistAgents(updatedAgents);
    }
  }

  private handleTaskUpdate(data: any): void {
    this.taskQueue$.next(data);
  }

  private handleLog(data: any): void {
    const logs = this.logs$.value;
    const newLog = {
      timestamp: new Date(data.timestamp),
      level: data.level,
      message: data.message,
      agentId: data.agentId
    };
    
    // Check for duplicate logs (same message and agentId within 100ms)
    const isDuplicate = logs.some(log => 
      log.message === newLog.message && 
      log.agentId === newLog.agentId &&
      Math.abs(new Date(log.timestamp).getTime() - new Date(newLog.timestamp).getTime()) < 100
    );
    
    if (!isDuplicate) {
      logs.push(newLog);
      
      // Keep only last 1000 logs
      if (logs.length > 1000) {
        logs.shift();
      }
      
      const updatedLogs = [...logs];
      this.logs$.next(updatedLogs);
      this.persistLogs(updatedLogs);
      
      // Emit notification for errors
      if (data.level === 'error') {
        const notifications = this.notifications$.value;
        notifications.push({
          type: 'error',
          message: `Error from ${data.agentId}: ${data.message}`,
          timestamp: new Date()
        });
        this.notifications$.next(notifications);
      }
    }
  }

  private handleMetrics(data: any): void {
    const agents = this.agents$.value;
    const agent = agents.find(a => a.id === data.agentId);
    
    if (agent) {
      agent.metrics = data.metrics;
      const updatedAgents = [...agents];
      this.agents$.next(updatedAgents);
      this.persistAgents(updatedAgents);
    }
  }

  // Persistence methods
  private loadPersistedData(): void {
    try {
      // Load debug mode setting
      const debugMode = localStorage.getItem('debug-mode');
      if (debugMode) {
        this.debugMode = debugMode === 'true';
      }
      
      // Load agents
      const agentsData = localStorage.getItem('minion-command-agents');
      if (agentsData) {
        const agents = JSON.parse(agentsData).map((agent: any) => ({
          ...agent,
          startTime: agent.startTime ? new Date(agent.startTime) : undefined,
          lastActivity: agent.lastActivity ? new Date(agent.lastActivity) : undefined
        }));
        this.agents$.next(agents);
      }

      // Load logs
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

  private handleAgentDisconnect(data: any): void {
    const agents = this.agents$.value;
    const filteredAgents = agents.filter(agent => agent.id !== data.agentId);
    
    if (filteredAgents.length !== agents.length) {
      console.log(`Removing disconnected agent: ${data.agentId}`);
      this.agents$.next(filteredAgents);
      this.persistAgents(filteredAgents);
      
      // Add notification
      const notifications = this.notifications$.value;
      notifications.push({
        type: 'info',
        message: `Agent ${this.formatAgentId(data.agentId)} disconnected`,
        timestamp: new Date(),
        duration: 5000
      });
      this.notifications$.next(notifications);
    }
  }

  private formatAgentId(id: string): string {
    // Extract last 6 digits from agent ID (e.g., "claude-pid-12345" -> "12345" -> "12345")
    if (!id) return 'Unknown';
    
    // Remove "claude-" prefix if present
    const cleanId = id.replace(/^claude-/, '');
    
    // If it's a PID format (pid-12345), extract the number
    if (cleanId.startsWith('pid-')) {
      const pidNumber = cleanId.substring(4);
      // Return last 6 digits
      return pidNumber.length > 6 ? pidNumber.slice(-6) : pidNumber;
    }
    
    // For other formats, return last 6 characters
    return cleanId.length > 6 ? cleanId.slice(-6) : cleanId;
  }





  // Public methods
  getAgents(): Observable<Agent[]> {
    return this.agents$.asObservable();
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
      map(logs => [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()))
    );
  }
  
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
  
  getNotifications(): Observable<Notification[]> {
    return this.notifications$.asObservable();
  }
  
  clearNotifications(): void {
    this.notifications$.next([]);
  }

  getAgentLogs(agentId: string): Observable<LogEntry[]> {
    return this.logs$.pipe(
      map(logs => logs
        .filter(log => log.agentId === agentId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      )
    );
  }

  // Control methods
  pauseAgent(agentId: string): void {
    this.websocket.pauseAgent(agentId);
  }

  resumeAgent(agentId: string): void {
    this.websocket.resumeAgent(agentId);
  }

  reassignTask(taskId: string, newAgentId: string): void {
    this.websocket.reassignTask(taskId, newAgentId);
  }

  removeAgent(agentId: string): void {
    const agents = this.agents$.value;
    const filteredAgents = agents.filter(agent => agent.id !== agentId);
    this.agents$.next(filteredAgents);
    this.persistAgents(filteredAgents);
  }

  clearAllAgents(): void {
    this.agents$.next([]);
    this.persistAgents([]);
  }

  getFormattedAgentId(id: string): string {
    return this.formatAgentId(id);
  }

  getAgentColor(agentId: string): string {
    const AGENT_COLORS = [
      '#E53E3E', // Bright Red
      '#38A169', // Forest Green  
      '#3182CE', // Royal Blue
      '#7c3aed', // Purple
      '#8A2BE2', // Blue Violet
      '#00CED1', // Dark Turquoise
      '#DC143C', // Crimson
      '#228B22', // Forest Green (different shade)
      '#4169E1', // Royal Blue (different shade)
      '#FF1493'  // Deep Pink
    ];

    // Handle null/undefined agentId
    if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
      return AGENT_COLORS[0]; // Return first color as default
    }

    // Simple modulo based on agent ID - just use the last few characters
    const lastChars = agentId.slice(-4); // Get last 4 characters
    const numValue = parseInt(lastChars, 36) || 0; // Base 36 to handle letters too
    return AGENT_COLORS[numValue % AGENT_COLORS.length];
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    localStorage.setItem('debug-mode', enabled.toString());
    console.log(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  isDebugMode(): boolean {
    return this.debugMode;
  }


  // Get connection status
  isConnected(): Observable<boolean> {
    return this.websocket.isConnected$;
  }

  // Cleanup
  ngOnDestroy(): void {
    if (this.wsSubscription) {
      this.wsSubscription.unsubscribe();
    }
    if (this.retryInterval) {
      this.retryInterval.unsubscribe();
    }
    this.websocket.disconnect();
  }
}