import * as Notifications from "expo-notifications";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import {
  dismissHead,
  enqueue,
  head,
  mergeRehydrated,
  removeById,
  shouldNotify,
} from "@/api/permission-queue";
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
  /** Outstanding requests behind `pending`. `0` when nothing else is waiting. */
  pendingCount: number;
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
  const [queue, setQueue] = useState<PendingPermission[]>([]);
  /**
   * Ids the user has already been told about, so a replayed
   * `permission.asked` does not send the same push twice.
   *
   * Deliberately not the queue: reading the queue would make `handlePermission`
   * depend on it, and the SSE subscription depends on `handlePermission`, so
   * every enqueue would tear down and rebuild the listener — losing requests in
   * exactly the gap this queue exists to cover. Written only from the event
   * handler, never during render.
   */
  const announcedRef = useRef<Set<string>>(new Set());

  // Derived, not stored: the queue is the single source of truth, so there is
  // no way for the two to drift.
  const pending = head(queue);
  const pendingCount = queue.length;

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

      // Decide notification against the pre-enqueue announcement set, then mark it.
      // Both happen here, in the handler, so there is no window between the two
      // and no render-phase ref write.
      const isNew = shouldNotify(announcedRef.current, permission.id);
      announcedRef.current.add(permission.id);
      setQueue((current) => enqueue(current, permission));

      if (isNew && appState !== "active") {
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

  // Announcement bookkeeping only means anything within one connection to one
  // directory, so start over when either changes.
  useEffect(() => {
    announcedRef.current = new Set();
  }, [v2Client, activeDirectory]);

  useEffect(() => {
    if (!v2Client || !eventBus) return;

    const unsubscribe = eventBus.onEvent((event) => {
      // `permission.replied` closes the request, whoever answered it.
      const replied = parsePermissionRepliedEvent(event);
      if (replied) {
        // Close by id, not by position: the reply can be for any request in the
        // queue (another client, or the notification action).
        setQueue((current) => removeById(current, replied.id));
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
  // *every* request the server already considers pending for this location, so
  // a request that arrived while the app was closed is not lost. Adopting only
  // the first is what made the rest unreachable until the next reconnect.
  useEffect(() => {
    if (!v2Client) return;

    let cancelled = false;
    void listPendingPermissions(v2Client, activeDirectory)
      .then((requests) => {
        if (cancelled || requests.length === 0) return;
        const incoming = requests.map((request) =>
          toPendingPermission(request),
        );
        setQueue((current) => mergeRehydrated(current, incoming));
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
          // Bind to locals: the state updater below runs in a closure, and
          // TypeScript does not carry property narrowing into one.
          const { permissionId, sessionId } = data;
          // Handle action buttons (Allow, Reject, Always Allow)
          const action = response.actionIdentifier as PermissionAction;
          if (
            action === "allow" ||
            action === "reject" ||
            action === "always-allow"
          ) {
            if (v2Client) {
              replyToPermission(v2Client, {
                sessionId,
                permissionId,
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
          setQueue((current) =>
            enqueue(current, {
              id: permissionId,
              sessionId,
              action: "",
              resources: [],
              message: "",
              title:
                response.notification.request.content.title ?? "Permission",
              description:
                response.notification.request.content.body?.toString() ?? "",
              receivedAt: new Date().toISOString(),
            }),
          );
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

      // Capture the request being answered up front. A new request can arrive
      // while the reply is in flight, and closing "the pending slot" on success
      // would throw that one away — the agent would then wait forever on a
      // prompt nobody can see.
      const answered = pending;

      setBusy(true);
      setError(null);
      try {
        await replyToPermission(v2Client, {
          sessionId: answered.sessionId,
          permissionId: answered.id,
          response,
        });
        setQueue((current) => removeById(current, answered.id));
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
    // "Not now" — hide the current request and move to the next one. The
    // request stays pending on the server and returns on the next
    // rehydration, which is what dismissing has always meant.
    setQueue(dismissHead);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      pending,
      pendingCount,
      respond,
      dismiss,
      busy,
      error,
      clearError,
    }),
    [busy, clearError, dismiss, error, pending, pendingCount, respond],
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
