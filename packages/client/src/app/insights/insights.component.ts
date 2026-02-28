import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import { environment } from '../../environments/environment';

Chart.register(...registerables);

interface DailyEntry { date: string; count: number; }
interface ModelEntry { model: string; count: number; }
interface HeatmapEntry { key: string; count: number; }
interface HeatmapCell { label: string; count: number; color: string; }
interface HeatmapRow { label: string; cells: HeatmapCell[]; }

interface InsightsStats {
  totalSessions: number;
  totalEvents: number;
  mostActiveDay: string;
  mostUsedModel: string;
}

@Component({
  selector: 'app-insights',
  templateUrl: './insights.component.html',
  styleUrls: ['./insights.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InsightsComponent implements OnInit, OnDestroy {
  @ViewChild('dailyCanvas') dailyCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('modelCanvas') modelCanvas!: ElementRef<HTMLCanvasElement>;

  dailyData: DailyEntry[] = [];
  modelData: ModelEntry[] = [];
  heatmapRows: HeatmapRow[] = [];
  stats: InsightsStats = {
    totalSessions: 0,
    totalEvents: 0,
    mostActiveDay: '-',
    mostUsedModel: '-'
  };

  private dailyChart?: Chart;
  private modelChart?: Chart;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadInsights();
  }

  ngOnDestroy(): void {
    this.dailyChart?.destroy();
    this.modelChart?.destroy();
  }

  loadInsights(): void {
    forkJoin({
      daily: this.http.get<any>(`${environment.serverUrl}/api/insights/daily`, { params: { days: 30 } }),
      models: this.http.get<any>(`${environment.serverUrl}/api/insights/models`),
      heatmap: this.http.get<any>(`${environment.serverUrl}/api/insights/heatmap`),
    }).subscribe({
      next: ({ daily, models, heatmap }) => {
        if (daily.success) this.dailyData = daily.daily || [];
        if (models.success) this.modelData = models.models || [];
        if (heatmap.success) {
          this.buildHeatmapRows(heatmap.heatmap || []);
        }
        this.computeStats();
        this.cdr.markForCheck();
        setTimeout(() => {
          this.createDailyChart();
          this.createModelChart();
        }, 100);
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

    if (this.modelData.length > 0) {
      const maxModel = this.modelData.reduce((max, m) => m.count > max.count ? m : max, this.modelData[0]);
      this.stats.mostUsedModel = maxModel.model;
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
            ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } },
            grid: { display: false }
          },
          y: {
            ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    });
  }

  private createModelChart(): void {
    if (!this.modelCanvas || this.modelData.length === 0) return;
    this.modelChart?.destroy();

    const purplePalette = [
      'rgba(124, 58, 237, 0.85)', 'rgba(167, 139, 250, 0.85)',
      'rgba(109, 40, 217, 0.85)', 'rgba(139, 92, 246, 0.85)',
      'rgba(196, 181, 253, 0.7)', 'rgba(91, 33, 182, 0.85)',
      'rgba(221, 214, 254, 0.6)', 'rgba(76, 29, 149, 0.85)',
    ];

    this.modelChart = new Chart(this.modelCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: this.modelData.map(m => m.model),
        datasets: [{
          data: this.modelData.map(m => m.count),
          backgroundColor: purplePalette.slice(0, this.modelData.length),
          borderColor: 'rgba(13, 17, 23, 0.8)',
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: 'rgba(255,255,255,0.6)',
              font: { size: 11 },
              padding: 12,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          }
        }
      }
    });
  }

  private buildHeatmapRows(heatmapData: HeatmapEntry[]): void {
    const hourMap = new Map<number, Map<string, number>>();
    const daySet = new Set<string>();

    for (const entry of heatmapData) {
      const parts = entry.key.split('T');
      if (parts.length < 2) continue;
      const day = parts[0];
      const hour = parseInt(parts[1]);
      daySet.add(day);
      if (!hourMap.has(hour)) hourMap.set(hour, new Map());
      hourMap.get(hour)!.set(day, (hourMap.get(hour)!.get(day) || 0) + entry.count);
    }

    const days = Array.from(daySet).sort().slice(-14);
    this.heatmapRows = [];
    for (let h = 0; h < 24; h += 3) {
      const cellMap = new Map<string, number>();
      for (let offset = 0; offset < 3; offset++) {
        const hourData = hourMap.get(h + offset);
        if (hourData) {
          hourData.forEach((count, day) => {
            cellMap.set(day, (cellMap.get(day) || 0) + count);
          });
        }
      }
      this.heatmapRows.push({
        label: `${h.toString().padStart(2, '0')}:00`,
        cells: days.map(d => {
          const count = cellMap.get(d) || 0;
          return {
            label: `${d} ${h.toString().padStart(2, '0')}:00`,
            count,
            color: this.getHeatmapColor(count)
          };
        })
      });
    }
  }

  private getHeatmapColor(count: number): string {
    if (count === 0) return 'rgba(255, 255, 255, 0.03)';
    if (count < 5) return 'rgba(124, 58, 237, 0.2)';
    if (count < 20) return 'rgba(124, 58, 237, 0.4)';
    if (count < 50) return 'rgba(124, 58, 237, 0.6)';
    return 'rgba(124, 58, 237, 0.85)';
  }

  trackByRow(index: number): number {
    return index;
  }

  trackByCell(index: number): number {
    return index;
  }
}
