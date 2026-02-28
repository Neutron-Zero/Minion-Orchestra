import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { AgentMonitorService, Agent } from '../services/agent-monitor.service';
import { Observable, Subscription } from 'rxjs';
import { Router } from '@angular/router';

@Component({
  selector: 'app-analytics',
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  agents$: Observable<Agent[]>;
  workingCount = 0;
  agentCount = 0;

  private subscription?: Subscription;

  constructor(
    private agentService: AgentMonitorService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    this.agents$ = this.agentService.getAgents();
  }

  ngOnInit(): void {
    this.subscription = this.agents$.subscribe(agents => {
      this.agentCount = agents.length;
      this.workingCount = agents.filter(a => a.status === 'working').length;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  focusAgent(agent: Agent): void {
    this.agentService.focusAgent(agent.id);
  }

  pauseAgent(agent: Agent): void {
    this.agentService.pauseAgent(agent.id);
  }

  resumeAgent(agent: Agent): void {
    this.agentService.resumeAgent(agent.id);
  }

  removeAgent(agent: Agent): void {
    this.agentService.removeAgent(agent.id);
  }
}
