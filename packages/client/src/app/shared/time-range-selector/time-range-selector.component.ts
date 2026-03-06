import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

export interface TimeRange {
  label: string;
  minutes: number;
}

@Component({
  selector: 'app-time-range-selector',
  template: `
    <div class="range-group">
      <button *ngFor="let r of ranges"
              class="range-btn"
              [class.active]="selected === r.minutes"
              (click)="rangeChange.emit(r.minutes)">
        {{ r.label }}
      </button>
    </div>
  `,
  styles: [`
    .range-group {
      display: flex;
      gap: 0;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      overflow: hidden;
    }
    .range-btn {
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, 0.4);
      font: inherit;
      font-weight: 600;
      padding: 5px 10px;
      cursor: pointer;
      transition: all 0.15s ease;
      border-right: 1px solid rgba(255, 255, 255, 0.1);
    }
    .range-btn:last-child {
      border-right: none;
    }
    .range-btn:hover {
      background: rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.7);
    }
    .range-btn.active {
      background: rgba(124, 58, 237, 0.2);
      color: #a78bfa;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TimeRangeSelectorComponent {
  @Input() ranges: TimeRange[] = [];
  @Input() selected = 5;
  @Output() rangeChange = new EventEmitter<number>();
}
