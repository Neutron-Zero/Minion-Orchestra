import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { AgentMonitorService, Agent } from '../services/agent-monitor.service';
import { Observable, Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { AgentTimelineComponent } from '../agent-timeline/agent-timeline.component';

type ViewType = 'kanban' | 'timeline';
const VIEW_TYPE_KEY = 'mo_agents_view_type';
const TIME_RANGE_KEY = 'mo_timeline_range';

@Component({
  selector: 'app-analytics',
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  @ViewChild('timelineRef') timelineRef?: AgentTimelineComponent;

  agents$: Observable<Agent[]>;
  workingCount = 0;
  agentCount = 0;
  viewType: ViewType = 'kanban';
  selectedRange = 5;

  timeRanges = [
    { label: '1m', minutes: 1 },
    { label: '5m', minutes: 5 },
    { label: '10m', minutes: 10 },
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '6h', minutes: 360 },
    { label: '12h', minutes: 720 },
    { label: '24h', minutes: 1440 },
  ];

  private subscription?: Subscription;

  constructor(
    private agentService: AgentMonitorService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    this.agents$ = this.agentService.getAgents();
    const saved = localStorage.getItem(VIEW_TYPE_KEY);
    if (saved === 'kanban' || saved === 'timeline') {
      this.viewType = saved;
    }
    const savedRange = localStorage.getItem(TIME_RANGE_KEY);
    if (savedRange) {
      this.selectedRange = parseInt(savedRange, 10) || 5;
    }
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

  setViewType(type: ViewType): void {
    this.viewType = type;
    localStorage.setItem(VIEW_TYPE_KEY, type);
    this.cdr.markForCheck();
  }

  setTimeRange(minutes: number): void {
    this.selectedRange = minutes;
    localStorage.setItem(TIME_RANGE_KEY, String(minutes));
    this.timelineRef?.setRange(minutes);
    this.cdr.markForCheck();
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

  viewAgentDetails(agent: Agent): void {
    this.router.navigate(['/agent', agent.id]);
  }

  approveAgent(agent: Agent): void {
    this.agentService.sendAgentInput(agent.id, 'y');
  }

  denyAgent(agent: Agent): void {
    this.agentService.sendAgentInput(agent.id, 'n');
  }

  sendAgentInput(event: { agent: Agent; text: string }): void {
    this.agentService.sendAgentInput(event.agent.id, event.text);
  }
}
