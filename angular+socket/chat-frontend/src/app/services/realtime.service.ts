import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';
import { SupabaseService } from './supabase.service';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface RealtimeChangeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  new: any;
  old: any;
  errors?: any;
}

@Injectable({
  providedIn: 'root'
})
export class RealtimeService {
  private isBrowser: boolean;
  private channels: Map<string, RealtimeChannel> = new Map();

  private projectChangesSubject = new BehaviorSubject<RealtimeChangeEvent | null>(null);
  public projectChanges$: Observable<RealtimeChangeEvent | null> = this.projectChangesSubject.asObservable();

  private gridChangesSubject = new BehaviorSubject<RealtimeChangeEvent | null>(null);
  public gridChanges$: Observable<RealtimeChangeEvent | null> = this.gridChangesSubject.asObservable();

  private elementChangesSubject = new BehaviorSubject<RealtimeChangeEvent | null>(null);
  public elementChanges$: Observable<RealtimeChangeEvent | null> = this.elementChangesSubject.asObservable();

  constructor(
    private supabaseService: SupabaseService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /**
   * Subscribe to changes on a table
   * @param table The table name to watch
   * @param filter Optional filter condition (e.g., 'id=eq.123')
   */
  subscribeToTable(table: string, filter?: string): Observable<RealtimeChangeEvent> {
    return new Observable(observer => {
      if (!this.isBrowser) {
        observer.complete();
        return;
      }

      const channelName = `realtime:${table}:${filter || 'all'}`;
      let channel = this.channels.get(channelName);

      if (!channel) {
        channel = this.supabaseService.client
          .channel(channelName)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: table,
            ...(filter ? { filter } : {})
          }, (payload: any) => {
            const event: RealtimeChangeEvent = {
              eventType: payload.eventType,
              table: payload.table,
              new: payload.new,
              old: payload.old
            };

            // Update appropriate subject based on table
            if (table === 'projects') {
              this.projectChangesSubject.next(event);
            } else if (table === 'grids') {
              this.gridChangesSubject.next(event);
            } else if (table === 'screen_elements') {
              this.elementChangesSubject.next(event);
            }

            observer.next(event);
          });

        channel.subscribe();
        this.channels.set(channelName, channel);
      }

      return () => {
        // Cleanup subscription when observable is unsubscribed
      };
    });
  }

  /**
   * Subscribe to project changes
   * @param projectId The project ID
   */
  subscribeToProject(projectId: string): Observable<RealtimeChangeEvent> {
    return this.subscribeToTable('projects', `id=eq.${projectId}`);
  }

  /**
   * Subscribe to grid changes for a project
   * @param projectId The project ID
   */
  subscribeToGrids(projectId: string): Observable<RealtimeChangeEvent> {
    return this.subscribeToTable('grids', `project_id=eq.${projectId}`);
  }

  /**
   * Subscribe to screen element changes
   * @param gridId The grid ID
   */
  subscribeToScreenElements(gridId: string): Observable<RealtimeChangeEvent> {
    return this.subscribeToTable('screen_elements', `grid_id=eq.${gridId}`);
  }

  /**
   * Subscribe to task changes
   * @param gridId The grid ID
   */
  subscribeToTasks(gridId: string): Observable<RealtimeChangeEvent> {
    return this.subscribeToTable('tasks', `grid_id=eq.${gridId}`);
  }

  /**
   * Unsubscribe from all channels
   */
  unsubscribeAll(): void {
    this.channels.forEach((channel) => {
      channel.unsubscribe();
    });
    this.channels.clear();
  }

  /**
   * Unsubscribe from a specific channel
   * @param channelName The channel name
   */
  unsubscribeChannel(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.unsubscribe();
      this.channels.delete(channelName);
    }
  }
}
