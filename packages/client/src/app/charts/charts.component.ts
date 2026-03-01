import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { AgentMonitorService, Agent } from '../services/agent-monitor.service';
import { Subscription } from 'rxjs';

Chart.register(...registerables);

@Component({
  selector: 'app-charts',
  templateUrl: './charts.component.html',
  styleUrls: ['./charts.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChartsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('activityCanvas') activityCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('performanceCanvas') performanceCanvas!: ElementRef<HTMLCanvasElement>;

  private activityChart?: Chart;
  private performanceChart?: Chart;
  private agentSub?: Subscription;

  private history: { timestamp: string; active: number; completed: number }[] = [];
  private maxDataPoints = 20;

  constructor(private agentService: AgentMonitorService) {}

  ngOnInit(): void {
    this.agentSub = this.agentService.getAgents().subscribe(agents => {
      this.updateCharts(agents);
    });
  }

  ngAfterViewInit(): void {
    this.initializeCharts();
  }

  ngOnDestroy(): void {
    this.agentSub?.unsubscribe();
    this.activityChart?.destroy();
    this.performanceChart?.destroy();
  }

  private initializeCharts(): void {
    this.activityChart = new Chart(this.activityCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Active Agents',
            data: [],
            borderColor: 'rgb(34, 197, 94)',
            backgroundColor: 'rgba(34, 197, 94, 0.3)',
            tension: 0.1,
            borderWidth: 3
          },
          {
            label: 'Completed Tasks',
            data: [],
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.3)',
            tension: 0.1,
            borderWidth: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: '#ffffff' },
            grid: { color: 'rgba(255,255,255,0.2)' }
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#ffffff' },
            grid: { color: 'rgba(255,255,255,0.2)' }
          }
        },
        plugins: {
          title: { display: false },
          legend: { labels: { color: '#ffffff' } }
        }
      }
    });

    this.performanceChart = new Chart(this.performanceCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: ['Idle', 'Working', 'Waiting for Input', 'Failed'],
        datasets: [{
          data: [0, 0, 0, 0],
          backgroundColor: ['#6366f1', '#4caf50', '#ffc107', '#f44336'],
          borderColor: ['#6366f1', '#4caf50', '#ffc107', '#f44336'],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: false },
          legend: { position: 'bottom', labels: { color: '#ffffff' } }
        }
      }
    });
  }

  private updateCharts(agents: Agent[]): void {
    if (!this.activityChart || !this.performanceChart) return;

    const timestamp = new Date().toLocaleTimeString();
    const activeCount = agents.filter(a => a.status === 'working').length;
    const completedCount = agents.filter(a => a.status === 'completed').length;

    this.history.push({ timestamp, active: activeCount, completed: completedCount });
    if (this.history.length > this.maxDataPoints) {
      this.history.shift();
    }

    if (this.activityChart.canvas) {
      this.activityChart.data.labels = this.history.map(h => h.timestamp);
      this.activityChart.data.datasets[0].data = this.history.map(h => h.active);
      this.activityChart.data.datasets[1].data = this.history.map(h => h.completed);
      this.activityChart.update();
    }

    const waitingStatuses = ['waiting', 'awaiting-permission', 'permission-requested'];
    const statusCounts = {
      idle: agents.filter(a => a.status === 'idle').length,
      working: agents.filter(a => a.status === 'working').length,
      waiting: agents.filter(a => waitingStatuses.includes(a.status)).length,
      failed: agents.filter(a => a.status === 'failed').length,
    };

    if (this.performanceChart.canvas) {
      this.performanceChart.data.datasets[0].data = [
        statusCounts.idle, statusCounts.working, statusCounts.waiting, statusCounts.failed
      ];
      this.performanceChart.update();
    }
  }
}
