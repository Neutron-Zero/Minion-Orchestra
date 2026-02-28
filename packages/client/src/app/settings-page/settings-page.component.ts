import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { WebsocketService } from '../services/websocket.service';
import { AgentMonitorService } from '../services/agent-monitor.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-settings-page',
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsPageComponent implements OnInit, OnDestroy {
  logRetention = 1000;
  updateInterval = 5000;
  cleanupInterval = 5000;
  autoRetry = true;
  debugMode = false;
  isConnected = false;

  terminalAutoDetect = true;
  terminalPreferred = 'auto';
  watcherEnabled = true;

  notificationsEnabled = true;
  notifyMacOS = true;
  notifyOnWaiting = true;
  notifyOnFailed = true;
  notifyOnCompleted = false;
  notifyOnPermission = true;

  activeSection = 'connection';
  sections = [
    { key: 'connection', label: 'Connection', icon: 'wifi' },
    { key: 'monitoring', label: 'Monitoring', icon: 'monitor_heart' },
    { key: 'terminal', label: 'Terminal', icon: 'terminal' },
    { key: 'discovery', label: 'Discovery', icon: 'search' },
    { key: 'notifications', label: 'Notifications', icon: 'notifications' },
    { key: 'storage', label: 'Storage', icon: 'storage' },
    { key: 'debug', label: 'Debug', icon: 'bug_report' },
  ];

  private connSub?: Subscription;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private http: HttpClient,
    private websocketService: WebsocketService,
    private agentService: AgentMonitorService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const savedRetention = localStorage.getItem('logRetention');
    const savedInterval = localStorage.getItem('updateInterval');
    const savedCleanupInterval = localStorage.getItem('cleanup-interval');
    const savedAutoRetry = localStorage.getItem('autoRetry');
    const savedDebugMode = localStorage.getItem('debug-mode');

    if (savedRetention) this.logRetention = parseInt(savedRetention);
    if (savedInterval) this.updateInterval = parseInt(savedInterval);
    if (savedCleanupInterval) this.cleanupInterval = parseInt(savedCleanupInterval);
    if (savedAutoRetry) this.autoRetry = savedAutoRetry === 'true';
    if (savedDebugMode) this.debugMode = savedDebugMode === 'true';

    this.connSub = this.websocketService.isConnected$.subscribe(connected => {
      this.isConnected = connected;
      this.cdr.markForCheck();
    });

    this.loadServerConfig();
  }

  ngOnDestroy(): void {
    this.connSub?.unsubscribe();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
  }

  scrollToSection(key: string): void {
    this.activeSection = key;
    const el = document.getElementById('section-' + key);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  trackBySection(index: number, section: { key: string }): string {
    return section.key;
  }

  loadServerConfig(): void {
    this.http.get<any>(`${environment.serverUrl}/api/config`).subscribe({
      next: (data) => {
        if (data.success && data.config) {
          const cfg = data.config;
          if (cfg.notifications) {
            this.notificationsEnabled = cfg.notifications.enabled !== false;
            this.notifyMacOS = cfg.notifications.macos_native !== false;
            this.notifyOnWaiting = cfg.notifications.on_waiting !== false;
            this.notifyOnFailed = cfg.notifications.on_failed !== false;
            this.notifyOnCompleted = cfg.notifications.on_completed === true;
            this.notifyOnPermission = cfg.notifications.on_permission_request !== false;
          }
          if (cfg.terminal) {
            this.terminalAutoDetect = cfg.terminal.auto_detect !== false;
            this.terminalPreferred = cfg.terminal.preferred || 'auto';
          }
          if (cfg.session_watcher) {
            this.watcherEnabled = cfg.session_watcher.enabled !== false;
          }
          this.cdr.markForCheck();
        }
      }
    });
  }

  updateNotificationPref(key: string, value: boolean): void {
    this.patchConfig({ notifications: { [key]: value } });
  }

  updateTerminalPref(key: string, value: any): void {
    this.patchConfig({ terminal: { [key]: value } });
  }

  updateWatcherPref(key: string, value: any): void {
    this.patchConfig({ session_watcher: { [key]: value } });
  }

  private patchConfig(body: Record<string, any>): void {
    this.http.patch(`${environment.serverUrl}/api/config`, body).subscribe();
  }

  injectTestLog(level: string): void {
    const testMessages: Record<string, string> = {
      info: 'Test info log entry - system is working correctly',
      warning: 'Test warning log entry - this is a simulated warning',
      error: 'Test error log entry - this is a simulated error for testing'
    };
    this.websocketService.emit('test_log', {
      level, message: testMessages[level] || 'Test log entry',
      agentId: 'Settings-Test', timestamp: new Date().toISOString()
    });
  }

  updateLogRetention(): void {
    this.agentService.setLogRetention(this.logRetention);
    localStorage.setItem('logRetention', this.logRetention.toString());
  }

  updateUpdateInterval(): void {
    this.agentService.setUpdateInterval(this.updateInterval);
    localStorage.setItem('updateInterval', this.updateInterval.toString());
  }

  toggleAutoRetry(): void {
    localStorage.setItem('autoRetry', this.autoRetry.toString());
  }

  clearAllLogs(): void {
    if (confirm('Are you sure you want to clear all logs?')) {
      this.agentService.clearLogs();
    }
  }

  reconnectServer(): void {
    this.websocketService.disconnect();
    this.reconnectTimer = setTimeout(() => {
      this.websocketService.connect();
    }, 1000);
  }

  updateCleanupInterval(): void {
    this.agentService.updateCleanupInterval(this.cleanupInterval);
  }

  toggleDebugMode(): void {
    this.agentService.setDebugMode(this.debugMode);
  }
}
