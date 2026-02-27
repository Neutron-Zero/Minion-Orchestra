import { Component, OnInit } from '@angular/core';
import { WebsocketService } from '../services/websocket.service';
import { AgentMonitorService } from '../services/agent-monitor.service';

@Component({
  selector: 'app-settings-page',
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.scss']
})
export class SettingsPageComponent implements OnInit {
  // Existing settings
  logRetention = 1000;
  updateInterval = 5000;
  cleanupInterval = 5000;
  autoRetry = true;
  debugMode = false;
  connectionStatus$ = this.websocketService.isConnected$;

  // Terminal settings
  terminalAutoDetect = true;
  terminalPreferred = 'auto';

  // Session discovery settings
  watcherEnabled = true;

  // Notification settings
  notificationsEnabled = true;
  notifyMacOS = true;
  notifyOnWaiting = true;
  notifyOnFailed = true;
  notifyOnCompleted = false;
  notifyOnPermission = true;

  // Section nav
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

  private serverUrl = 'http://localhost:3000';

  scrollToSection(key: string): void {
    this.activeSection = key;
    const el = document.getElementById('section-' + key);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  constructor(
    private websocketService: WebsocketService,
    private agentService: AgentMonitorService
  ) { }

  ngOnInit(): void {
    // Load saved settings from localStorage
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

    // Load server-side config
    this.loadServerConfig();
  }

  async loadServerConfig(): Promise<void> {
    try {
      const response = await fetch(`${this.serverUrl}/api/config`);
      const data = await response.json();
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
      }
    } catch (error) {
      console.error('Error loading server config:', error);
    }
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

  private async patchConfig(body: any): Promise<void> {
    try {
      await fetch(`${this.serverUrl}/api/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (error) {
      console.error('Error updating config:', error);
    }
  }

  // Existing methods (unchanged)
  injectTestLog(level: string): void {
    const testMessages: Record<string, string> = {
      info: 'Test info log entry - system is working correctly',
      warning: 'Test warning log entry - this is a simulated warning',
      error: 'Test error log entry - this is a simulated error for testing'
    };
    const message = testMessages[level] || 'Test log entry';
    this.websocketService.emit('test_log', {
      level, message, agentId: 'Settings-Test', timestamp: new Date().toISOString()
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
    setTimeout(() => {
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
