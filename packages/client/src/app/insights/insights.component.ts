import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription, forkJoin } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { AgentMonitorService, Agent } from '../services/agent-monitor.service';
import { environment } from '../../environments/environment';
import { TimeRange } from '../shared/time-range-selector/time-range-selector.component';

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
  @ViewChild('statusCanvas') statusCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('statusOverTimeCanvas') statusOverTimeCanvas!: ElementRef<HTMLCanvasElement>;

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

  statusTimeRanges: TimeRange[] = [
    { label: '1m', minutes: 1 },
    { label: '5m', minutes: 5 },
    { label: '15m', minutes: 15 },
    { label: '1h', minutes: 60 },
    { label: '6h', minutes: 360 },
    { label: '12h', minutes: 720 },
    { label: '24h', minutes: 1440 },
  ];
  selectedStatusRange = parseFloat(localStorage.getItem('mo_status_range') || '1');

  heatmapTimeRanges: TimeRange[] = [
    { label: '7d', minutes: 7 },
    { label: '15d', minutes: 15 },
    { label: '30d', minutes: 30 },
  ];
  selectedHeatmapRange = parseInt(localStorage.getItem('mo_heatmap_range') || '30', 10);

  pulseTimeRanges: TimeRange[] = [
    { label: '10s', minutes: 10 / 60 },
    { label: '30s', minutes: 0.5 },
    { label: '1m', minutes: 1 },
    { label: '5m', minutes: 5 },
  ];
  selectedPulseRange = parseFloat(localStorage.getItem('mo_pulse_range') || '1');

  _visibleTicks = new Map<number, string>();
  _pulseVisibleTicks = new Map<number, string>();
  private dailyChart?: Chart;
  private pulseChart?: Chart;
  private statusChart?: Chart;
  private statusOverTimeChart?: Chart;
  private agentSub?: Subscription;
  private statusRefreshTimer?: any;
  private statusStreamTimer?: any;
  private pulseStreamTimer?: any;
  private statusData: { idle: number; working: number; waiting: number; failed: number }[] = [];
  private statusSeeded = false;
  private pulseData: { toolActivity: number; logActivity: number; statusChanges: number }[] = [];
  private pulseSeeded = false;

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private agentService: AgentMonitorService
  ) {}

  ngOnInit(): void {
    this.loadInsights();

    this.agentSub = this.agentService.getAgents().subscribe(agents => {
      this.updateDoughnutChart(agents);
    });
  }

  ngAfterViewInit(): void {
    this.initPulseChart();
    this.initStatusCharts();
    this.loadStatusHistory();
    this.startStatusUpdates();
    this.loadPulseHistory();
    this.startPulseUpdates();
    // Seed doughnut with current data
    this.updateDoughnutChart(this.agentService.getAgentsSnapshot());
  }

  ngOnDestroy(): void {
    this.dailyChart?.destroy();
    this.pulseChart?.destroy();
    this.statusChart?.destroy();
    this.statusOverTimeChart?.destroy();
    this.agentSub?.unsubscribe();
    this.stopStatusUpdates();
    this.stopPulseUpdates();
  }

  setHeatmapRange(days: number): void {
    this.selectedHeatmapRange = days;
    localStorage.setItem('mo_heatmap_range', String(days));
    this.loadHeatmap();
    this.cdr.markForCheck();
  }

  setPulseTimeRange(minutes: number): void {
    this.selectedPulseRange = minutes;
    localStorage.setItem('mo_pulse_range', String(minutes));
    this.pulseSeeded = false;
    this.loadPulseHistory();
    this.startPulseUpdates();
    this.cdr.markForCheck();
  }

  setStatusTimeRange(minutes: number): void {
    this.selectedStatusRange = minutes;
    localStorage.setItem('mo_status_range', String(minutes));
    this.statusSeeded = false;
    this.loadStatusHistory();
    this.startStatusUpdates();
    this.cdr.markForCheck();
  }

  private stopStatusUpdates(): void {
    if (this.statusRefreshTimer) { clearInterval(this.statusRefreshTimer); this.statusRefreshTimer = undefined; }
    if (this.statusStreamTimer) { clearInterval(this.statusStreamTimer); this.statusStreamTimer = undefined; }
  }

  private startStatusUpdates(): void {
    this.stopStatusUpdates();
    if (this.selectedStatusRange >= 60) {
      // Long ranges: re-fetch from API periodically
      this.statusRefreshTimer = setInterval(() => this.loadStatusHistory(), 60000);
    } else {
      // Short ranges: stream new data points on a timer
      let intervalMs: number;
      if (this.selectedStatusRange <= 1) intervalMs = 1000;
      else if (this.selectedStatusRange <= 5) intervalMs = 2000;
      else intervalMs = 5000;
      this.statusStreamTimer = setInterval(() => this.pushStatusDataPoint(), intervalMs);
    }
  }

  private pushStatusDataPoint(): void {
    if (!this.statusSeeded || !this.statusOverTimeChart?.canvas) return;
    const agents = this.agentService.getAgentsSnapshot();
    const waitingStatuses = ['waiting', 'awaiting-permission', 'permission-requested'];
    const point = {
      idle: agents.filter(a => a.status === 'idle').length,
      working: agents.filter(a => a.status === 'working').length,
      waiting: agents.filter(a => waitingStatuses.includes(a.status)).length,
      failed: agents.filter(a => a.status === 'failed').length,
    };
    this.statusData.push(point);
    // Keep fixed number of points (60)
    if (this.statusData.length > 60) {
      this.statusData.shift();
    }
    this.renderStatusChart();
  }

  loadInsights(): void {
    this.http.get<any>(`${environment.serverUrl}/api/insights/daily`, { params: { days: 30 } }).subscribe({
      next: (daily) => {
        if (daily.success) this.dailyData = daily.daily || [];
        this.computeStats();
        this.cdr.markForCheck();
        setTimeout(() => this.createDailyChart(), 100);
      },
      error: (err) => console.error('Error loading insights:', err)
    });
    this.loadHeatmap();
  }

  private loadHeatmap(): void {
    this.http.get<any>(`${environment.serverUrl}/api/insights/heatmap`, {
      params: { days: this.selectedHeatmapRange }
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.buildHeatmapRows(res.heatmap || [], this.selectedHeatmapRange);
        }
        this.cdr.markForCheck();
      }
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
            label: '  Tool Activity',
            data: [],
            borderColor: '#E53E3E',
            backgroundColor: 'rgba(229, 62, 62, 0.15)',
            tension: 0.4, borderWidth: 3, fill: true,
            pointRadius: 0, pointHoverRadius: 4
          },
          {
            label: '  Log Activity',
            data: [],
            borderColor: '#38A169',
            backgroundColor: 'rgba(56, 161, 105, 0.15)',
            tension: 0.4, borderWidth: 2, fill: true,
            pointRadius: 0, pointHoverRadius: 4
          },
          {
            label: '  Status Changes',
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
        animation: { duration: 100 },
        interaction: { intersect: false, mode: 'index' },
        scales: {
          x: {
            ticks: {
              color: 'rgba(255,255,255,0.5)',
              font: { size: 12 },
              maxRotation: 0,
              autoSkip: false,
              callback: ((_val: any, index: number): string => {
                return this._pulseVisibleTicks.get(index) ?? '';
              })
            },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.1)' }
          }
        },
        plugins: {
          title: { display: false },
          legend: {
            position: 'bottom',
            labels: { color: '#ffffff', usePointStyle: true, pointStyle: 'circle', padding: 20 }
          }
        }
      }
    });
  }

  private initStatusCharts(): void {
    if (this.statusOverTimeCanvas) {
      this.statusOverTimeChart = new Chart(this.statusOverTimeCanvas.nativeElement, {
        type: 'line',
        data: {
          labels: [],
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
          animation: { duration: 100 },
          scales: {
            x: {
              ticks: {
                color: 'rgba(255,255,255,0.5)',
                font: { size: 12 },
                maxRotation: 0,
                autoSkip: false,
                callback: ((_val: any, index: number): string => {
                  return this._visibleTicks.get(index) ?? '';
                })
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
    }

    if (this.statusCanvas) {
      this.statusChart = new Chart(this.statusCanvas.nativeElement, {
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
            legend: {
              position: 'bottom',
              maxWidth: 200,
              labels: { color: '#ffffff', usePointStyle: true, pointStyle: 'circle', padding: 20 }
            }
          }
        }
      });
    }
  }

  private loadStatusHistory(): void {
    this.http.get<any>(`${environment.serverUrl}/api/insights/status-history`, {
      params: { minutes: this.selectedStatusRange }
    }).subscribe({
      next: (res) => {
        if (!res.success || !this.statusOverTimeChart?.canvas) return;
        const history: { timestamp: string; idle: number; working: number; waiting: number; failed: number }[] = res.history || [];
        this.statusData = history.map(s => ({ idle: s.idle, working: s.working, waiting: s.waiting, failed: s.failed }));
        this.statusSeeded = true;
        this.buildStatusTicks();
        this.renderStatusChart();
      }
    });
  }

  private buildStatusTicks(): void {
    const range = this.selectedStatusRange;
    const n = this.statusData.length;
    let ticks: string[];
    if (range <= 1) {
      ticks = ['-60s', '-50s', '-40s', '-30s', '-20s', '-10s', '0'];
    } else if (range <= 5) {
      ticks = ['-5m', '-4m', '-3m', '-2m', '-1m', '0'];
    } else if (range <= 15) {
      ticks = ['-15m', '-10m', '-5m', '0'];
    } else if (range <= 60) {
      ticks = ['-60m', '-50m', '-40m', '-30m', '-20m', '-10m', '0'];
    } else if (range <= 360) {
      ticks = ['-6h', '-5h', '-4h', '-3h', '-2h', '-1h', '0'];
    } else if (range <= 720) {
      ticks = ['-12h', '-10h', '-8h', '-6h', '-4h', '-2h', '0'];
    } else {
      ticks = ['-24h', '-20h', '-16h', '-12h', '-8h', '-4h', '0'];
    }
    this._visibleTicks = new Map<number, string>();
    for (let t = 0; t < ticks.length; t++) {
      const idx = Math.round(t * (n - 1) / (ticks.length - 1));
      this._visibleTicks.set(idx, ticks[t]);
    }
  }

  private renderStatusChart(): void {
    if (!this.statusOverTimeChart?.canvas) return;
    const data = this.statusData;
    this.statusOverTimeChart.data.labels = data.map(() => '');
    this.statusOverTimeChart.data.datasets[0].data = data.map(s => s.idle);
    this.statusOverTimeChart.data.datasets[1].data = data.map(s => s.working);
    this.statusOverTimeChart.data.datasets[2].data = data.map(s => s.waiting);
    this.statusOverTimeChart.data.datasets[3].data = data.map(s => s.failed);
    this.statusOverTimeChart.update();
  }

  private loadPulseHistory(): void {
    this.http.get<any>(`${environment.serverUrl}/api/insights/activity-pulse`, {
      params: { minutes: this.selectedPulseRange }
    }).subscribe({
      next: (res) => {
        if (!res.success || !this.pulseChart?.canvas) return;
        const history: { toolActivity: number; logActivity: number; statusChanges: number }[] = res.history || [];
        this.pulseData = history.map(s => ({ toolActivity: s.toolActivity, logActivity: s.logActivity, statusChanges: s.statusChanges }));
        this.pulseSeeded = true;
        this.buildPulseTicks();
        this.renderPulseChart();
      }
    });
  }

  private buildPulseTicks(): void {
    const range = this.selectedPulseRange;
    const n = this.pulseData.length;
    let ticks: string[];
    if (range <= 10 / 60) {
      ticks = ['-10s', '-8s', '-6s', '-4s', '-2s', '0'];
    } else if (range <= 0.5) {
      ticks = ['-30s', '-20s', '-10s', '0'];
    } else if (range <= 1) {
      ticks = ['-60s', '-50s', '-40s', '-30s', '-20s', '-10s', '0'];
    } else {
      ticks = ['-5m', '-4m', '-3m', '-2m', '-1m', '0'];
    }
    this._pulseVisibleTicks = new Map<number, string>();
    for (let t = 0; t < ticks.length; t++) {
      const idx = Math.round(t * (n - 1) / (ticks.length - 1));
      this._pulseVisibleTicks.set(idx, ticks[t]);
    }
  }

  private renderPulseChart(): void {
    if (!this.pulseChart?.canvas) return;
    const data = this.pulseData;
    this.pulseChart.data.labels = data.map(() => '');
    this.pulseChart.data.datasets[0].data = data.map(s => s.toolActivity);
    this.pulseChart.data.datasets[1].data = data.map(s => s.logActivity);
    this.pulseChart.data.datasets[2].data = data.map(s => s.statusChanges);
    this.pulseChart.update();
  }

  private stopPulseUpdates(): void {
    if (this.pulseStreamTimer) { clearInterval(this.pulseStreamTimer); this.pulseStreamTimer = undefined; }
  }

  private startPulseUpdates(): void {
    this.stopPulseUpdates();
    // Stream new points from live agent data
    const intervalMs = this.selectedPulseRange <= 0.5 ? 1000 : 2000;
    this.pulseStreamTimer = setInterval(() => this.pushPulseDataPoint(), intervalMs);
  }

  private pushPulseDataPoint(): void {
    if (!this.pulseSeeded || !this.pulseChart?.canvas) return;
    const agents = this.agentService.getAgentsSnapshot();
    const now = Date.now();
    const toolActivity = agents.filter(a => a.currentTool && a.status === 'working').length;
    const statusChanges = agents.filter(a => {
      if (!a.lastActivity) return false;
      return (now - new Date(a.lastActivity).getTime()) < 10000;
    }).length;
    this.pulseData.push({
      toolActivity: toolActivity * 2,
      logActivity: 0,
      statusChanges: statusChanges * 1.5,
    });
    if (this.pulseData.length > 60) {
      this.pulseData.shift();
    }
    this.renderPulseChart();
  }

  private updateDoughnutChart(agents: Agent[]): void {
    if (!this.statusChart?.canvas) return;
    const waitingStatuses = ['waiting', 'awaiting-permission', 'permission-requested'];
    this.statusChart.data.datasets[0].data = [
      agents.filter(a => a.status === 'idle').length,
      agents.filter(a => a.status === 'working').length,
      agents.filter(a => waitingStatuses.includes(a.status)).length,
      agents.filter(a => a.status === 'failed').length,
    ];
    this.statusChart.update();
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

  private buildHeatmapRows(heatmapData: HeatmapEntry[], numDays: number): void {
    const lookup = new Map<string, number>();
    for (const entry of heatmapData) {
      const parts = entry.key.split('T');
      if (parts.length < 2) continue;
      const key = `${parts[0]}|${parseInt(parts[1])}`;
      lookup.set(key, (lookup.get(key) || 0) + entry.count);
    }

    const days: string[] = [];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const today = new Date();
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    const labelInterval = Math.max(1, Math.floor(numDays / 6));
    this.heatmapDayLabels = days.map((dateStr, i) => {
      const d = new Date(dateStr + 'T00:00:00');
      const dayNum = d.getDate();
      if (i === 0 || i === days.length - 1 || i % labelInterval === 0) {
        return `${months[d.getMonth()]} ${dayNum}`;
      }
      return '';
    });

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
