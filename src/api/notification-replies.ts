import type { PermissionResponse } from "@/api/permissions";

/**
 * Reading a notification response, and holding what cannot be acted on yet.
 *
 * ## The defect this exists to close
 *
 * `PermissionProvider` listened for notification taps and answered them with
 * `if (v2Client) { reply(...) } return;`. When `v2Client` was null the reply was
 * skipped **and** the early `return` skipped the in-app banner too. So tapping
 * "Allow" on a permission notification did nothing at all: nothing was sent, and
 * the request became invisible in the app as well. It came back only on a
 * reconnect, when rehydration re-listed it.
 *
 * That is the worst shape this bug can take. The OS dismissed the notification, so
 * the system said the interaction was handled; the app said nothing, because it had
 * no channel to say anything; and the agent stayed blocked on a prompt nobody could
 * see. With §4.9's queue it is worse than one — a killed app can have _N_
 * outstanding requests and not one of them produces a notification at all.
 *
 * ## Why a module
 *
 * Two independent reasons, and both have bitten this codebase before.
 *
 * First, the decision table below is the whole behaviour. It is four cases and the
 * order they are checked in matters, which is exactly the kind of thing that reads
 * correctly and is wrong. Kept pure it is exhaustively testable.
 *
 * Second, keeping it here means `PermissionProvider` holds no branching of its own,
 * so the tests that matter can assert on a value rather than on a rendered tree —
 * and so a future notification kind has one place to be added.
 *
 * ## The rule everything else follows from
 *
 * **A user tap is never dropped.** If the app cannot answer yet, the answer is held
 * and sent later, and the request is left visible either way. Silence is the one
 * outcome not available.
 */

/** The action buttons the permission category registers. */
export const PERMISSION_ACTIONS = ["allow", "reject", "always-allow"] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** What the action buttons mean, as the server's own vocabulary. */
export function actionToResponse(action: PermissionAction): PermissionResponse {
  switch (action) {
    case "allow":
      return "once";
    case "always-allow":
      return "always";
    case "reject":
      return "reject";
  }
}

/** The action identifier the OS reports when a notification is tapped with no button. */
export const DEFAULT_NOTIFICATION_ACTION =
  "expo.modules.notifications.actions.DEFAULT";

/** The subset of a notification response the app reads. */
export interface NotificationResponseLike {
  actionIdentifier: string;
  notification: {
    request: {
      /** The OS's own id for this notification, distinct from the permission's. */
      identifier: string;
      content: { title?: string | null; body?: string | null; data?: unknown };
    };
  };
}

/** Why a response was not acted on. Named so "ignored" is never a shrug. */
export type IgnoredReason =
  /** Not a permission notification at all — some other kind the app posts. */
  | "not-a-permission"
  /** Ours, but carrying no permission or session id, so there is nothing to answer. */
  | "missing-identifiers";

/** A response the app will act on. */
export type PermissionIntent =
  /** The user pressed Allow, Reject or Always Allow. */
  | {
      kind: "action";
      permissionId: string;
      sessionId: string;
      action: PermissionAction;
      response: PermissionResponse;
      /** The notification's own id, for deduplication against a cold-start re-read. */
      notificationId: string;
    }
  /** The notification body was tapped, with no button: show the in-app prompt. */
  | {
      kind: "open";
      permissionId: string;
      sessionId: string;
      title: string;
      body: string;
      notificationId: string;
    }
  /** Not actionable, with the reason. */
  | { kind: "ignored"; reason: IgnoredReason };

function isPermissionAction(value: string): value is PermissionAction {
  return (PERMISSION_ACTIONS as readonly string[]).includes(value);
}

/**
 * Decide what a notification response means.
 *
 * The order is load-bearing: `type` before identifiers, because a notification from
 * another feature with no ids is "not ours" rather than "malformed". Getting it
 * backwards would make every foreign notification a parse error.
 *
 * A missing id is **ignored**, not guessed at. There is no session to answer and no
 * request to key on, and inventing either would risk replying to the wrong thing —
 * far worse than not replying.
 */
