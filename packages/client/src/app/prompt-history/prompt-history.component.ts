import { Component, OnInit } from '@angular/core';

interface Prompt {
  timestamp: string;
  message: string;
  agent_id: string;
  session_id: string;
  event_type: string;
}

@Component({
  selector: 'app-prompt-history',
  templateUrl: './prompt-history.component.html',
  styleUrls: ['./prompt-history.component.scss']
})
export class PromptHistoryComponent implements OnInit {
  prompts: Prompt[] = [];
  filteredPrompts: Prompt[] = [];
  searchTerm = '';
  loading = false;
  private serverUrl = 'http://localhost:3000';

  ngOnInit(): void {
    this.loadPrompts();
  }

  async loadPrompts(): Promise<void> {
    this.loading = true;
    try {
      const params = new URLSearchParams();
      if (this.searchTerm) params.set('search', this.searchTerm);
      params.set('limit', '200');
      const response = await fetch(`${this.serverUrl}/api/prompts?${params}`);
      const data = await response.json();
      if (data.success) {
        this.prompts = data.prompts || [];
        this.applyFilter();
      }
    } catch (error) {
      console.error('Error loading prompts:', error);
    } finally {
      this.loading = false;
    }
  }

  onSearch(): void {
    this.loadPrompts();
  }

  applyFilter(): void {
    this.filteredPrompts = this.prompts;
  }

  formatTimestamp(ts: string): string {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  truncateMessage(msg: string, max: number = 200): string {
    if (!msg || msg.length <= max) return msg || '';
    return msg.substring(0, max) + '...';
  }

  getAgentShortId(id: string): string {
    if (!id) return '';
    if (id.length > 12) return id.slice(-8);
    return id;
  }
}
