import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase configuration
const supabaseUrl = 'https://jphoedbilqmnvfcndymo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwaG9lZGJpbHFtbnZmY25keW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3OTEyMDYsImV4cCI6MjA4OTM2NzIwNn0.ksplbSUI0Mf4qohwOt0caSVDvdF1Fy4oBCK93BDUU-E';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private _client: SupabaseClient | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      this._client = createClient(supabaseUrl, supabaseAnonKey);
    }
  }

  get client(): SupabaseClient {
    if (!this._client) {
      throw new Error('Supabase client not initialized (SSR environment)');
    }
    return this._client;
  }
}
