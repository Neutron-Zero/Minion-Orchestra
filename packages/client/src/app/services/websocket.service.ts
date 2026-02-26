import { Injectable } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

export interface AgentMessage {
  type: 'agent_update' | 'task_update' | 'log' | 'metrics' | 'error' | 'agent_disconnect' | 'stop';
  agentId?: string;
  data: any;
  timestamp: Date;
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket?: Socket;
  private messagesSubject = new Subject<AgentMessage>();
  private connectionStatus = new BehaviorSubject<boolean>(false);
  
  messages$ = this.messagesSubject.asObservable();
  isConnected$ = this.connectionStatus.asObservable();

  constructor() { 
    console.log('WebsocketService constructor called');
  }

  connect(url: string = 'http://localhost:3000'): void {
    if (this.socket?.connected) {
      console.log('WebSocket already connected, skipping');
      return;
    }
    
    if (this.socket) {
      console.log('Disconnecting existing socket before reconnecting');
      this.socket.disconnect();
    }

    this.socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.connectionStatus.next(true);
      this.socket?.emit('subscribe', { type: 'agent_monitor' });
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.connectionStatus.next(false);
    });

    this.socket.on('agent_update', (data: any) => {
      this.messagesSubject.next({
        type: 'agent_update',
        agentId: data.agentId,
        data,
        timestamp: new Date()
      });
    });

    this.socket.on('task_update', (data: any) => {
      this.messagesSubject.next({
        type: 'task_update',
        data,
        timestamp: new Date()
      });
    });

    this.socket.on('log', (data: any) => {
      this.messagesSubject.next({
        type: 'log',
        agentId: data.agentId,
        data,
        timestamp: new Date()
      });
    });

    this.socket.on('metrics', (data: any) => {
      this.messagesSubject.next({
        type: 'metrics',
        data,
        timestamp: new Date()
      });
    });

    this.socket.on('agent_disconnect', (data: any) => {
      this.messagesSubject.next({
        type: 'agent_disconnect',
        agentId: data.agentId,
        data,
        timestamp: new Date()
      });
    });

    this.socket.on('stop', (data: any) => {
      this.messagesSubject.next({
        type: 'stop',
        agentId: data.agentId,
        data,
        timestamp: new Date()
      });
    });

    this.socket.on('error', (error: any) => {
      console.error('WebSocket error:', error);
      this.messagesSubject.next({
        type: 'error',
        data: error,
        timestamp: new Date()
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = undefined;
    }
  }

  emit(event: string, data: any): void {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    }
  }

  // Task management methods
  pauseAgent(agentId: string): void {
    this.emit('pause_agent', { agentId });
  }

  resumeAgent(agentId: string): void {
    this.emit('resume_agent', { agentId });
  }

  reassignTask(taskId: string, newAgentId: string): void {
    this.emit('reassign_task', { taskId, newAgentId });
  }

  requestLogs(agentId: string, limit: number = 100): void {
    this.emit('get_logs', { agentId, limit });
  }
}