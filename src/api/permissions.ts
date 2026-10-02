import type {
  OpenCodeClient,
  PermissionReply,
  PermissionRequest,
  PermissionSavedInfo,
  V2Event,
} from "@opencode/client";

import { withOpenCodeErrors } from "./opencode/errors";
import { withLocation } from "./opencode/location";

export type { PermissionReply, PermissionRequest, PermissionSavedInfo };

/** V2 replies are still `"once" | "always" | "reject"`. */
export type PermissionResponse = PermissionReply;

/**
 * The banner's view of a pending permission request.
 *
 * `title`/`description` are derived, presentation-only fields kept because
 * `src/services/notifications.ts` (not owned by this module) builds the push
 * notification from them. `action`/`resources`/`message` are the V2 payload.
 */
export interface PendingPermission {
  id: string;
  /** V2 spells it `sessionID`; renamed to the app's `Id` casing. */
  sessionId: string;
  /** e.g. `"bash"`, `"edit"`, `"webfetch"`. */
  action: string;
  /** V2 pluralised this: V1 had a single `resource`. */
  resources: string[];
  /** Human-facing prompt text supplied by the server. */
  message: string;
  /** Notifications-only: derived headline, never empty. */
  title: string;
  /** Notifications-only: derived one-liner, never null. */
  description: string;
  receivedAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  bash: "Run a shell command",
  edit: "Edit files",
  write: "Write files",
  patch: "Edit files",
  read: "Read files",
  webfetch: "Fetch a web page",
  websearch: "Search the web",
  external_directory: "Access a directory outside the workspace",
  doom_loop: "Continue an agent loop",
};

function humanizeAction(action: string): string {
  if (!action) {
    return "Agent permission";
  }
  const known = ACTION_LABELS[action];
  if (known) {
    return known;
  }
  const spaced = action.replace(/[._-]+/g, " ").trim();
  if (!spaced) {
    return "Agent permission";
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function describeResources(resources: readonly string[]): string {
  if (resources.length === 0) {
    return "";
  }
  if (resources.length === 1) {
    return resources[0] ?? "";
  }
  const head = resources.slice(0, 3).join(", ");
  const rest = resources.length - 3;
  return rest > 0 ? `${head} (+${rest} more)` : head;
}

/** Map a V2 `PermissionRequest` onto the shape the banner and notifications use. */
export function toPendingPermission(
  request: PermissionRequest,
  receivedAt = new Date().toISOString(),
): PendingPermission {
  const resources = [...(request.resources ?? [])];
  const message = request.message ?? "";
  const resourcesLine = describeResources(resources);

  return {
    id: request.id,
    sessionId: request.sessionID,
    action: request.action,
    resources,
    message,
    title: humanizeAction(request.action),
    description: message || resourcesLine,
    receivedAt,
  };
}

/** V2 emits `permission.asked`; V1's `permission.requested` is gone. */
export function isPermissionAskedEvent(event: V2Event): boolean {
  return event.type === "permission.asked";
}

/**
 * Read a `permission.asked` event.
 *
 * The payload shape is documented and stable in V2, so this reads it directly
 * rather than probing a dozen aliases. Ids still fall back to `""` and a
 * request missing either id is dropped: a malformed event must never take the
 * banner down with it.
 */
export function parsePermissionEvent(event: V2Event): PendingPermission | null {
  if (!isPermissionAskedEvent(event)) {
    return null;
  }
  const data = event.data as Partial<PermissionRequest> | undefined;
  if (!data) {
    return null;
  }

  const id = data.id ?? "";
  const sessionId = data.sessionID ?? "";
  if (!id || !sessionId) {
    return null;
  }

  return toPendingPermission({
    id,
    sessionID: sessionId,
    action: data.action ?? "",
    resources: data.resources ?? [],
    ...(data.save ? { save: data.save } : {}),
    ...(data.metadata ? { metadata: data.metadata } : {}),
    ...(data.source ? { source: data.source } : {}),
    ...(data.message ? { message: data.message } : {}),
  });
}

/** V2 emits `permission.replied` (there is no `permission.updated`). */
export function isPermissionRepliedEvent(event: V2Event): boolean {
  return event.type === "permission.replied";
}

/** Identify the request a `permission.replied` event closes, if any. */
export function parsePermissionRepliedEvent(event: V2Event): {
  id: string;
  sessionId: string;
} | null {
  if (!isPermissionRepliedEvent(event)) {
    return null;
  }
  const data = event.data as
    { requestID?: string; sessionID?: string } | undefined;
  const id = data?.requestID ?? "";
  if (!id) {
    return null;
  }
  return { id, sessionId: data?.sessionID ?? "" };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * Answer a permission request.
 *
 * V2 has a first-class endpoint for this, which removes the V1 hack that
 * reached into the private `client._client.post(...)` to hand-roll a URL.
 * `sessionID` is mandatory: the route is session-scoped.
 *
 * Resolves to `undefined` on success — the server answers `204 No Content`,
 * so there is no body to read.
 */
export async function replyToPermission(
  client: OpenCodeClient,
  input: {
    sessionId: string;
    permissionId: string;
    response: PermissionResponse;
    /** Optional note forwarded to the agent alongside a rejection. */
    message?: string;
  },
): Promise<void> {
  await withOpenCodeErrors(() =>
    client.permission.reply({
      sessionID: input.sessionId,
      requestID: input.permissionId,
      decision: input.response,
      ...(input.message ? { message: input.message } : {}),
    }),
  );
}

/** Pending requests for one session. */
export async function listSessionPermissions(
  client: OpenCodeClient,
  sessionId: string,
): Promise<PermissionRequest[]> {
  return withOpenCodeErrors(() =>
    client.permission.list({ sessionID: sessionId }),
  );
}

/**
 * Pending requests across the whole location, as `{ location, data }`.
 * A `location` scope is what replaced V1's flat `?directory=` query.
 */
export async function listPendingPermissions(
  client: OpenCodeClient,
  directory?: string | null,
): Promise<PermissionRequest[]> {
  const result = await withOpenCodeErrors(() =>
    client.permission.request.list(withLocation(directory)),
  );
  return result.data;
}

/** "Always allow" grants previously persisted by the agent. */
export async function listSavedPermissions(
  client: OpenCodeClient,
  projectID?: string,
): Promise<PermissionSavedInfo[]> {
  return withOpenCodeErrors(() =>
    client.permission.saved.list(projectID ? { projectID } : {}),
  );
}

/** Revoke a persisted "always allow" grant. */
export async function removeSavedPermission(
  client: OpenCodeClient,
  id: string,
): Promise<void> {
  await withOpenCodeErrors(() => client.permission.saved.remove({ id }));
}
