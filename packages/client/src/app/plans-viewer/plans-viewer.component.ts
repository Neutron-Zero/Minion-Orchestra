import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

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
  styleUrls: ['./plans-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlansViewerComponent implements OnInit {
  plans: Plan[] = [];
  selectedPlan: Plan | null = null;
  loading = false;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadPlans();
  }

  loadPlans(): void {
    this.loading = true;
    this.cdr.markForCheck();

    this.http.get<any>(`${environment.serverUrl}/api/plans`).subscribe({
      next: (data) => {
        if (data.success) {
          this.plans = data.plans || [];
          if (this.plans.length > 0 && !this.selectedPlan) {
            this.selectedPlan = this.plans[0];
          }
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
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
    return name.replace('.md', '');
  }

  trackByPlan(index: number, plan: Plan): string {
    return plan.path;
  }
}
