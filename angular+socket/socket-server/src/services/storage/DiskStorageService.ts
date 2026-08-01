/**
 * DiskStorageService (Phase 6a) — on-disk implementation of StorageService.
 *
 * This is a verbatim relocation of the asset logic that used to live inline in
 * the `uploadFile` / `deleteFile` socket handlers. Directory resolution,
 * filename sanitization, the unique-name scheme, the base64 decoding, the
 * relative-path computation (forward slashes), and the path-traversal security
 * check are all preserved byte-for-byte so returned `filePath` strings and disk
 * layout are unchanged.
 */
import fs from "fs";
import path from "path";
import type { ProjectPaths } from "../project.service.js";
import type {
  StorageService,
  SaveAssetResult,
  DeleteAssetResult,
  ProjectType,
} from "./StorageService.js";

export class DiskStorageService implements StorageService {
  // Depend only on the narrow ProjectPaths collaborator (DIP), reusing its
  // path/sanitize helpers so disk layout + returned paths stay identical.
  constructor(private readonly project_handler: ProjectPaths) {}

  async saveAsset(
    projectName: string,
    projectType: ProjectType,
    fileName: string,
    fileData: string,
    fileType: "image" | "video"
  ): Promise<SaveAssetResult> {
    const assetsDir = this.project_handler.getProjectAssetsDirectory(
      projectName,
      projectType
    );

    // Generate a unique filename to avoid conflicts
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    const fileExtension =
      fileType === "image"
        ? fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)?.[1] || "png"
        : fileName.match(/\.(mp4|webm|ogg)$/i)?.[1] || "mp4";

    const safeFileName =
      this.project_handler.sanitizeFilename(fileName.replace(/\.[^/.]+$/, "")) ||
      "file";
    const uniqueFileName = `${safeFileName}_${timestamp}_${randomStr}.${fileExtension}`;
    const filePath = path.join(assetsDir, uniqueFileName);

    // Convert base64 to buffer and save
    const base64Data = fileData.replace(/^data:.*,/, ""); // Remove data URL prefix
    const buffer = Buffer.from(base64Data, "base64");
    fs.writeFileSync(filePath, buffer);

    // A11: return the path RELATIVE TO THE PROJECTS BASE, so it includes the
    // `local/` or `hosted/` segment and can be appended directly to the
    // documented `/projects` static route (`/projects/<filePath>`). Previously
    // this was relative to the type directory, omitting the segment — the served
    // URL then 404'd unless the client re-inserted `local`/`hosted` by hand.
    const basePath = this.project_handler.get_base_path();
    const relativePath = path.relative(basePath, filePath).replace(/\\/g, "/"); // forward slashes for web

    return { filePath: relativePath, fileName: uniqueFileName };
  }

  async deleteAsset(
    projectName: string,
    projectType: ProjectType,
    filePath: string
  ): Promise<DeleteAssetResult> {
    console.log(
      `[Server] deleteFile called: projectName="${projectName}", projectType="${projectType}", filePath="${filePath}"`
    );

    const projectDir = this.project_handler.getProjectDirectory(projectType);
    console.log(`[Server] Project directory: ${projectDir}`);

    const fullFilePath = path.join(projectDir, filePath);
    console.log(`[Server] Full file path: ${fullFilePath}`);

    // Security check: ensure the file is within the project directory
    const normalizedFilePath = path.normalize(fullFilePath);
    const normalizedProjectDir = path.normalize(projectDir);
    console.log(`[Server] Normalized file path: ${normalizedFilePath}`);
    console.log(`[Server] Normalized project dir: ${normalizedProjectDir}`);

    if (!normalizedFilePath.startsWith(normalizedProjectDir)) {
      console.error(
        `[Server] ✗ Security check failed: file path outside project directory`
      );
      throw new Error("Invalid file path: outside project directory");
    }

    // Check if file exists
    if (fs.existsSync(normalizedFilePath)) {
      console.log(`[Server] ✓ File exists, deleting...`);
      fs.unlinkSync(normalizedFilePath);
      console.log(`[Server] ✓ Successfully deleted file: ${normalizedFilePath}`);
      return { success: true, message: `File deleted successfully` };
    }

    console.warn(`[Server] ⚠ File not found: ${normalizedFilePath}`);
    return { success: false, message: `File not found: ${filePath}` };
  }
}
