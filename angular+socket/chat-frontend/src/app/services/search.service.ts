import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { authHeaders } from '../config/auth-token';

/** One content hit returned by the backend `/search` route (N3). */
export interface SearchHit {
  kind: 'task' | 'comment' | 'element' | 'document';
  project_name: string;
  project_type: string;
  element_id: string | null;
  element_name: string | null;
  title: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchHit[];
}

/**
 * Global content search (N3). Thin HTTP wrapper over the backend `/search`
 * route, mirroring `AnalyticsService`: same base URL and `authHeaders()` so the
 * backend identifies the caller from the verified JWT (the `username` param is
 * only the permissive/demo fallback).
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  constructor(private http: HttpClient) {}

  search(query: string, username: string): Observable<SearchResponse> {
    const q = encodeURIComponent(query);
    const u = encodeURIComponent(username);
    return this.http.get<SearchResponse>(
      `http://localhost:3000/search?q=${q}&username=${u}`,
      { headers: authHeaders() }
    );
  }
}
