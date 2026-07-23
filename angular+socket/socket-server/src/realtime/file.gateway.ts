/**
 * File gateway (Phase 6a) — uploadFile / deleteFile.
 *
 * Behavior-preserving extraction from `src/index.ts`. The on-disk asset logic
 * now lives behind `StorageService` (DiskStorageService), but the response
 * events, the dynamic `eventName` fallback (including its timestamp+random
 * scheme), the returned relative `filePath`, and the success/error shapes are
 * unchanged. zod validation is added at the top.
 */
import type { Server, Socket } from "socket.io";
import type { GatewayDeps } from "./types.js";
import { uploadFileSchema, deleteFileSchema, formatZodError } from "../validation/schemas.js";

export function register(_io: Server, socket: Socket, deps: GatewayDeps): void {
  const { storage } = deps;

  /**
   * Upload a file (image or video) for a project
   * Expected payload: { projectName, projectType, fileName, fileData (base64), fileType }
   */
  socket.on(
    "uploadFile",
    async (data: {
      projectName: string;
      projectType: "local" | "hosted";
      fileName: string;
      fileData: string;
      fileType: "image" | "video";
      eventName?: string;
    }) => {
      const parsed = uploadFileSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit("fileUploaded", { success: false, message: formatZodError(parsed.error) });
        return;
      }
      try {
        const { filePath, fileName } = await storage.saveAsset(
          data.projectName,
          data.projectType,
          data.fileName,
          data.fileData,
          data.fileType
        );

        const eventName =
          data.eventName ||
          `fileUploaded_${data.projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        socket.emit(eventName, {
          success: true,
          filePath,
          fileName,
          message: `File uploaded successfully`,
        });
      } catch (error: any) {
        console.error("Error uploading file:", error);
        socket.emit("fileUploaded", {
          success: false,
          message: `Failed to upload file: ${error.message}`,
        });
      }
    }
  );

  /**
   * Delete a file (image or video) for a project
   * Expected payload: { projectName, projectType, filePath (relative path) }
   */
  socket.on(
    "deleteFile",
    async (data: {
      projectName: string;
      projectType: "local" | "hosted";
      filePath: string;
      eventName?: string;
    }) => {
      const parsed = deleteFileSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit("fileDeleted", { success: false, message: formatZodError(parsed.error) });
        return;
      }
      try {
        const result = await storage.deleteAsset(data.projectName, data.projectType, data.filePath);

        const eventName =
          data.eventName ||
          `fileDeleted_${data.projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        socket.emit(eventName, {
          success: result.success,
          message: result.message,
        });
      } catch (error: any) {
        console.error(`[Server] ✗ Error deleting file:`, error);
        const eventName =
          data.eventName ||
          `fileDeleted_${data.projectName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        socket.emit(eventName, {
          success: false,
          message: `Failed to delete file: ${error.message}`,
        });
      }
    }
  );
}
