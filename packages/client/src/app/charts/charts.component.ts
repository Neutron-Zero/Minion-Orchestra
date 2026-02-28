import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { AgentMonitorService, Agent, LogEntry } from '../services/agent-monitor.service';
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
  @ViewChild('pulseCanvas') pulseCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('performanceCanvas') performanceCanvas!: ElementRef<HTMLCanvasElement>;

  private activityChart?: Chart;
  private pulseChart?: Chart;
  private performanceChart?: Chart;
  private agentSub?: Subscription;
  private logSub?: Subscription;

  private history: { timestamp: string; active: number; completed: number }[] = [];
  private pulseHistory: { timestamp: number; toolActivity: number; logActivity: number; statusChanges: number }[] = [];
  private maxDataPoints = 20;
  private maxPulsePoints = 50;

  constructor(private agentService: AgentMonitorService) {}

  ngOnInit(): void {
    this.agentSub = this.agentService.getAgents().subscribe(agents => {
      this.updateCharts(agents);
      this.updatePulseChart(agents);
    });

    this.logSub = this.agentService.getLogs().subscribe(logs => {
      this.updatePulseFromLogs(logs);
    });
  }

  ngAfterViewInit(): void {
    this.initializeCharts();
  }

  ngOnDestroy(): void {
    this.agentSub?.unsubscribe();
    this.logSub?.unsubscribe();
    this.activityChart?.destroy();
    this.pulseChart?.destroy();
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

    this.pulseChart = new Chart(this.pulseCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Tool Activity',
            data: [],
            borderColor: '#E53E3E',
            backgroundColor: 'rgba(229, 62, 62, 0.15)',
            tension: 0.4, borderWidth: 3, fill: true,
            pointRadius: 0, pointHoverRadius: 4
          },
          {
            label: 'Log Activity',
            data: [],
            borderColor: '#38A169',
            backgroundColor: 'rgba(56, 161, 105, 0.15)',
            tension: 0.4, borderWidth: 2, fill: true,
            pointRadius: 0, pointHoverRadius: 4
          },
          {
            label: 'Status Changes',
            data: [],
            borderColor: '#3182CE',
            backgroundColor: 'rgba(49, 130, 206, 0.15)',
            tension: 0.4, borderWidth: 2, fill: true,
            pointRadius: 0, pointHoverRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { intersect: false, mode: 'index' },
        scales: {
          x: { display: false, grid: { display: false } },
          y: {
            beginAtZero: true, max: 10,
            ticks: { color: '#ffffff', stepSize: 2 },
            grid: { color: 'rgba(255,255,255,0.1)' }
          }
        },
        plugins: {
          title: { display: false },
          legend: {
            position: 'bottom',
            labels: { color: '#ffffff', usePointStyle: true, pointStyle: 'circle' }
          }
        }
      }
    });

    this.performanceChart = new Chart(this.performanceCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: ['Idle', 'Working', 'Completed', 'Failed'],
        datasets: [{
          data: [0, 0, 0, 0],
          backgroundColor: ['#6366f1', '#4caf50', '#2196f3', '#f44336'],
          borderColor: ['#6366f1', '#4caf50', '#2196f3', '#f44336'],
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

    const statusCounts = {
      idle: agents.filter(a => a.status === 'idle').length,
      working: agents.filter(a => a.status === 'working').length,
      completed: agents.filter(a => a.status === 'completed').length,
      failed: agents.filter(a => a.status === 'failed').length
    };

    if (this.performanceChart.canvas) {
      this.performanceChart.data.datasets[0].data = [
        statusCounts.idle, statusCounts.working, statusCounts.completed, statusCounts.failed
      ];
      this.performanceChart.update();
    }
  }

  private updatePulseChart(agents: Agent[]): void {
    if (!this.pulseChart) return;

    const now = Date.now();
    const toolActivity = agents.filter(a => a.currentTool && a.status === 'working').length;
    const statusChanges = agents.filter(a => {
      if (!a.lastActivity) return false;
      return (now - new Date(a.lastActivity).getTime()) < 10000;
    }).length;

    this.pulseHistory.push({
      timestamp: now,
      toolActivity: toolActivity * 2,
      logActivity: 0,
      statusChanges: statusChanges * 1.5
    });

    if (this.pulseHistory.length > this.maxPulsePoints) {
      this.pulseHistory.shift();
    }

    const labels = this.pulseHistory.map((_, i) => i.toString());
    this.pulseChart.data.labels = labels;
    this.pulseChart.data.datasets[0].data = this.pulseHistory.map(h => h.toolActivity);
    this.pulseChart.data.datasets[1].data = this.pulseHistory.map(h => h.logActivity);
    this.pulseChart.data.datasets[2].data = this.pulseHistory.map(h => h.statusChanges);

    if (this.pulseChart.canvas) {
      this.pulseChart.update('none');
    }
  }

  private updatePulseFromLogs(logs: LogEntry[]): void {
    if (!this.pulseChart || this.pulseHistory.length === 0) return;

    const now = Date.now();
    const recentLogs = logs.filter(log => (now - new Date(log.timestamp).getTime()) < 5000);

    const lastIndex = this.pulseHistory.length - 1;
    this.pulseHistory[lastIndex].logActivity = Math.min(recentLogs.length, 10);
    this.pulseChart.data.datasets[1].data = this.pulseHistory.map(h => h.logActivity);

    if (this.pulseChart.canvas) {
      this.pulseChart.update('none');
    }
  }
}
