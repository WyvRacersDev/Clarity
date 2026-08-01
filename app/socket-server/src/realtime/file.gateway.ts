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
import { MAX_UPLOAD_BYTES } from "../config/index.js";
import { clientError } from "../lib/clientError.js";

/**
 * Resolve the ack event name for a file op (A10/A11). The client passes a unique
 * `eventName` and listens on exactly that; if the server acks on a DIFFERENT
 * event, the client's `.once(eventName)` never fires and the upload appears to
 * hang until its own timeout. So EVERY response — validation failure, oversize,
 * success, or thrown error — must go to this one event. When no `eventName` is
 * supplied we fall back to the documented static event (`fileUploaded` /
 * `fileDeleted`) rather than a random `..._<ts>_<rand>` name no client can hear.
 */
function ackEvent(rawEventName: unknown, fallback: string): string {
  return typeof rawEventName === "string" && rawEventName.length > 0
    ? rawEventName
    : fallback;
}

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
      // Resolve the ack event up front so EVERY exit path (invalid payload,
      // oversize, success, error) acks on the event the client is listening to
      // (A10 — otherwise the client hangs until its own timeout).
      const eventName = ackEvent((data as any)?.eventName, "fileUploaded");

      const parsed = uploadFileSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit(eventName, { success: false, message: formatZodError(parsed.error) });
        return;
      }

      // Enforce a max payload size before persisting. `fileData` is a base64
      // string; its UTF-8 byte length is the encoded size on the wire. We bound
      // against that (a small overhead vs. the decoded bytes, which is fine as a
      // ceiling). If it's too big, do NOT persist — ack an error and bail.
      // FUTURE: switch to streamed/multipart uploads so large files never have
      // to be buffered fully in memory as a single base64 frame.
      const payloadBytes = Buffer.byteLength(data.fileData ?? "", "utf8");
      if (payloadBytes > MAX_UPLOAD_BYTES) {
        socket.emit(eventName, {
          success: false,
          message: `File too large: ${payloadBytes} bytes exceeds the ${MAX_UPLOAD_BYTES} byte limit.`,
        });
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

        socket.emit(eventName, {
          success: true,
          filePath,
          fileName,
          message: `File uploaded successfully`,
        });
      } catch (error: any) {
        console.error("Error uploading file:", error);
        socket.emit(eventName, {
          success: false,
          message: clientError("upload the file"),
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
      // Ack on the client's event for every exit path (see uploadFile above).
      const eventName = ackEvent((data as any)?.eventName, "fileDeleted");

      const parsed = deleteFileSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit(eventName, { success: false, message: formatZodError(parsed.error) });
        return;
      }
      try {
        const result = await storage.deleteAsset(data.projectName, data.projectType, data.filePath);

        socket.emit(eventName, {
          success: result.success,
          message: result.message,
        });
      } catch (error: any) {
        console.error(`[Server] ✗ Error deleting file:`, error);
        socket.emit(eventName, {
          success: false,
          message: clientError("delete the file"),
        });
      }
    }
  );
}
