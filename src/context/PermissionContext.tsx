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
  type PermissionAction,
  actionToResponse,
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
  const { client, activeDirectory, eventBus } = useConnection();
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
    if (!client || !eventBus) return;

    const unsubscribe = eventBus.onEvent((event: unknown) => {
      const permissionData = parsePermissionEvent(
        event as { type: string; properties?: Record<string, unknown> },
      );
      if (permissionData) {
        handlePermission(permissionData);
      }
    });

    return unsubscribe;
  }, [client, eventBus, handlePermission]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as {
          type?: string;
          permissionId?: string;
          sessionId?: string;
        };

        if (data.type === "permission" && data.permissionId && data.sessionId) {
          // Handle action buttons (Allow, Reject, Always Allow)
          const action = response.actionIdentifier as PermissionAction;
          if (
            action === "allow" ||
            action === "reject" ||
            action === "always-allow"
          ) {
            if (client) {
              respondToPermission(client, {
                sessionId: data.sessionId,
                permissionId: data.permissionId,
                response: actionToResponse(action),
                directory: activeDirectory,
              }).catch((error) => {
                console.error(
                  "Failed to respond to permission via notification:",
                  error,
                );
              });
            }
            return;
          }

          // Default: app opened without action, show in-app banner
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
  }, [activeDirectory, client]);

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
