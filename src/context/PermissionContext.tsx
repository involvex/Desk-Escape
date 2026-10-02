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
  listPendingPermissions,
  parsePermissionEvent,
  parsePermissionRepliedEvent,
  replyToPermission,
  toPendingPermission,
  type PendingPermission,
  type PermissionResponse,
} from "@/api/permissions";
import { toOpenCodeError } from "@/api/opencode/errors";
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
  /** `true` while a reply is in flight, so the banner can disable its buttons. */
  busy: boolean;
  /** Last failure message, or `null`. */
  error: string | null;
  clearError: () => void;
}

const PermissionContext = createContext<PermissionContextValue | undefined>(
  undefined,
);

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { client: v2Client, activeDirectory, eventBus } = useConnection();
  const { autoApprovePermissions } = usePreferences();
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );

  const handlePermission = useCallback(
    async (permission: PendingPermission) => {
      if (autoApprovePermissions && v2Client) {
        try {
          await replyToPermission(v2Client, {
            sessionId: permission.sessionId,
            permissionId: permission.id,
            response: "always",
          });
          return;
        } catch {
          // Fall through and ask the user instead of silently dropping it.
        }
      }

      setPending(permission);

      if (appState !== "active") {
        const allowed = await ensureNotificationPermissions();
        if (allowed) {
          await notifyPermissionRequest(permission);
        }
      }
    },
    [appState, autoApprovePermissions, v2Client],
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", setAppState);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!v2Client || !eventBus) return;

    const unsubscribe = eventBus.onEvent((event) => {
      // `permission.replied` closes the request, whoever answered it.
      const replied = parsePermissionRepliedEvent(event);
      if (replied) {
        setPending((current) => (current?.id === replied.id ? null : current));
        return;
      }

      const permission = parsePermissionEvent(event);
      if (permission) {
        void handlePermission(permission);
      }
    });

    return unsubscribe;
  }, [v2Client, eventBus, handlePermission]);

  // The banner shows one request at a time. On mount (or on reconnect) adopt
  // whatever the server already considers pending for this location so a
  // request that arrived while the app was closed is not lost.
  useEffect(() => {
    if (!v2Client) return;

    let cancelled = false;
    void listPendingPermissions(v2Client, activeDirectory)
      .then((requests) => {
        const first = requests[0];
        if (cancelled || !first) return;
        setPending((current) => current ?? toPendingPermission(first));
      })
      .catch(() => {
        // A failed rehydration is not worth surfacing; the SSE stream still
        // delivers anything that arrives from here on.
      });

    return () => {
      cancelled = true;
    };
  }, [v2Client, activeDirectory]);

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
            if (v2Client) {
              replyToPermission(v2Client, {
                sessionId: data.sessionId,
                permissionId: data.permissionId,
                response: actionToResponse(action),
              }).catch((replyError) => {
                console.error(
                  "Failed to respond to permission via notification:",
                  toOpenCodeError(replyError).message,
                );
              });
            }
            return;
          }

          // Default: app opened without action, show in-app banner.
          setPending({
            id: data.permissionId,
            sessionId: data.sessionId,
            action: "",
            resources: [],
            message: "",
            title: response.notification.request.content.title ?? "Permission",
            description:
              response.notification.request.content.body?.toString() ?? "",
            receivedAt: new Date().toISOString(),
          });
        }
      },
    );

    return () => sub.remove();
  }, [v2Client]);

  const respond = useCallback(
    async (response: PermissionResponse) => {
      if (!v2Client || !pending) {
        return;
      }

      setBusy(true);
      setError(null);
      try {
        await replyToPermission(v2Client, {
          sessionId: pending.sessionId,
          permissionId: pending.id,
          response,
        });
        setPending(null);
      } catch (replyError) {
        setError(toOpenCodeError(replyError).message);
        throw replyError;
      } finally {
        setBusy(false);
      }
    },
    [v2Client, pending],
  );

  const dismiss = useCallback(() => {
    setPending(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo(
    () => ({ pending, respond, dismiss, busy, error, clearError }),
    [busy, clearError, dismiss, error, pending, respond],
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
