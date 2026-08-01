/**
 * StorageService (Phase 6a) — abstraction over on-disk project assets.
 *
 * Behavior-preserving extraction of the asset logic that previously lived inline
 * in the `uploadFile`/`deleteFile` socket handlers in `src/index.ts`. The disk
 * paths (`projects/<name>_assets/...`) and the returned relative `filePath`
 * strings are IDENTICAL to before; this only moves the code behind an interface
 * so a future S3/R2 backend can be swapped in without touching the handlers.
 */

export type ProjectType = "local" | "hosted";

export interface SaveAssetResult {
  /** Relative path from the project-type directory, forward-slashed (web-safe). */
  filePath: string;
  /** The generated unique file name. */
  fileName: string;
}

export interface DeleteAssetResult {
  success: boolean;
  message: string;
}

export interface StorageService {
  /**
   * Persist a (base64 / data-URL) asset for a project and return the relative
   * `filePath` used by the client, plus the generated unique file name.
   */
  saveAsset(
    projectName: string,
    projectType: ProjectType,
    fileName: string,
    fileData: string,
    fileType: "image" | "video"
  ): Promise<SaveAssetResult>;

  /**
   * Delete an asset given the relative `filePath` produced by `saveAsset`.
   * Returns `{ success:false }` (rather than throwing) when the file is missing,
   * matching the previous handler's file-not-found response.
   */
  deleteAsset(
    projectName: string,
    projectType: ProjectType,
    filePath: string
  ): Promise<DeleteAssetResult>;
}
