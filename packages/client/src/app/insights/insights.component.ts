import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription, forkJoin } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { AgentMonitorService, Agent, LogEntry } from '../services/agent-monitor.service';
import { environment } from '../../environments/environment';

Chart.register(...registerables);

interface DailyEntry { date: string; count: number; }
interface HeatmapEntry { key: string; count: number; }
interface HeatmapCell { label: string; count: number; color: string; }
interface HeatmapRow { label: string; cells: HeatmapCell[]; }

interface InsightsStats {
  totalSessions: number;
  totalEvents: number;
  mostActiveDay: string;
}

@Component({
  selector: 'app-insights',
  templateUrl: './insights.component.html',
  styleUrls: ['./insights.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InsightsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('dailyCanvas') dailyCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('pulseCanvas') pulseCanvas!: ElementRef<HTMLCanvasElement>;

  dailyData: DailyEntry[] = [];
  heatmapRows: HeatmapRow[] = [];
  heatmapDayLabels: string[] = [];
  legendColors: string[] = [
    'rgba(255, 255, 255, 0.03)',
    'rgba(124, 58, 237, 0.2)',
    'rgba(124, 58, 237, 0.4)',
    'rgba(124, 58, 237, 0.6)',
    'rgba(124, 58, 237, 0.85)',
  ];
  stats: InsightsStats = {
    totalSessions: 0,
    totalEvents: 0,
    mostActiveDay: '-'
  };

  private dailyChart?: Chart;
  private pulseChart?: Chart;
  private agentSub?: Subscription;
  private logSub?: Subscription;
  private pulseHistory: { timestamp: number; toolActivity: number; logActivity: number; statusChanges: number }[] = [];
  private maxPulsePoints = 50;

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private agentService: AgentMonitorService
  ) {}

  ngOnInit(): void {
    this.loadInsights();

    this.agentSub = this.agentService.getAgents().subscribe(agents => {
      this.updatePulseChart(agents);
    });

    this.logSub = this.agentService.getLogs().subscribe(logs => {
      this.updatePulseFromLogs(logs);
    });
  }

  ngAfterViewInit(): void {
    this.initPulseChart();
  }

  ngOnDestroy(): void {
    this.dailyChart?.destroy();
    this.pulseChart?.destroy();
    this.agentSub?.unsubscribe();
    this.logSub?.unsubscribe();
  }

  loadInsights(): void {
    forkJoin({
      daily: this.http.get<any>(`${environment.serverUrl}/api/insights/daily`, { params: { days: 30 } }),
      heatmap: this.http.get<any>(`${environment.serverUrl}/api/insights/heatmap`),
    }).subscribe({
      next: ({ daily, heatmap }) => {
        if (daily.success) this.dailyData = daily.daily || [];
        if (heatmap.success) {
          this.buildHeatmapRows(heatmap.heatmap || []);
        }
        this.computeStats();
        this.cdr.markForCheck();
        setTimeout(() => this.createDailyChart(), 100);
      },
      error: (err) => console.error('Error loading insights:', err)
    });
  }

  private computeStats(): void {
    this.stats.totalEvents = this.dailyData.reduce((sum, d) => sum + d.count, 0);
    this.stats.totalSessions = this.dailyData.filter(d => d.count > 0).length;

    if (this.dailyData.length > 0) {
      const maxDay = this.dailyData.reduce((max, d) => d.count > max.count ? d : max, this.dailyData[0]);
      this.stats.mostActiveDay = maxDay.date.slice(5);
    }
  }

  private initPulseChart(): void {
    if (!this.pulseCanvas) return;

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
            ticks: { color: 'rgba(255,255,255,0.5)', stepSize: 2, font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.1)' }
          }
        },
        plugins: {
          title: { display: false },
          legend: {
            position: 'bottom',
            labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' }
          }
        }
      }
    });
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

  private createDailyChart(): void {
    if (!this.dailyCanvas || this.dailyData.length === 0) return;
    this.dailyChart?.destroy();

    this.dailyChart = new Chart(this.dailyCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: this.dailyData.map(d => d.date.slice(5)),
        datasets: [{
          label: 'Events',
          data: this.dailyData.map(d => d.count),
          backgroundColor: 'rgba(124, 58, 237, 0.6)',
          borderColor: '#7c3aed',
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
            grid: { display: false }
          },
          y: {
            ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    });
  }

  private buildHeatmapRows(heatmapData: HeatmapEntry[]): void {
    // Build lookup: "YYYY-MM-DD|HH" -> count
    const lookup = new Map<string, number>();
    for (const entry of heatmapData) {
      const parts = entry.key.split('T');
      if (parts.length < 2) continue;
      const key = `${parts[0]}|${parseInt(parts[1])}`;
      lookup.set(key, (lookup.get(key) || 0) + entry.count);
    }

    // Generate last 30 days
    const days: string[] = [];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    // Day labels: show date for 1st of each month or every ~5 days
    this.heatmapDayLabels = days.map((dateStr, i) => {
      const d = new Date(dateStr + 'T00:00:00');
      const dayNum = d.getDate();
      if (dayNum === 1 || i === 0 || i % 5 === 0) {
        return `${months[d.getMonth()]} ${dayNum}`;
      }
      return '';
    });

    // Compute counts first to find max
    const hourLabels = ['12a','2a','4a','6a','8a','10a','12p','2p','4p','6p','8p','10p'];
    const grid: { label: string; count: number }[][] = [];
    let maxCount = 0;
    for (let row = 0; row < 12; row++) {
      const h = row * 2;
      grid.push(days.map(dateStr => {
        const count = (lookup.get(`${dateStr}|${h}`) || 0) + (lookup.get(`${dateStr}|${h + 1}`) || 0);
        if (count > maxCount) maxCount = count;
        return {
          label: `${dateStr} ${h.toString().padStart(2, '0')}:00-${(h + 1).toString().padStart(2, '0')}:59`,
          count
        };
      }));
    }

    // Build rows with dynamic color scaling
    this.heatmapRows = grid.map((cells, row) => ({
      label: hourLabels[row],
      cells: cells.map(cell => ({
        ...cell,
        color: this.getHeatmapColor(cell.count, maxCount)
      }))
    }));
  }

  private getHeatmapColor(count: number, max: number): string {
    if (count === 0) return 'rgba(255, 255, 255, 0.03)';
    // Square root scale to spread color range across skewed data
    const ratio = Math.sqrt(count / max);
    if (ratio <= 0.25) return 'rgba(124, 58, 237, 0.2)';
    if (ratio <= 0.5) return 'rgba(124, 58, 237, 0.4)';
    if (ratio <= 0.75) return 'rgba(124, 58, 237, 0.6)';
    return 'rgba(124, 58, 237, 0.85)';
  }

  trackByRow(index: number): number {
    return index;
  }

  trackByCell(index: number): number {
    return index;
  }
}
