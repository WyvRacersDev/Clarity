/**
 * CollabService — the single business boundary for realtime collaboration.
 *
 * Owns edit AUTHORIZATION, element ops, task comments, and Yjs document ops, so
 * the collab gateway depends on THIS abstraction instead of importing
 * repositories + the ydoc-registry directly (DIP), and no longer hosts
 * authorization business rules inline (SRP). The gateway keeps only transport
 * concerns: validate → call service → ack/broadcast.
 */
import {
  createElement as repoCreateElement,
  updateElementTransform as repoUpdateElementTransform,
  updateElementContent as repoUpdateElementContent,
  deleteElement as repoDeleteElement,
  elementInProject as repoElementInProject,
} from "../repositories/project.repository.js";
import {
  addComment as repoAddComment,
  listComments as repoListComments,
} from "../repositories/comment.repository.js";
import {
  applyUpdate as ydocApplyUpdate,
  encodeState as ydocEncodeState,
  encodeStateVector as ydocEncodeStateVector,
} from "../realtime/ydoc-registry.js";
import {
  AccessService,
  type Capability,
  type AuthResult,
} from "./access.service.js";

export type ProjectType = "local" | "hosted";

export type { AuthResult, Capability } from "./access.service.js";

export interface ElementTransform {
  x_pos?: number;
  y_pos?: number;
  x_scale?: number;
  y_scale?: number;
}

export class CollabService {
  /**
   * DIP: authorization is delegated to the AccessService (N1), which owns the
   * owner/admin/editor/viewer role model. Injected for testability; defaults to
   * a real instance so existing callers (`new CollabService()`) are unchanged.
   */
  constructor(private readonly access: AccessService = new AccessService()) {}

  /**
   * Authorize a user for `capability` on the named project (N1). Replaces the
   * old owner-only(local)/open(hosted) rule with the real role model: viewers
   * can `view`, editors+ can `edit`, admins+ can `manage`. Defaults to `edit` so
   * existing mutating callers keep their meaning. Returns the project id (and the
   * caller's effective role) on success.
   */
  authorize(
    projectName: string,
    projectType: ProjectType,
    username: string | undefined,
    capability: Capability = "edit"
  ): Promise<AuthResult> {
    return this.access.authorize(projectName, projectType, username, capability);
  }

  /** True when the element belongs to the given project (targeted-op guard). */
  elementInProject(elementId: string, projectId: string): Promise<boolean> {
    return repoElementInProject(elementId, projectId);
  }

  createElement(
    projectName: string,
    projectType: ProjectType,
    gridId: string | null,
    element: any
  ) {
    return repoCreateElement(projectName, projectType, gridId, element);
  }

  moveElement(elementId: string, transform: ElementTransform): Promise<boolean> {
    return repoUpdateElementTransform(elementId, transform);
  }

  updateElementContent(
    elementId: string,
    content: Record<string, unknown>
  ): Promise<boolean> {
    return repoUpdateElementContent(elementId, content);
  }

  deleteElement(elementId: string): Promise<boolean> {
    return repoDeleteElement(elementId);
  }

  addComment(taskId: string, author: string, body: string) {
    return repoAddComment(taskId, author, body);
  }

  listComments(taskId: string) {
    return repoListComments(taskId);
  }

  /** Yjs catch-up: the encoded update diff + current state vector for a doc. */
  async ydocSync(
    elementId: string,
    stateVector?: string
  ): Promise<{ update: string; stateVector: string }> {
    const update = await ydocEncodeState(elementId, stateVector);
    const sv = await ydocEncodeStateVector(elementId);
    return { update, stateVector: sv };
  }

  /** Apply a Yjs update to the authoritative server doc (debounce-persisted). */
  ydocApplyUpdate(elementId: string, update: string) {
    return ydocApplyUpdate(elementId, update);
  }
}