export function classifyPermissionResponse(
  response: NotificationResponseLike,
): PermissionIntent {
  const data = response.notification.request.content.data as
    { type?: unknown; permissionId?: unknown; sessionId?: unknown } | undefined;

  if (!data || data.type !== "permission") {
    return { kind: "ignored", reason: "not-a-permission" };
  }

  const permissionId =
    typeof data.permissionId === "string" ? data.permissionId : "";
  const sessionId = typeof data.sessionId === "string" ? data.sessionId : "";
  if (!permissionId || !sessionId) {
    return { kind: "ignored", reason: "missing-identifiers" };
  }

  const notificationId = response.notification.request.identifier;
  const action = response.actionIdentifier;

  if (isPermissionAction(action)) {
    return {
      kind: "action",
      permissionId,
      sessionId,
      action,
      response: actionToResponse(action),
      notificationId,
    };
  }

  // Anything that is not one of our three buttons and not the OS's own "tapped the
  // body" identifier is still treated as an open. Being strict here would drop a
  // tap on an OS that spells its default identifier differently, and an open is the
  // harmless interpretation: it shows a prompt.
  return {
    kind: "open",
    permissionId,
    sessionId,
    title: response.notification.request.content.title ?? "Permission",
    body: response.notification.request.content.body?.toString() ?? "",
    notificationId,
  };
}

/**
 * Whether two responses describe the same notification.
 *
 * Keyed on the **OS's** notification id, not the permission's, and that choice is
 * the package's: `useLastNotificationResponse` in `expo-notifications@57` folds
 * through `determineNextResponse`, which compares
 * `prev.notification.request.identifier` and keeps `prev` when the two match — so the
 * first interaction with a notification wins and a re-delivery of the same one is
 * ignored.
 *
 * It matters here because a response can arrive twice by two different routes: read
 * from the cold-start slot *and* delivered to the listener. Handling both would send
 * two replies for one tap, the second of which the server rejects.
 */
export function isSameNotification(
  a: NotificationResponseLike,
  b: NotificationResponseLike,
): boolean {
  return (
    a.notification.request.identifier === b.notification.request.identifier
  );
}

/* -------------------------------------------------------------------------- */
/* Deferred replies                                                           */
/* -------------------------------------------------------------------------- */

/** A reply committed to by a tap, waiting for a client that can send it. */
export interface DeferredReply {
  permissionId: string;
  sessionId: string;
  response: PermissionResponse;
  /** Which button was pressed, for a message that says so. */
  action: PermissionAction;
}

/**
 * Hold a reply until a client exists.
 *
 * One entry per permission, **latest wins**, and a replacement keeps its original
 * position.
 *
 * Two taps on one request cannot happen from a single notification — the OS removes
 * it after the first — but a replayed `permission.asked` can post a second
 * notification for the same request, and sending both would have the server accept
 * one and reject the other. So a second tap replaces rather than appends.
 *
 * Position is preserved because a replacement is a *correction* to an existing entry,
 * not a new arrival, and `permission-queue` already treats a re-add the same way. It
 * also keeps the flush order equal to the order the user tapped in — and §4.9
 * established that order is load-bearing, since the agent is blocked on the head of
 * its own queue.
 */
export function deferReply(
  deferred: readonly DeferredReply[],
  reply: DeferredReply,
): DeferredReply[] {
  const at = deferred.findIndex(
    (entry) => entry.permissionId === reply.permissionId,
  );
  if (at === -1) {
    return [...deferred, reply];
  }
  return deferred.map((entry, index) => (index === at ? reply : entry));
}

/** The reply held for one permission, or `null`. */
export function pendingReply(
  deferred: readonly DeferredReply[],
  permissionId: string,
): DeferredReply | null {
  return deferred.find((entry) => entry.permissionId === permissionId) ?? null;
}

/** Drop one permission's held reply. Returns the same array if it was not held. */
export function removeDeferredReply(
  deferred: readonly DeferredReply[],
  permissionId: string,
): DeferredReply[] {
  if (!pendingReply(deferred, permissionId)) {
    return [...deferred];
  }
  return deferred.filter((entry) => entry.permissionId !== permissionId);
}

/** The permissions with a reply waiting, in the order they were tapped. */
export function deferredIds(deferred: readonly DeferredReply[]): string[] {
  return deferred.map((entry) => entry.permissionId);
}

/**
 * How many replies are waiting, as a phrase the banner can show.
 *
 * `null` rather than an empty string when nothing is held, so the caller renders
 * nothing and leaves no gap — the same convention as `queueDepthLabel`.
 */
export function deferredCountLabel(count: number): string | null {
  if (count === 0) {
    return null;
  }
  if (count === 1) {
    return "1 reply waiting for the connection";
  }
  return `${count} replies waiting for the connection`;
}
