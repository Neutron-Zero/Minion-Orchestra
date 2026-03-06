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

  private history: { timestamp: string; idle: number; working: number; waiting: number; failed: number }[] = [];
  private maxDataPoints = 21;

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
    // Pre-fill history so all labels show immediately
    for (let i = 0; i < this.maxDataPoints; i++) {
      this.history.push({ timestamp: '', idle: 0, working: 0, waiting: 0, failed: 0 });
    }
    const xLabels = this.history.map((_, i) => {
      const secsAgo = this.maxDataPoints - 1 - i;
      return secsAgo === 0 ? '0s' : `-${secsAgo}s`;
    });

    this.activityChart = new Chart(this.activityCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          {
            label: '  Idle',
            data: [],
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.3)',
            tension: 0.3, borderWidth: 2, fill: true,
            pointRadius: 0, pointHoverRadius: 4
          },
          {
            label: '  Working',
            data: [],
            borderColor: '#4caf50',
            backgroundColor: 'rgba(76, 175, 80, 0.3)',
            tension: 0.3, borderWidth: 2, fill: true,
            pointRadius: 0, pointHoverRadius: 4
          },
          {
            label: '  Waiting for Input',
            data: [],
            borderColor: '#ffc107',
            backgroundColor: 'rgba(255, 193, 7, 0.3)',
            tension: 0.3, borderWidth: 2, fill: true,
            pointRadius: 0, pointHoverRadius: 4
          },
          {
            label: '  Failed',
            data: [],
            borderColor: '#f44336',
            backgroundColor: 'rgba(244, 67, 54, 0.3)',
            tension: 0.3, borderWidth: 2, fill: true,
            pointRadius: 0, pointHoverRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              color: 'rgba(255,255,255,0.5)',
              font: { size: 12 },
              autoSkip: false,
              callback: function(value: any, index: number, ticks: any[]) {
                const total = ticks.length;
                if (index === 0 || index === total - 1 || index % 5 === 0) {
                  const secsAgo = total - 1 - index;
                  return secsAgo === 0 ? '0s' : `-${secsAgo}s`;
                }
                return '';
              }
            },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 12 }, stepSize: 1 },
            grid: { color: 'rgba(255,255,255,0.1)' }
          }
        },
        plugins: {
          title: { display: false },
          legend: { position: 'bottom', labels: { color: '#ffffff', usePointStyle: true, pointStyle: 'circle', padding: 20 } }
        }
      }
    });

    this.performanceChart = new Chart(this.performanceCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: ['  Idle', '  Working', '  Waiting for Input', '  Failed'],
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
          legend: { position: 'bottom', labels: { color: '#ffffff', usePointStyle: true, pointStyle: 'circle', padding: 20 } }
        }
      }
    });
  }

  private updateCharts(agents: Agent[]): void {
    if (!this.activityChart || !this.performanceChart) return;

    const timestamp = new Date().toLocaleTimeString();
    const waitingStatuses = ['waiting', 'awaiting-permission', 'permission-requested'];
    const statusCounts = {
      idle: agents.filter(a => a.status === 'idle').length,
      working: agents.filter(a => a.status === 'working').length,
      waiting: agents.filter(a => waitingStatuses.includes(a.status)).length,
      failed: agents.filter(a => a.status === 'failed').length,
    };

    this.history.push({ timestamp, ...statusCounts });
    if (this.history.length > this.maxDataPoints) {
      this.history.shift();
    }

    if (this.activityChart.canvas) {
      this.activityChart.data.labels = this.history.map((_, i) => {
        const secsAgo = this.maxDataPoints - 1 - i;
        return secsAgo === 0 ? '0s' : `-${secsAgo}s`;
      });
      this.activityChart.data.datasets[0].data = this.history.map(h => h.idle);
      this.activityChart.data.datasets[1].data = this.history.map(h => h.working);
      this.activityChart.data.datasets[2].data = this.history.map(h => h.waiting);
      this.activityChart.data.datasets[3].data = this.history.map(h => h.failed);
      this.activityChart.update();
    }

    if (this.performanceChart.canvas) {
      this.performanceChart.data.datasets[0].data = [
        statusCounts.idle, statusCounts.working, statusCounts.waiting, statusCounts.failed
      ];
      this.performanceChart.update();
    }
  }
}
