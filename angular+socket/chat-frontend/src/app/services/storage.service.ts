import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';
import { SupabaseService } from './supabase.service';
import { SupabaseAuthService } from './supabase-auth.service';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private isBrowser: boolean;

  private uploadingSubject = new BehaviorSubject<boolean>(false);
  public uploading$: Observable<boolean> = this.uploadingSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$: Observable<boolean> = this.loadingSubject.asObservable();

  constructor(
    private supabaseService: SupabaseService,
    private supabaseAuth: SupabaseAuthService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /**
   * Upload a file to Supabase Storage
   * @param bucket The storage bucket name
   * @param path The path within the bucket
   * @param file The file to upload (File or Blob)
   */
  async uploadFile(bucket: string, path: string, file: File | Blob): Promise<{ url: string | null; error: string | null }> {
    if (!this.isBrowser) {
      return { url: null, error: 'Not in browser environment' };
    }

    this.uploadingSubject.next(true);
    try {
      const { data, error } = await this.supabaseService.client.storage
        .from(bucket)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        console.error('Error uploading file:', error);
        this.uploadingSubject.next(false);
        return { url: null, error: error.message };
      }

      const { data: urlData } = this.supabaseService.client.storage
        .from(bucket)
        .getPublicUrl(data.path);

      this.uploadingSubject.next(false);
      return { url: urlData.publicUrl, error: null };
    } catch (err) {
      this.uploadingSubject.next(false);
      return { url: null, error: String(err) };
    }
  }

  /**
   * Upload a project asset (image or video)
   * @param projectId The project ID
   * @param fileName The file name
   * @param file The file to upload
   * @param fileType 'image' or 'video'
   */
  async uploadProjectAsset(
    projectId: string,
    fileName: string,
    file: File | Blob,
    fileType: 'image' | 'video'
  ): Promise<{ url: string | null; error: string | null }> {
    const path = `${projectId}/${fileType}s/${fileName}`;
    return this.uploadFile('project-assets', path, file);
  }

  /**
   * Delete a file from Supabase Storage
   * @param bucket The storage bucket name
   * @param path The path to the file
   */
  async deleteFile(bucket: string, path: string): Promise<{ success: boolean; error: string | null }> {
    if (!this.isBrowser) {
      return { success: false, error: 'Not in browser environment' };
    }

    try {
      const { error } = await this.supabaseService.client.storage
        .from(bucket)
        .remove([path]);

      if (error) {
        console.error('Error deleting file:', error);
        return { success: false, error: error.message };
      }

      return { success: true, error: null };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Delete a project asset
   * @param projectId The project ID
   * @param fileName The file name
   * @param fileType 'image' or 'video'
   */
  async deleteProjectAsset(
    projectId: string,
    fileName: string,
    fileType: 'image' | 'video'
  ): Promise<{ success: boolean; error: string | null }> {
    const path = `${projectId}/${fileType}s/${fileName}`;
    return this.deleteFile('project-assets', path);
  }

  /**
   * List files in a bucket folder
   * @param bucket The storage bucket name
   * @param folder The folder path
   */
  async listFiles(bucket: string, folder: string): Promise<{ files: any[] | null; error: string | null }> {
    if (!this.isBrowser) {
      return { files: null, error: 'Not in browser environment' };
    }

    this.loadingSubject.next(true);
    try {
      const { data, error } = await this.supabaseService.client.storage
        .from(bucket)
        .list(folder);

      if (error) {
        console.error('Error listing files:', error);
        this.loadingSubject.next(false);
        return { files: null, error: error.message };
      }

      this.loadingSubject.next(false);
      return { files: data, error: null };
    } catch (err) {
      this.loadingSubject.next(false);
      return { files: null, error: String(err) };
    }
  }

  /**
   * Get public URL for a file
   * @param bucket The storage bucket name
   * @param path The path to the file
   */
  getPublicUrl(bucket: string, path: string): string {
    const { data } = this.supabaseService.client.storage
      .from(bucket)
      .getPublicUrl(path);
    return data.publicUrl;
  }

  /**
   * Convert a base64 data URL to a File/Blob
   */
  base64ToFile(base64: string, fileName: string): Blob {
    const arr = base64.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }
}
