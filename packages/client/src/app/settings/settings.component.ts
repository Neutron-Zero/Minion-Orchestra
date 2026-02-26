import { Component, OnInit } from '@angular/core';
import { AgentMonitorService } from '../services/agent-monitor.service';
import { WebsocketService } from '../services/websocket.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit {
  isConnected = false;
  connectionStatus = 'Connecting...';
  serverUrl = 'http://localhost:3000';
  
  constructor(
    private agentService: AgentMonitorService,
    private websocketService: WebsocketService
  ) {}

  ngOnInit(): void {
    // Subscribe to WebSocket connection status
    this.websocketService.isConnected$.subscribe(connected => {
      this.isConnected = connected;
      this.connectionStatus = connected ? 'Connected' : 'Disconnected';
    });
  }

  getConnectionStatusClass(): string {
    return this.isConnected ? 'connected' : 'disconnected';
  }

  getConnectionStatusIcon(): string {
    return this.isConnected ? 'check_circle' : 'error';
  }
}