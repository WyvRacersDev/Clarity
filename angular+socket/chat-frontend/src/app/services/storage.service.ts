import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { SocketService } from './socket.service';
import { getServerConfig } from '../config/server.config';

/**
 * Phase 4: StorageService is now backed by the backend `uploadFile`/`deleteFile`
 * Socket.IO events (base64 payload -> server writes to disk, returns a relative
 * `filePath` served from `/projects/...`). Files live on the backend's disk.
 *
 * Public method signatures are preserved so existing callers keep compiling.
 * The `bucket` argument now maps to the project name and the `path` encodes the
 * `<projectType>/<fileName>` used by the backend asset layout.
 */
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
    private socketService: SocketService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  private inferFileType(fileName: string): 'image' | 'video' {
    return /\.(mp4|mov|webm|avi|mkv)$/i.test(fileName) ? 'video' : 'image';
  }

  private async fileToBase64(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Upload a file via the backend socket. `bucket` is treated as the project name
   * and `path` as `<projectType>/<fileName>` (projectType defaults to 'local').
   */
  async uploadFile(bucket: string, path: string, file: File | Blob): Promise<{ url: string | null; error: string | null }> {
    if (!this.isBrowser) {
      return { url: null, error: 'Not in browser environment' };
    }

    this.uploadingSubject.next(true);
    try {
      const segments = path.split('/');
      const fileName = segments[segments.length - 1];
      const projectType: 'local' | 'hosted' = path.startsWith('hosted/') ? 'hosted' : 'local';
      const fileType = this.inferFileType(fileName);
      const fileData = await this.fileToBase64(file);

      const response = await firstValueFrom(
        this.socketService.uploadFile(bucket, projectType, fileName, fileData, fileType)
      );

      this.uploadingSubject.next(false);

      if (response && response.success) {
        const filePath: string = response.filePath || response.path || '';
        const url = filePath.startsWith('http')
          ? filePath
          : `${getServerConfig()}/projects/${filePath}`;
        return { url, error: null };
      }
      return { url: null, error: response?.message || 'Upload failed' };
    } catch (err) {
      this.uploadingSubject.next(false);
      return { url: null, error: String(err) };
    }
  }

  /**
   * Upload a project asset (image or video) via the backend socket.
   */
  async uploadProjectAsset(
    projectId: string,
    fileName: string,
    file: File | Blob,
    fileType: 'image' | 'video'
  ): Promise<{ url: string | null; error: string | null }> {
    return this.uploadFile(projectId, `local/${fileName}`, file);
  }

  /**
   * Delete a file via the backend socket. `bucket` is the project name and
   * `path` is `<projectType>/<relativePath>`.
   */
  async deleteFile(bucket: string, path: string): Promise<{ success: boolean; error: string | null }> {
    if (!this.isBrowser) {
      return { success: false, error: 'Not in browser environment' };
    }

    try {
      const projectType: 'local' | 'hosted' = path.startsWith('hosted/') ? 'hosted' : 'local';
      const relativePath = path.replace(/^(local|hosted)\//, '');

      const response = await firstValueFrom(
        this.socketService.deleteFile(bucket, projectType, relativePath)
      );

      if (response && response.success) {
        return { success: true, error: null };
      }
      return { success: false, error: response?.message || 'Delete failed' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Delete a project asset via the backend socket.
   */
  async deleteProjectAsset(
    projectId: string,
    fileName: string,
    fileType: 'image' | 'video'
  ): Promise<{ success: boolean; error: string | null }> {
    return this.deleteFile(projectId, `local/${fileName}`);
  }

  /**
   * Listing arbitrary bucket folders is not supported by the disk-backed backend.
   */
  async listFiles(_bucket: string, _folder: string): Promise<{ files: any[] | null; error: string | null }> {
    return { files: [], error: null };
  }

  /**
   * Build the public URL for a stored file served from `/projects/...`.
   */
  getPublicUrl(_bucket: string, path: string): string {
    if (path.startsWith('http')) return path;
    return `${getServerConfig()}/projects/${path}`;
  }

  /**
   * Convert a base64 data URL to a File/Blob.
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
