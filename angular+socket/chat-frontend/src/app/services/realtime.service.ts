import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { SocketService } from './socket.service';

export interface RealtimeChangeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  new: any;
  old: any;
  errors?: any;
}

/**
 * Phase 4: RealtimeService is now backed by Socket.IO broadcasts
 * (`hostedProjectUpdated` / `hostedProjectDeleted`) emitted by the Postgres
 * backend. The public Observable-returning API is preserved so
 * callers keep compiling; table-scoped subscriptions map onto the hosted-project
 * broadcasts (the backend's realtime unit is the whole hosted project).
 */
@Injectable({
  providedIn: 'root'
})
export class RealtimeService {
  private isBrowser: boolean;
  private channels: Map<string, Subscription> = new Map();

  private projectChangesSubject = new BehaviorSubject<RealtimeChangeEvent | null>(null);
  public projectChanges$: Observable<RealtimeChangeEvent | null> = this.projectChangesSubject.asObservable();

  private gridChangesSubject = new BehaviorSubject<RealtimeChangeEvent | null>(null);
  public gridChanges$: Observable<RealtimeChangeEvent | null> = this.gridChangesSubject.asObservable();

  private elementChangesSubject = new BehaviorSubject<RealtimeChangeEvent | null>(null);
  public elementChanges$: Observable<RealtimeChangeEvent | null> = this.elementChangesSubject.asObservable();

  constructor(
    private socketService: SocketService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /**
   * Subscribe to changes on a table. Backed by the hosted-project socket
   * broadcasts: updates surface as UPDATE, deletions as DELETE.
   */
  subscribeToTable(table: string, filter?: string): Observable<RealtimeChangeEvent> {
    return new Observable<RealtimeChangeEvent>(observer => {
      if (!this.isBrowser) {
        observer.complete();
        return;
      }

      const channelName = `realtime:${table}:${filter || 'all'}`;

      const updateSub = this.socketService.onHostedProjectUpdated().subscribe((data: any) => {
        const event: RealtimeChangeEvent = {
          eventType: 'UPDATE',
          table,
          new: data?.project ?? data,
          old: null
        };
        this.routeEvent(table, event);
        observer.next(event);
      });

      const deleteSub = this.socketService.onHostedProjectDeleted().subscribe((data: any) => {
        const event: RealtimeChangeEvent = {
          eventType: 'DELETE',
          table,
          new: null,
          old: data?.project ?? data
        };
        this.routeEvent(table, event);
        observer.next(event);
      });

      const combined = new Subscription();
      combined.add(updateSub);
      combined.add(deleteSub);
      this.channels.set(channelName, combined);

      return () => {
        combined.unsubscribe();
        this.channels.delete(channelName);
      };
    });
  }

  private routeEvent(table: string, event: RealtimeChangeEvent): void {
    if (table === 'projects') {
      this.projectChangesSubject.next(event);
    } else if (table === 'grids') {
      this.gridChangesSubject.next(event);
    } else if (table === 'screen_elements') {
      this.elementChangesSubject.next(event);
    }
  }

  subscribeToProject(projectId: string): Observable<RealtimeChangeEvent> {
    return this.subscribeToTable('projects', `id=eq.${projectId}`);
  }

  subscribeToGrids(projectId: string): Observable<RealtimeChangeEvent> {
    return this.subscribeToTable('grids', `project_id=eq.${projectId}`);
  }

  subscribeToScreenElements(gridId: string): Observable<RealtimeChangeEvent> {
    return this.subscribeToTable('screen_elements', `grid_id=eq.${gridId}`);
  }

  subscribeToTasks(gridId: string): Observable<RealtimeChangeEvent> {
    return this.subscribeToTable('tasks', `grid_id=eq.${gridId}`);
  }

  unsubscribeAll(): void {
    this.channels.forEach((sub) => sub.unsubscribe());
    this.channels.clear();
  }

  unsubscribeChannel(channelName: string): void {
    const sub = this.channels.get(channelName);
    if (sub) {
      sub.unsubscribe();
      this.channels.delete(channelName);
    }
  }
}
