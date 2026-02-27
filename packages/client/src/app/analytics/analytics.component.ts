import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { AgentMonitorService, Agent } from '../services/agent-monitor.service';
import { Observable } from 'rxjs';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface DailyEntry { date: string; count: number; }
interface HeatmapEntry { key: string; count: number; }
interface HeatmapRow { label: string; cells: { label: string; count: number; }[]; }

@Component({
  selector: 'app-analytics',
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss']
})
export class AnalyticsComponent implements OnInit, AfterViewInit {
  @ViewChild('dailyCanvas') dailyCanvas!: ElementRef<HTMLCanvasElement>;

  agents$: Observable<Agent[]>;
  workingCount = 0;
  agentCount = 0;
  viewMode: 'list' | 'kanban' | 'tree' = 'list';
  dailyData: DailyEntry[] = [];
  heatmapData: HeatmapEntry[] = [];
  heatmapRows: HeatmapRow[] = [];
  private dailyChart?: Chart;
  private serverUrl = 'http://localhost:3000';

  constructor(private agentService: AgentMonitorService) {
    this.agents$ = this.agentService.getAgents();
    this.agents$.subscribe(agents => {
      this.agentCount = agents.length;
      this.workingCount = agents.filter(a => a.status === 'working').length;
    });
    const saved = localStorage.getItem('agents-view-mode');
    if (saved === 'list' || saved === 'kanban' || saved === 'tree') {
      this.viewMode = saved;
    }
  }

  setViewMode(mode: 'list' | 'kanban' | 'tree'): void {
    this.viewMode = mode;
    localStorage.setItem('agents-view-mode', mode);
  }

  focusAgent(agent: Agent): void {
    this.agentService.focusAgent(agent.id);
  }

  ngOnInit(): void {
    this.loadInsights();
  }

  ngAfterViewInit(): void {
    // Chart is created after data loads
  }

  async loadInsights(): Promise<void> {
    try {
      const [dailyRes, heatmapRes] = await Promise.all([
        fetch(`${this.serverUrl}/api/insights/daily?days=30`).then(r => r.json()),
        fetch(`${this.serverUrl}/api/insights/heatmap`).then(r => r.json()),
      ]);
      if (dailyRes.success) {
        this.dailyData = dailyRes.daily || [];
        setTimeout(() => this.createDailyChart(), 100);
      }
      if (heatmapRes.success) {
        this.heatmapData = heatmapRes.heatmap || [];
        this.buildHeatmapRows();
      }
    } catch (error) {
      console.error('Error loading insights:', error);
    }
  }

  private createDailyChart(): void {
    if (!this.dailyCanvas || this.dailyData.length === 0) return;
    if (this.dailyChart) this.dailyChart.destroy();

    this.dailyChart = new Chart(this.dailyCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: this.dailyData.map(d => d.date.slice(5)), // "02-27"
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
          x: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }

  private buildHeatmapRows(): void {
    // Group by hour of day (rows = hours 0-23, cols = recent days)
    const hourMap = new Map<number, Map<string, number>>();
    const daySet = new Set<string>();

    for (const entry of this.heatmapData) {
      // key format: "2026-02-27T14"
      const parts = entry.key.split('T');
      if (parts.length < 2) continue;
      const day = parts[0];
      const hour = parseInt(parts[1]);
      daySet.add(day);
      if (!hourMap.has(hour)) hourMap.set(hour, new Map());
      hourMap.get(hour)!.set(day, (hourMap.get(hour)!.get(day) || 0) + entry.count);
    }

    const days = Array.from(daySet).sort().slice(-14); // Last 14 days
    this.heatmapRows = [];
    for (let h = 0; h < 24; h += 3) {
      const hourData = hourMap.get(h) || new Map();
      this.heatmapRows.push({
        label: `${h.toString().padStart(2, '0')}:00`,
        cells: days.map(d => ({
          label: `${d} ${h}:00`,
          count: hourData.get(d) || 0
        }))
      });
    }
  }

  getHeatmapColor(count: number): string {
    if (count === 0) return 'rgba(255, 255, 255, 0.03)';
    if (count < 5) return 'rgba(124, 58, 237, 0.2)';
    if (count < 20) return 'rgba(124, 58, 237, 0.4)';
    if (count < 50) return 'rgba(124, 58, 237, 0.6)';
    return 'rgba(124, 58, 237, 0.85)';
  }

  getStatusIcon(status: string): string {
    switch(status) {
      case 'working': return 'engineering';
      case 'completed': return 'check_circle';
      case 'failed': return 'error';
      case 'paused': return 'pause_circle';
      default: return 'pending';
    }
  }

  getStatusColorHex(status: string): string {
    switch(status) {
      case 'working': return '#4caf50';
      case 'completed': return '#2196f3';
      case 'failed': return '#f44336';
      case 'paused': return '#a78bfa';
      default: return '#9e9e9e';
    }
  }

  getProgressColor(progress: number | undefined): string {
    if (!progress) return 'primary';
    if (progress === 100) return 'accent';
    if (progress > 75) return 'primary';
    return 'primary';
  }

  getElapsedTime(startTime?: Date | string): string {
    if (!startTime) return '-';
    const startDate = new Date(startTime);
    if (isNaN(startDate.getTime())) return '-';
    const elapsed = Date.now() - startDate.getTime();
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  getTimeAgo(time?: Date | string): string {
    if (!time) return '-';
    const timeDate = new Date(time);
    if (isNaN(timeDate.getTime())) return '-';
    const elapsed = Date.now() - timeDate.getTime();
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes === 1) return '1 minute ago';
    return `${minutes} minutes ago`;
  }

  pauseAgent(agent: Agent): void {
    this.agentService.pauseAgent(agent.id);
  }

  resumeAgent(agent: Agent): void {
    this.agentService.resumeAgent(agent.id);
  }

  viewAgentLogs(agentId: string): void {
    // Navigate to logs view filtered by agent
    console.log('View logs for agent:', agentId);
  }

  getFormattedAgentId(id: string): string {
    return this.agentService.getFormattedAgentId(id);
  }

  removeAgent(agent: Agent): void {
    this.agentService.removeAgent(agent.id);
  }

  getAgentColors(): string[] {
    return [
      '#E53E3E', // Bright Red
      '#38A169', // Forest Green  
      '#3182CE', // Royal Blue
      '#7c3aed', // Purple
      '#8A2BE2', // Blue Violet
      '#00CED1', // Dark Turquoise
      '#DC143C', // Crimson
      '#228B22', // Forest Green (different shade)
      '#4169E1', // Royal Blue (different shade)
      '#FF1493'  // Deep Pink
    ];
  }
}
