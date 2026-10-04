/**
 * A stand-in for `expo-notifications`.
 *
 * ## Why it is needed
 *
 * `expo-notifications` cannot be imported under `bun test` at all. It pulls
 * `expo-modules-core`, which imports `expo/src/async-require/setup.ts`, and that
 * file reads `__DEV__` — a global only Metro defines. The failure happens at module
 * load, before a single assertion runs, so it presents as
 * `ReferenceError: __DEV__ is not defined` with no application frames in it.
 *
 * That is why `PermissionContext` had no tests. Not because the provider is
 * intrinsically untestable — `useConnection` and `PreferencesContext` are already
 * substituted in the preload — but because one native import blocked the whole
 * module. Worth recording, because the comment in `setup.ts` blamed the connection
 * and would have sent the next person looking in the wrong place.
 *
 * ## What is real
 *
 * Listener registration and the *last response* are both real, and they behave the
 * way the native side does in the two cases that matter:
 *
 *   - `deliverResponse` invokes every registered listener, so a test can tap a
 *     notification action the way a user does.
 *   - `seedColdStart` fills the value a cold start would find. This is not a
 *     convenience: `useLastNotificationResponse` in the package's own source reads
 *     the last response *before* registering its listener, with the comment "in case
 *     it was set earlier (even in native code on startup)". A response can therefore
 *     arrive when nothing is listening, and the only way to recover it is to ask
 *     afterwards.
 *
 * ## What is fake
 *
 * Nothing arrives on its own. The app posts its own notifications, so a test drives
 * the incoming side by calling `deliverResponse` or `seedColdStart`. There is no
 * timer here and nothing is scheduled spontaneously.
 */

/** The identifier the OS reports when a notification is opened with no button. */
const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";

/** A notification as the app sees it, kept to the fields it actually reads. */
export interface StubNotificationContent {
  title?: string | null;
  body?: string | null;
  data?: Record<string, unknown>;
  categoryId?: string;
}

export interface StubNotificationResponse {
  actionIdentifier: string;
  notification: {
    request: {
      identifier: string;
      content: StubNotificationContent;
    };
  };
}

/** The fields a test names when it stands in for a user interaction. */
export interface ResponseParts {
  action: string;
  permissionId?: string;
  sessionId?: string;
  title?: string;
  body?: string;
  identifier?: string;
  /**
   * The notification's `type`, defaulting to `permission`.
   *
   * Overridable so a test can post a notification from *another* feature. Without it
   * every response is a permission one, and the app's "not ours" branch is untestable —
   * which matters, because the app posts build and step-progress notifications too and
   * acting on one would try to answer a request that does not exist.
   */
  type?: string;
}

/* -------------------------------------------------------------------------- */
/* Slots                                                                      */
/* -------------------------------------------------------------------------- */

type ResponseListener = (response: StubNotificationResponse) => void;

let listeners: ResponseListener[] = [];

/** Everything posted, oldest first. */
let scheduled: Record<string, unknown>[] = [];

/** Category identifiers registered, in order, with the actions they carried. */
let categories: { identifier: string; actionIds: string[] }[] = [];

/**
 * What `getPermissionsAsync` reports.
 *
 * `granted` by default so a test does not have to opt in to the ordinary path. A
 * test that is specifically about permissions sets it explicitly.
 */
let permissionStatus: "granted" | "denied" | "undetermined" = "granted";

/** How many times the app *asked* for permission, so ask-vs-read is distinguishable. */
let requestCount = 0;

/** The response a cold start would find, or `null`. */
let lastResponse: StubNotificationResponse | null = null;

/** The most recent response handed to a listener, or `null`. */
let lastDeliveredResponse: StubNotificationResponse | null = null;

/** Whether `setNotificationHandler` was called at module load. */
let handlerInstalled = false;

/**
 * Makes every notification call fail, as an unavailable or revoked module would.
 *
 * A slot rather than a status, because "denied" and "broken" are different
 * failures and only one of them should take a degraded path. `notifyPermissionRequest`
 * sits inside the SSE handler, so a throw there rejects a handler nobody is
 * awaiting — the failure would be invisible without somewhere to provoke it.
 */
let failure: Error | null = null;

/* -------------------------------------------------------------------------- */
/* The module                                                                 */
/* -------------------------------------------------------------------------- */

