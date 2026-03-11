import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, ChangeDetectionStrategy } from '@angular/core';

export interface DisplayEvent {
  timestamp: string;
  agent_id: string;
  agent_name?: string;
  event_type: string;
  message?: string | null;
  metadata?: any;
  _formattedTime: string;
  _agentName: string;
  _agentColor: string;
  _eventIcon: string;
  _eventColor: string;
  _toolName: string | null;
  _toolDetail: string | null;
  _summary: string;
  _isExpanded: boolean;
  _metadataJson: string;
}

@Component({
  selector: 'app-event-stream-list',
  templateUrl: './event-stream-list.component.html',
  styleUrls: ['./event-stream-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventStreamListComponent {
  @ViewChild('scrollContainer') scrollContainer?: ElementRef;

  @Input() events: DisplayEvent[] = [];
  @Input() loading = false;
  @Input() emptyMessage = 'No events found';

  @Output() expand = new EventEmitter<DisplayEvent>();
  @Output() copyJson = new EventEmitter<{ event: DisplayEvent; mouseEvent: MouseEvent }>();

  onExpandClick(event: DisplayEvent): void {
    this.expand.emit(event);
  }

  onCopyClick(event: DisplayEvent, mouseEvent: MouseEvent): void {
    this.copyJson.emit({ event, mouseEvent });
  }

  trackByEvent(index: number, event: DisplayEvent): string {
    return `${event.timestamp}|${event.agent_id}|${event.event_type}`;
  }

  formatAgentId(id: string): string {
    if (!id) return '';
    return id.length > 7 ? id.substring(0, 7) : id;
  }
}
