import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OverviewComponent } from './overview/overview.component';
import { LogsComponent } from './logs/logs.component';
import { AnalyticsComponent } from './analytics/analytics.component';
import { SettingsPageComponent } from './settings-page/settings-page.component';
import { PromptHistoryComponent } from './prompt-history/prompt-history.component';
import { PlansViewerComponent } from './plans-viewer/plans-viewer.component';
import { HistoryComponent } from './history/history.component';
import { AgentDetailComponent } from './agent-detail/agent-detail.component';

const routes: Routes = [
  { path: '', redirectTo: '/agents', pathMatch: 'full' },
  { path: 'agents', component: AnalyticsComponent },
  { path: 'agent/:id', component: AgentDetailComponent },
  { path: 'insights', component: OverviewComponent },
  { path: 'activity', component: LogsComponent },
  { path: 'archive', component: HistoryComponent },
  { path: 'prompts', component: PromptHistoryComponent },
  { path: 'plans', component: PlansViewerComponent },
  { path: 'settings', component: SettingsPageComponent },
{ path: '**', redirectTo: '/agents' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
