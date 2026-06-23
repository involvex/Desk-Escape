import type { OpencodeClient } from "@opencode-ai/sdk/client";

export type PermissionResponse = "once" | "always" | "reject";

export interface PendingPermission {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  receivedAt: string;
}

export function isPermissionEvent(event: {
  type: string;
  properties?: Record<string, unknown>;
}): event is {
  type: "permission.asked" | "permission.requested";
  properties: Record<string, unknown>;
} {
  return (
    event.type === "permission.asked" ||
    event.type === "permission.requested" ||
    event.type === "permission.updated"
  );
}

export function parsePermissionEvent(event: {
  type: string;
  properties?: Record<string, unknown>;
}): PendingPermission | null {
  if (!isPermissionEvent(event) || !event.properties) {
    return null;
  }

  const props = event.properties;
  const id = String(props.id ?? props.permissionID ?? props.permissionId ?? "");
  const sessionId = String(
    props.sessionID ?? props.sessionId ?? props.session_id ?? "",
  );

  if (!id || !sessionId) {
    return null;
  }

  return {
    id,
    sessionId,
    title: String(props.title ?? props.name ?? "Agent permission"),
    description: String(
      props.description ?? props.message ?? props.pattern ?? "",
    ),
    receivedAt: new Date().toISOString(),
  };
}

export async function respondToPermission(
  client: OpencodeClient,
  input: {
    sessionId: string;
    permissionId: string;
    response: PermissionResponse;
    directory?: string | null;
  },
): Promise<void> {
  const httpClient = client as unknown as {
    _client: {
      post: (options: {
        url: string;
        body: { response: PermissionResponse };
        query?: { directory?: string };
      }) => Promise<{ error?: unknown }>;
    };
  };

  const result = await httpClient._client.post({
    url: `/session/${input.sessionId}/permissions/${input.permissionId}`,
    body: { response: input.response },
    ...(input.directory ? { query: { directory: input.directory } } : {}),
  });

  if (result.error) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "Failed to respond to permission.",
    );
  }
}
