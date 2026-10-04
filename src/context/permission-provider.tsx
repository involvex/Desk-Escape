import * as Notifications from "expo-notifications";
import type { OpenCodeClient } from "@opencode/client";
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
import {
  classifyPermissionResponse,
  deferReply,
  removeDeferredReply,
  type DeferredReply,
  type NotificationResponseLike,
  type PermissionIntent,
} from "@/api/notification-replies";
import { useConnection } from "@/context/ConnectionContext";
import { usePreferences } from "@/context/PreferencesContext";
import {
  ensureNotificationPermissions,
  notifyPermissionRequest,
} from "@/services/notifications";

/**
 * What `usePermission` reports.
 *
 * Exported so the seam module can re-export it, and so a test can name the shape it
 * is driving rather than restating it.
 */
export interface PermissionContextValue {
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
  /**
   * Replies the user committed to by tapping a notification while the app had no
   * client, waiting to be sent.
   *
   * Exposed rather than kept private because a held reply is user intent that has not
   * reached the agent yet, and the user is entitled to know their tap landed. The
   * banner shows it as "1 reply waiting for the connection"; `0` when there are none.
   */
  deferredCount: number;
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
  /**
   * Replies tapped into existence with no client to send them.
   *
   * Held in state rather than a ref because the count is reported to the banner, and
   * because the flush effect must re-run when it changes. A ref would need a second
   * source of truth to drive the render.
   */
  const [deferred, setDeferred] = useState<DeferredReply[]>([]);
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
  // directory, so start over when either changes. The same is true of which
  // notifications have been acted on: a new connection means a new server, and its
  // notification ids have nothing to do with the previous one's.
  useEffect(() => {
    announcedRef.current = new Set();
    handledNotificationsRef.current = new Set();
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

  /**
   * Send a reply, or hold it until a client can.
   *
   * Split out because it is the answer to the question this module got wrong: what
   * happens to a tap that arrives with no client. The answer is that it is held, and
   * the request stays visible, so the interaction is completed rather than lost.
   */
  const deliverReply = useCallback(
    async (
      client: OpenCodeClient,
      intent: Extract<PermissionIntent, { kind: "action" }>,
    ) => {
      await replyToPermission(client, {
        sessionId: intent.sessionId,
        permissionId: intent.permissionId,
        response: intent.response,
      });
      // Cleared on success only. A failure keeps it queued, where the banner shows
      // the error and the user can press again — a dropped reply would leave the
      // agent blocked on a prompt that now looks answered.
      setDeferred((current) =>
        removeDeferredReply(current, intent.permissionId),
      );
    },
    [],
  );

  /**
   * Notification ids already acted on.
   *
   * A response can reach the app by two routes at once: read from the cold-start slot
   * and handed to the listener. Read-after-register is deliberate — it is what closes
   * the gap between the two — so the overlap is designed in, and this is what makes it
   * safe. Two replies for one tap would have the server accept the first and reject
   * the second, and the rejection would surface as an error on an approval the user
   * genuinely gave.
   *
   * Keyed on the OS's notification id, matching `isSameNotification` and the package's
   * own `determineNextResponse`, so a repeat is recognisable however it arrives.
   *
   * Grows with the number of notifications the user acted on, which is bounded by how
   * many they tapped — and a response for a notification already handled is wrong every
   * time, so there is nothing to gain from forgetting one. Reset with the connection
   * for the same reason as `announcedRef`.
   */
  const handledNotificationsRef = useRef<Set<string>>(new Set());

  /**
   * Act on a notification response.
   *
   * One path for both delivery routes — a live tap and a cold-start re-read — so the
   * two cannot drift. The old code handled only the first.
   */
  const handleNotificationResponse = useCallback(
    async (raw: unknown) => {
      const intent = classifyPermissionResponse(
        raw as NotificationResponseLike,
      );

      if (intent.kind === "ignored") {
        // Named, not silent: a response the app declines to act on should be
        // traceable, and "ignored" without a reason is the vocabulary in which the
        // original bug was invisible.
        console.warn(`Ignoring notification response: ${intent.reason}.`);
        return;
      }

      // Checked after classification, so a notification from another feature never
      // enters the set, and before anything observable happens, so the second
      // delivery of one notification does nothing at all.
      if (handledNotificationsRef.current.has(intent.notificationId)) {
        return;
      }
      handledNotificationsRef.current.add(intent.notificationId);

      // Bind to locals: the state updaters below run inside closures, and TypeScript
      // does not carry property narrowing into one.
      const { permissionId, sessionId } = intent;

      // The request goes into the visible queue **first**, whatever the tap was.
      //
      // This is the other half of the fix. The old code returned as soon as it saw an
      // action, so tapping "Allow" while disconnected left the request in no queue at
      // all — invisible in the app *and* unanswered. Putting it in the queue first
      // means the request is reachable even if everything after this throws.
      setQueue((current) =>
        enqueue(current, {
          id: permissionId,
          sessionId,
          action: "",
          resources: [],
          message: "",
          title: intent.kind === "open" ? intent.title : "Permission",
          description: intent.kind === "open" ? intent.body : "",
          receivedAt: new Date().toISOString(),
        }),
      );

      // A plain open has nothing to send: the banner is the whole response.
      if (intent.kind === "open") {
        return;
      }

      if (!v2Client) {
        // Held, not dropped. `deferReply` is keyed on the permission, so a replayed
        // notification for the same request replaces rather than doubles up.
        setDeferred((current) =>
          deferReply(current, {
            permissionId,
            sessionId,
            response: intent.response,
            action: intent.action,
          }),
        );
        return;
      }

      try {
        await deliverReply(v2Client, intent);
      } catch (replyError) {
        // Held for a retry once a client exists, and the banner keeps it visible.
        setDeferred((current) =>
          deferReply(current, {
            permissionId,
            sessionId,
            response: intent.response,
            action: intent.action,
          }),
        );
        setError(toOpenCodeError(replyError).message);
      }
    },
    [deliverReply, v2Client],
  );

  useEffect(() => {
    const handler = (response: unknown) => {
      void handleNotificationResponse(response);
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handler);

    // The cold start, and the reason this is here at all.
    //
    // A tap on a permission action foregrounds the app, but the response is handed to
    // the emitter *before* this listener exists — `useLastNotificationResponse` in the
    // package reads the last response first for exactly this reason, "in case it was
    // set earlier (even in native code on startup)". Read after registering, so the
    // two routes overlap rather than leaving a gap; `isSameNotification` is what stops
    // the overlap from answering twice.
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      handler(last);
      Notifications.clearLastNotificationResponse();
    }

    return () => sub.remove();
  }, [handleNotificationResponse]);

  /**
   * Send everything that was tapped while there was no client.
   *
   * Runs whenever the client appears, which is the transition that makes the held
   * replies sendable. Cleared entry by entry as each succeeds, so one failure does
   * not discard the rest and the next reconnect retries only what is still held.
   */
  useEffect(() => {
    if (!v2Client || deferred.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const entry of deferred) {
        if (cancelled) return;
        try {
          await deliverReply(v2Client, {
            kind: "action",
            permissionId: entry.permissionId,
            sessionId: entry.sessionId,
            action: entry.action,
            response: entry.response,
            notificationId: "",
          });
        } catch (replyError) {
          if (!cancelled) {
            setError(toOpenCodeError(replyError).message);
          }
          // Left in the queue deliberately. The request is also in the visible queue,
          // so the user can answer it in the app; holding it costs nothing and a
          // later reconnect retries it.
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [v2Client, deferred, deliverReply]);

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
      deferredCount: deferred.length,
    }),
    [
      busy,
      clearError,
      deferred.length,
      dismiss,
      error,
      pending,
      pendingCount,
      respond,
    ],
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
