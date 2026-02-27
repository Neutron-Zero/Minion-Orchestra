import { Component, OnInit } from '@angular/core';

interface Plan {
  path: string;
  name: string;
  content: string;
  modified: string;
  size: number;
}

@Component({
  selector: 'app-plans-viewer',
  templateUrl: './plans-viewer.component.html',
  styleUrls: ['./plans-viewer.component.scss']
})
export class PlansViewerComponent implements OnInit {
  plans: Plan[] = [];
  selectedPlan: Plan | null = null;
  loading = false;
  private serverUrl = 'http://localhost:3000';

  ngOnInit(): void {
    this.loadPlans();
  }

  async loadPlans(): Promise<void> {
    this.loading = true;
    try {
      const response = await fetch(`${this.serverUrl}/api/plans`);
      const data = await response.json();
      if (data.success) {
        this.plans = data.plans || [];
        if (this.plans.length > 0 && !this.selectedPlan) {
          this.selectedPlan = this.plans[0];
        }
      }
    } catch (error) {
      console.error('Error loading plans:', error);
    } finally {
      this.loading = false;
    }
  }

  selectPlan(plan: Plan): void {
    this.selectedPlan = plan;
  }

  formatDate(ts: string): string {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  getShortName(name: string): string {
    return name.replace('.plan.md', '');
  }
}
