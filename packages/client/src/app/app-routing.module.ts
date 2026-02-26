import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OverviewComponent } from './overview/overview.component';
import { LogsComponent } from './logs/logs.component';
import { SetupGuideComponent } from './setup-guide/setup-guide.component';
import { AnalyticsComponent } from './analytics/analytics.component';
import { SettingsPageComponent } from './settings-page/settings-page.component';

const routes: Routes = [
  { path: '', redirectTo: '/overview', pathMatch: 'full' },
  { path: 'overview', component: OverviewComponent },
  { path: 'analytics', component: AnalyticsComponent },
  { path: 'logs', component: LogsComponent },
  { path: 'setup', component: SetupGuideComponent },
  { path: 'settings', component: SettingsPageComponent },
  { path: '**', redirectTo: '/overview' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
