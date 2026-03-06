import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpResponse } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { DemoService } from './demo.service';
import {
  getDemoEvents, getDemoTranscript, getDemoHeatmapData,
  getDemoDailyData, getDemoSessions, getDemoPrompts, getDemoAgents, getDemoLogs,
} from './demo-data';

@Injectable()
export class DemoInterceptor implements HttpInterceptor {
  constructor(private demo: DemoService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.demo.isDemoMode) {
      return next.handle(req);
    }

    const url = req.url;

    // /api/events
    if (url.includes('/api/events')) {
      return of(new HttpResponse({ status: 200, body: { success: true, events: getDemoEvents() } }));
    }

    // /api/agents/:id/transcript
    if (url.match(/\/api\/agents\/[^/]+\/transcript/)) {
      const agentId = url.split('/api/agents/')[1].split('/transcript')[0];
      const allTranscript = getDemoTranscript();
      const entries = allTranscript.filter(e => e.agent_id === agentId);
      return of(new HttpResponse({ status: 200, body: { success: true, entries } }));
    }

    // /api/agents/:id
    if (url.match(/\/api\/agents\/[^/]+$/) || url.match(/\/api\/agents\/[^/]+\?/)) {
      const agentId = url.split('/api/agents/')[1].split('?')[0];
      const agents = getDemoAgents();
      const agent = agents.find(a => a.id === agentId);
      const events = getDemoEvents().filter(e => e.agent_id === agentId);
      const logs = getDemoLogs().filter(l => l.agentId === agentId);
      return of(new HttpResponse({ status: 200, body: { success: true, agent: agent || null, logs, events } }));
    }

    // /api/insights/daily
    if (url.includes('/api/insights/daily')) {
      return of(new HttpResponse({ status: 200, body: { success: true, daily: getDemoDailyData() } }));
    }

    // /api/insights/heatmap
    if (url.includes('/api/insights/heatmap')) {
      return of(new HttpResponse({ status: 200, body: { success: true, heatmap: getDemoHeatmapData() } }));
    }

    // /api/history
    if (url.includes('/api/history')) {
      const sessions = getDemoSessions();
      return of(new HttpResponse({ status: 200, body: { success: true, sessions, total: sessions.length } }));
    }

    // /api/prompts
    if (url.includes('/api/prompts')) {
      return of(new HttpResponse({ status: 200, body: { success: true, prompts: getDemoPrompts() } }));
    }

    // /api/plans
    if (url.includes('/api/plans')) {
      return of(new HttpResponse({ status: 200, body: { success: true, plans: [] } }));
    }

    // /api/config
    if (url.includes('/api/config') || url.includes('/config')) {
      if (req.method === 'GET') {
        return of(new HttpResponse({ status: 200, body: { success: true, config: {} } }));
      }
      return of(new HttpResponse({ status: 200, body: { success: true } }));
    }

    // /api/actions/* -- no-op in demo
    if (url.includes('/api/actions/')) {
      return of(new HttpResponse({ status: 200, body: { success: true } }));
    }

    return next.handle(req);
  }
}
