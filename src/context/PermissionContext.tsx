import type { EventSubscribeResponse } from "@opencode-ai/sdk/client";
import * as Notifications from "expo-notifications";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  parsePermissionEvent,
  respondToPermission,
  type PendingPermission,
  type PermissionResponse,
} from "@/api/permissions";
import { useConnection } from "@/context/ConnectionContext";
import { usePreferences } from "@/context/PreferencesContext";
import {
  ensureNotificationPermissions,
  notifyPermissionRequest,
} from "@/services/notifications";

interface PermissionContextValue {
  pending: PendingPermission | null;
  respond: (response: PermissionResponse) => Promise<void>;
  dismiss: () => void;
}

const PermissionContext = createContext<PermissionContextValue | undefined>(
  undefined,
);

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { client, activeDirectory } = useConnection();
  const { autoApprovePermissions } = usePreferences();
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );

  const handlePermission = useCallback(
    async (permission: PendingPermission) => {
      if (autoApprovePermissions && client) {
        try {
          await respondToPermission(client, {
            sessionId: permission.sessionId,
            permissionId: permission.id,
            response: "always",
            directory: activeDirectory,
          });
        } catch {
          setPending(permission);
        }
        return;
      }

      setPending(permission);

      if (appState !== "active") {
        const allowed = await ensureNotificationPermissions();
        if (allowed) {
          await notifyPermissionRequest(permission);
        }
      }
    },
    [activeDirectory, appState, autoApprovePermissions, client],
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", setAppState);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!client) {
      return;
    }

    let active = true;
    const abort = new AbortController();

    void (async () => {
      try {
        const subscription = await client.event.subscribe({
          signal: abort.signal,
        });

        for await (const event of subscription.stream) {
          if (!active) {
            break;
          }

          const permission = parsePermissionEvent(
            event as EventSubscribeResponse & {
              properties?: Record<string, unknown>;
            },
          );

          if (permission) {
            void handlePermission(permission);
          }
        }
      } catch {
        // SSE may be unavailable on some hosts.
      }
    })();

    return () => {
      active = false;
      abort.abort();
    };
  }, [client, handlePermission]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as {
          type?: string;
          permissionId?: string;
          sessionId?: string;
        };

        if (data.type === "permission" && data.permissionId && data.sessionId) {
          setPending({
            id: data.permissionId,
            sessionId: data.sessionId,
            title: response.notification.request.content.title ?? "Permission",
            description:
              response.notification.request.content.body?.toString() ?? "",
            receivedAt: new Date().toISOString(),
          });
        }
      },
    );

    return () => sub.remove();
  }, []);

  const respond = useCallback(
    async (response: PermissionResponse) => {
      if (!client || !pending) {
        return;
      }

      await respondToPermission(client, {
        sessionId: pending.sessionId,
        permissionId: pending.id,
        response,
        directory: activeDirectory,
      });
      setPending(null);
    },
    [activeDirectory, client, pending],
  );

  const dismiss = useCallback(() => {
    setPending(null);
  }, []);

  const value = useMemo(
    () => ({ pending, respond, dismiss }),
    [dismiss, pending, respond],
  );

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermission(): PermissionContextValue {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error("usePermission must be used within PermissionProvider.");
  }
  return context;
}