export const notificationsStubModule = {
  /**
   * Accept the handler and record that it arrived.
   *
   * What a notification does when it lands is decided by the platform, not by the
   * app, so there is nothing here to assert — the stub's job is to get out of the
   * way of a module-level call that would otherwise throw.
   */
  setNotificationHandler(handler: unknown): void {
    void handler;
    handlerInstalled = true;
  },

  async setNotificationCategoryAsync(
    identifier: string,
    actions: { identifier: string }[],
  ): Promise<void> {
    if (failure) throw failure;
    categories.push({
      identifier,
      actionIds: actions.map((a) => a.identifier),
    });
  },

  async getPermissionsAsync(): Promise<{ status: string }> {
    if (failure) throw failure;
    return { status: permissionStatus };
  },

  async requestPermissionsAsync(): Promise<{ status: string }> {
    if (failure) throw failure;
    requestCount += 1;
    // Only an *undetermined* permission is granted by asking. A refusal stays a
    // refusal, because that is what both platforms do: once the user has said no,
    // asking again returns `denied` rather than re-prompting.
    //
    // This distinction is the whole reason the slot holds three states rather than one.
    // A stub that always granted would make "the user refused notifications"
    // unreachable, and `ensureNotificationPermissions` would read as covering a branch
    // it does not.
    if (permissionStatus === "undetermined") {
      permissionStatus = "granted";
    }
    return { status: permissionStatus };
  },

  async scheduleNotificationAsync(
    request: Record<string, unknown>,
  ): Promise<string> {
    if (failure) throw failure;
    const id = `stub-notification-${scheduled.length + 1}`;
    scheduled.push({ id, ...request });
    return id;
  },

  addNotificationResponseReceivedListener(listener: ResponseListener): {
    remove: () => void;
  } {
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter((entry) => entry !== listener);
      },
    };
  },

  /**
   * The current spelling. The package's `_Async` variant is marked deprecated and
   * only calls this, so it is deliberately absent: a test reaching for it would be
   * testing a shim.
   */
  getLastNotificationResponse(): StubNotificationResponse | null {
    return lastResponse;
  },

  clearLastNotificationResponse(): void {
    lastResponse = null;
  },

  DEFAULT_ACTION_IDENTIFIER: DEFAULT_ACTION,
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
};

/* -------------------------------------------------------------------------- */
/* Test controls                                                              */
/* -------------------------------------------------------------------------- */

/** Assemble the response the OS would deliver, without delivering it. */
function buildResponse(parts: ResponseParts): StubNotificationResponse {
  const data: Record<string, unknown> = {};
  if (parts.permissionId !== undefined) data.permissionId = parts.permissionId;
  if (parts.sessionId !== undefined) data.sessionId = parts.sessionId;

  return {
    actionIdentifier: parts.action,
    notification: {
      request: {
        identifier: parts.identifier ?? `stub-${parts.permissionId ?? "none"}`,
        content: {
          title: parts.title ?? "Permission",
          body: parts.body ?? null,
          data: { type: parts.type ?? "permission", ...data },
        },
      },
    },
  };
}

/**
 * Tap a notification, the way a user does.
 *
 * Built from parts rather than accepting a whole object, so a test cannot pass
 * something the OS would never send — a missing `permissionId`, say, which is one
 * of the cases the app has to ignore rather than act on.
 *
 * Returns what it delivered, so the same builder serves both entry points.
 */
export function deliverResponse(
  parts: ResponseParts,
): StubNotificationResponse {
  const response = buildResponse(parts);
  lastDeliveredResponse = response;
  // Copied first: a listener may remove itself, and mutating the array mid-iteration
  // would skip the next listener. The native emitter behaves the same way.
  for (const listener of [...listeners]) {
    listener(response);
  }
  return response;
}

/**
 * Seed the response a **cold start** would find, as if the user had tapped before
 * JavaScript existed.
 */
export function seedColdStart(parts: ResponseParts): void {
  lastResponse = buildResponse(parts);
}

/** How many response listeners are registered right now. */
export function responseListenerCount(): number {
  return listeners.length;
}

/** The most recent response handed to a listener, or `null`. */
export function lastDelivered(): StubNotificationResponse | null {
  return lastDeliveredResponse;
}

/** The identifier the OS reports for a plain open, with no action button. */
export const DEFAULT_NOTIFICATION_ACTION = DEFAULT_ACTION;

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export function scheduledNotifications(): readonly Record<string, unknown>[] {
  return scheduled;
}

export function registeredCategories(): readonly {
  identifier: string;
  actionIds: string[];
}[] {
  return categories;
}

export function notificationPermissionStatus(): string {
  return permissionStatus;
}

export function notificationRequestCount(): number {
  return requestCount;
}

export function isHandlerInstalled(): boolean {
  return handlerInstalled;
}

/** The response a cold start would find, for a test asserting the app read it. */
export function pendingColdStartResponse(): StubNotificationResponse | null {
  return lastResponse;
}

/**
 * Set what the next `getPermissionsAsync` reports.
 *
 * Distinct from a reset, which puts it back to granted: a test that forgets to set
 * it would otherwise take the ordinary path and pass without exercising anything.
 */
export function setNotificationPermissionStatus(
  status: "granted" | "denied" | "undetermined",
): void {
  permissionStatus = status;
}

/** Make the next notification call throw. */
export function setNotificationFailure(error: Error | null): void {
  failure = error;
}

/** Put everything back, including the status, the failure and the handler flag. */
export function resetNotifications(): void {
  scheduled = [];
  categories = [];
  requestCount = 0;
  lastResponse = null;
  lastDeliveredResponse = null;
  handlerInstalled = false;
  permissionStatus = "granted";
  failure = null;
  listeners = [];
}
