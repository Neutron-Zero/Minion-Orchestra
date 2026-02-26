import { Component, OnInit } from '@angular/core';
import { WebsocketService } from '../services/websocket.service';
import { AgentMonitorService } from '../services/agent-monitor.service';

@Component({
  selector: 'app-settings-page',
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.scss']
})
export class SettingsPageComponent implements OnInit {
  logRetention = 1000;
  updateInterval = 5000;
  cleanupInterval = 5000;
  autoRetry = true;
  debugMode = false;
  connectionStatus$ = this.websocketService.isConnected$;

  constructor(
    private websocketService: WebsocketService,
    private agentService: AgentMonitorService
  ) { }

  ngOnInit(): void {
    // Load saved settings from localStorage if available
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
  }

  injectTestLog(level: string): void {
    const testMessages = {
      info: 'Test info log entry - system is working correctly',
      warning: 'Test warning log entry - this is a simulated warning',
      error: 'Test error log entry - this is a simulated error for testing'
    };

    const message = testMessages[level as keyof typeof testMessages] || 'Test log entry';
    
    // Use WebSocket to inject a test log
    this.websocketService.emit('test_log', {
      level: level,
      message: message,
      agentId: 'Settings-Test',
      timestamp: new Date().toISOString()
    });
    
    console.log(`Test ${level} log injected via WebSocket`);
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
