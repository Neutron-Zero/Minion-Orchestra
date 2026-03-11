import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DemoInterceptor } from './services/demo.interceptor';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatBadgeModule } from '@angular/material/badge';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';

import { LogViewerComponent } from './log-viewer/log-viewer.component';
import { TimeRangeSelectorComponent } from './shared/time-range-selector/time-range-selector.component';
import { LogsComponent } from './logs/logs.component';
import { AnalyticsComponent } from './analytics/analytics.component';
import { SettingsPageComponent } from './settings-page/settings-page.component';
import { KanbanBoardComponent } from './kanban-board/kanban-board.component';
import { PromptHistoryComponent } from './prompt-history/prompt-history.component';
import { PlansViewerComponent } from './plans-viewer/plans-viewer.component';
import { HistoryComponent } from './history/history.component';
import { AgentDetailComponent } from './agent-detail/agent-detail.component';
import { InsightsComponent } from './insights/insights.component';
import { AgentTimelineComponent } from './agent-timeline/agent-timeline.component';
import { EventStreamListComponent } from './event-stream-list/event-stream-list.component';

@NgModule({
  declarations: [
    AppComponent,
    LogViewerComponent,
    TimeRangeSelectorComponent,
    LogsComponent,
    AnalyticsComponent,
    SettingsPageComponent,
    KanbanBoardComponent,
    PromptHistoryComponent,
    PlansViewerComponent,
    HistoryComponent,
    AgentDetailComponent,
    InsightsComponent,
    AgentTimelineComponent,
    EventStreamListComponent
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    AppRoutingModule,
    FormsModule,
    ReactiveFormsModule,
    BrowserAnimationsModule,
    MatCardModule,
    MatProgressBarModule,
    MatChipsModule,
    MatIconModule,
    MatToolbarModule,
    MatBadgeModule,
    MatGridListModule,
    MatButtonModule,
    MatDividerModule,
    MatTooltipModule,
    MatTabsModule,
    MatInputModule,
    MatFormFieldModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatMenuModule
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: DemoInterceptor, multi: true },
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
