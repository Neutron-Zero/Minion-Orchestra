import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

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
import { ChartsComponent } from './charts/charts.component';
import { OverviewComponent } from './overview/overview.component';
import { LogsComponent } from './logs/logs.component';
import { AnalyticsComponent } from './analytics/analytics.component';
import { SettingsPageComponent } from './settings-page/settings-page.component';
import { KanbanBoardComponent } from './kanban-board/kanban-board.component';
import { PromptHistoryComponent } from './prompt-history/prompt-history.component';
import { PlansViewerComponent } from './plans-viewer/plans-viewer.component';
import { HistoryComponent } from './history/history.component';
import { AgentDetailComponent } from './agent-detail/agent-detail.component';
import { InsightsComponent } from './insights/insights.component';

@NgModule({
  declarations: [
    AppComponent,
    LogViewerComponent,
    ChartsComponent,
    OverviewComponent,
    LogsComponent,
    AnalyticsComponent,
    SettingsPageComponent,
    KanbanBoardComponent,
    PromptHistoryComponent,
    PlansViewerComponent,
    HistoryComponent,
    AgentDetailComponent,
    InsightsComponent
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
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
