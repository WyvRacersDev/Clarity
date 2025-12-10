import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface SeriesEntry {
  tag: string;
  data: number[]; // Assuming 'arr' which comes from 'countsByTag' is an array of numbers.
}
export interface CompletedPerDayResponse {
  labels: string[];
  series: SeriesEntry[];
}

export interface CompletionRateByTagResponse {
  labels: string[];
  values: number[];
  counts: { total: number; onTime: number; late: number }[];
}
@Injectable({ providedIn: 'root' })


export class AnalyticsService {
  constructor(private http: HttpClient) {}

  getCompletedPerDay(days = 30,username: string): Observable<CompletedPerDayResponse> {
    return this.http.get<CompletedPerDayResponse>(`http://localhost:3000/analytics/completed-per-day?days=${days}&username=${username}`);
  }

  getCompletionRateByTag(days = 30,username:string): Observable<CompletionRateByTagResponse> {
    return this.http.get<CompletionRateByTagResponse>(`http://localhost:3000/analytics/completion-rate-by-tag?days=${days}&username=${username}`);
  }
}