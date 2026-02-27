import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { AgentMonitorService } from '../services/agent-monitor.service';
import { Subscription } from 'rxjs';

Chart.register(...registerables);

@Component({
  selector: 'app-charts',
  templateUrl: './charts.component.html',
  styleUrls: ['./charts.component.scss']
})
export class ChartsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('activityCanvas') activityCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('pulseCanvas') pulseCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('performanceCanvas') performanceCanvas!: ElementRef<HTMLCanvasElement>;
  
  private activityChart?: Chart;
  private pulseChart?: Chart;
  private performanceChart?: Chart;
  private subscription?: Subscription;
  
  private history: any[] = [];
  private pulseHistory: any[] = [];
  private maxDataPoints = 20;
  private maxPulsePoints = 50;

  constructor(private agentService: AgentMonitorService) { }

  ngOnInit(): void {
    // Subscribe to agent updates and logs for pulse data
    this.subscription = this.agentService.getAgents().subscribe(agents => {
      this.updateCharts(agents);
      this.updatePulseChart(agents);
    });

    // Subscribe to logs for additional pulse data
    this.agentService.getLogs().subscribe(logs => {
      this.updatePulseFromLogs(logs);
    });
  }

  ngAfterViewInit(): void {
    this.initializeCharts();
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    if (this.activityChart) {
      this.activityChart.destroy();
    }
    if (this.pulseChart) {
      this.pulseChart.destroy();
    }
    if (this.performanceChart) {
      this.performanceChart.destroy();
    }
  }

  private initializeCharts(): void {
    // Activity Chart
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
        backgroundColor: '#000000',
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
          title: {
            display: false,
            text: 'Agent Activity Over Time',
            color: '#ffffff',
            font: {
              size: 16
            }
          },
          legend: {
            labels: { color: '#ffffff' }
          }
        }
      }
    });

    // Activity Pulse Chart - Real-time system heartbeat
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
            tension: 0.4,
            borderWidth: 3,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4
          },
          {
            label: 'Log Activity', 
            data: [],
            borderColor: '#38A169',
            backgroundColor: 'rgba(56, 161, 105, 0.15)',
            tension: 0.4,
            borderWidth: 2,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4
          },
          {
            label: 'Status Changes',
            data: [],
            borderColor: '#3182CE',
            backgroundColor: 'rgba(49, 130, 206, 0.15)',
            tension: 0.4,
            borderWidth: 2,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        backgroundColor: '#000000',
        animation: {
          duration: 0 // Disable animation for real-time feel
        },
        interaction: {
          intersect: false,
          mode: 'index'
        },
        scales: {
          x: {
            display: false, // Hide x-axis for cleaner look
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            max: 10,
            ticks: { 
              color: '#ffffff',
              stepSize: 2
            },
            grid: { 
              color: 'rgba(255,255,255,0.1)',
              lineWidth: 1
            }
          }
        },
        plugins: {
          title: {
            display: false,
            text: 'Activity Pulse - System Heartbeat',
            color: '#ffffff',
            font: {
              size: 16
            }
          },
          legend: {
            position: 'bottom',
            labels: { 
              color: '#ffffff',
              usePointStyle: true,
              pointStyle: 'circle'
            }
          }
        },
        elements: {
          line: {
            borderCapStyle: 'round'
          }
        }
      }
    });

    // Performance Chart
    this.performanceChart = new Chart(this.performanceCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: ['Idle', 'Working', 'Completed', 'Failed'],
        datasets: [{
          data: [0, 0, 0, 0],
          backgroundColor: [
            '#6366f1', // Idle - matches agent card badge
            '#4caf50', // Working - matches agent card badge
            '#2196f3', // Completed - matches agent card badge
            '#f44336'  // Failed - matches agent card badge
          ],
          borderColor: [
            '#6366f1',
            '#4caf50', 
            '#2196f3',
            '#f44336'
          ],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        backgroundColor: '#000000',
        plugins: {
          title: {
            display: false,
            text: 'Agent Status Overview',
            color: '#ffffff',
            font: {
              size: 16
            }
          },
          legend: {
            position: 'bottom',
            labels: { color: '#ffffff' }
          }
        }
      }
    });
  }

  private updateCharts(agents: any[]): void {
    if (!this.activityChart || !this.performanceChart) {
      return;
    }

    // Update history
    const timestamp = new Date().toLocaleTimeString();
    const activeCount = agents.filter(a => a.status === 'working').length;
    const completedCount = agents.filter(a => a.status === 'completed').length;
    
    this.history.push({
      timestamp,
      active: activeCount,
      completed: completedCount
    });

    if (this.history.length > this.maxDataPoints) {
      this.history.shift();
    }

    // Update Activity Chart
    if (this.activityChart && this.activityChart.canvas) {
      this.activityChart.data.labels = this.history.map(h => h.timestamp);
      this.activityChart.data.datasets[0].data = this.history.map(h => h.active);
      this.activityChart.data.datasets[1].data = this.history.map(h => h.completed);
      this.activityChart.update();
    }

    // Update Performance Chart
    const statusCounts = {
      idle: agents.filter(a => a.status === 'idle').length,
      working: agents.filter(a => a.status === 'working').length,
      completed: agents.filter(a => a.status === 'completed').length,
      failed: agents.filter(a => a.status === 'failed').length
    };

    if (this.performanceChart && this.performanceChart.canvas) {
      this.performanceChart.data.datasets[0].data = [
        statusCounts.idle,
        statusCounts.working,
        statusCounts.completed,
        statusCounts.failed
      ];
      this.performanceChart.update();
    }
  }

  private updatePulseChart(agents: any[]): void {
    if (!this.pulseChart) {
      return;
    }

    const now = Date.now();
    
    // Calculate tool activity (agents using tools right now)
    const toolActivity = agents.filter(a => a.currentTool && a.status === 'working').length;
    
    // Calculate recent status changes (agents that changed status recently)
    const statusChanges = agents.filter(a => {
      if (!a.lastActivity) return false;
      const lastActivityTime = new Date(a.lastActivity).getTime();
      return (now - lastActivityTime) < 10000; // Within last 10 seconds
    }).length;

    // Add to pulse history
    this.pulseHistory.push({
      timestamp: now,
      toolActivity: toolActivity * 2, // Scale up for visibility
      logActivity: 0, // Will be updated by updatePulseFromLogs
      statusChanges: statusChanges * 1.5 // Scale for visibility
    });

    // Keep only recent data points
    if (this.pulseHistory.length > this.maxPulsePoints) {
      this.pulseHistory.shift();
    }

    // Update chart data
    const labels = this.pulseHistory.map((_, i) => i.toString());
    this.pulseChart.data.labels = labels;
    this.pulseChart.data.datasets[0].data = this.pulseHistory.map(h => h.toolActivity);
    this.pulseChart.data.datasets[1].data = this.pulseHistory.map(h => h.logActivity);
    this.pulseChart.data.datasets[2].data = this.pulseHistory.map(h => h.statusChanges);
    
    if (this.pulseChart && this.pulseChart.canvas) {
      this.pulseChart.update('none'); // Update without animation
    }
  }

  private updatePulseFromLogs(logs: any[]): void {
    if (!this.pulseChart || this.pulseHistory.length === 0) {
      return;
    }

    const now = Date.now();
    const recentLogs = logs.filter(log => {
      const logTime = new Date(log.timestamp).getTime();
      return (now - logTime) < 5000; // Within last 5 seconds
    });

    // Update the most recent pulse point with log activity
    const lastIndex = this.pulseHistory.length - 1;
    if (lastIndex >= 0) {
      this.pulseHistory[lastIndex].logActivity = Math.min(recentLogs.length, 10); // Cap at 10 for scale
      
      // Update chart
      this.pulseChart.data.datasets[1].data = this.pulseHistory.map(h => h.logActivity);
      if (this.pulseChart.canvas) {
        this.pulseChart.update('none');
      }
    }
  }
}