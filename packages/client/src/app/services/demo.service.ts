import { Injectable } from '@angular/core';

// Capture before Angular router can strip query params on redirect
const _initialParams = new URLSearchParams(window.location.search);
const _isDemoMode = _initialParams.get('demo') === 'true';

@Injectable({ providedIn: 'root' })
export class DemoService {
  readonly isDemoMode = _isDemoMode;
}
