import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { authHeaders } from '../config/auth-token';
import { getServerConfig } from '../config/server.config';

/** Per-user integration config (N10) as served by GET /integrations. */
export interface IntegrationConfig {
  icsFeedToken: string;
  feedPath: string;
  webhookUrl: string | null;
  webhookKind: 'generic' | 'slack';
}

/**
 * N10 — talks to the backend integration endpoints (webhook config, ICS feed
 * token) and builds download/feed URLs against the configured server base
 * (`getServerConfig()`, so remote deployments work). Project export downloads
 * are fetched as blobs with the auth header, then saved via a temporary anchor.
 */
@Injectable({ providedIn: 'root' })
export class IntegrationsService {
  private http = inject(HttpClient);

  private base(): string {
    return getServerConfig();
  }

  /** Current user's integration config (creates the row + feed token on first read). */
  getConfig(): Observable<IntegrationConfig> {
    return this.http.get<IntegrationConfig>(`${this.base()}/integrations`, { headers: authHeaders() });
  }

  /** Set or clear the outbound webhook. */
  setWebhook(url: string | null, kind: 'generic' | 'slack'): Observable<{ webhookUrl: string | null; webhookKind: string }> {
    return this.http.post<{ webhookUrl: string | null; webhookKind: string }>(
      `${this.base()}/integrations/webhook`,
      { url, kind },
      { headers: authHeaders() }
    );
  }

  /** Send a synthetic notification to the configured webhook. */
  testWebhook(): Observable<{ success: boolean; delivered: boolean }> {
    return this.http.post<{ success: boolean; delivered: boolean }>(
      `${this.base()}/integrations/webhook/test`,
      {},
      { headers: authHeaders() }
    );
  }

  /** Rotate the ICS feed token (invalidates the old subscribe URL). */
  regenerateFeed(): Observable<{ icsFeedToken: string; feedPath: string }> {
    return this.http.post<{ icsFeedToken: string; feedPath: string }>(
      `${this.base()}/integrations/feed/regenerate`,
      {},
      { headers: authHeaders() }
    );
  }

  /** The absolute, shareable ICS subscribe URL for a feed path. */
  feedUrl(feedPath: string): string {
    return `${this.base()}${feedPath}`;
  }

  /**
   * Download a project export (JSON or Markdown) as a file. Fetches with the
   * auth header (the route is JWT-gated) then saves the blob client-side.
   */
  exportProject(name: string, projectType: 'local' | 'hosted', format: 'json' | 'md'): void {
    const url = `${this.base()}/export/project?type=${projectType}&name=${encodeURIComponent(name)}&format=${format}`;
    this.http.get(url, { headers: authHeaders(), responseType: 'blob' }).subscribe({
      next: (blob) => this.saveBlob(blob, `${name}.${format}`),
      error: (err) => console.error('[Integrations] export failed', err),
    });
  }

  private saveBlob(blob: Blob, filename: string): void {
    if (typeof document === 'undefined') return;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
