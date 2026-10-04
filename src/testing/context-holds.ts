import type { PendingPermission, PermissionResponse } from "@/api/permissions";
import type { ThemeName } from "@/types/opencode";
import { themeDefinitions } from "@/theme/palettes";
import { resetClipboard } from "@/testing/clipboard-stub";
import { eventBusStub, resetEventBus } from "@/testing/event-bus-stub";
import { resetNotifications } from "@/testing/notifications-stub";
import { resetAppState } from "@/testing/react-native-stub";

/**
 * Mutable slots the preloaded context mocks read from.
 *
 * `mock.module` has to run once, in the preload, *before* anything is linked —
 * registering a module after the graph is linked makes Bun re-resolve the specifier
 * against the real package, which is how `react-native/index.js` reappears and
 * fails on `TurboModuleRegistry`.
 *
 * So the shapes are registered up front and each test fills in the values.
 */

export interface TestConnection {
  client: unknown;
  status: string;
  sessionId: string | null;
  activeDirectory: string | null;
  project: unknown;
  session: unknown;
  /**
   * The SSE bus.
   *
   * Present by default, and that is a change: it used to be absent, so
   * `PermissionProvider`'s subscription returned early and every event-driven path
   * in it — enqueue on ask, close on reply, post the notification — was untested
   * without anyone noticing, because the effect looked exercised.
   */
  eventBus?: unknown;
  [key: string]: unknown;
}

/** The theme used when a test does not name one. */
const DEFAULT_THEME: ThemeName = "dev-dark";

let themeName: ThemeName = DEFAULT_THEME;

/**
 * Calls recorded against the fake OpenCode client.
 *
 * `TerminalPanel` reports terminal size through `client.pty.update`, and that is
 * the only thing the app sends over HTTP for a running shell — so a test that can
 * see these calls can check the terminal actually told the server its size.
 *
 * The query-driven screens go further and need answers, so each endpoint has a
 * handler a test installs. Default handlers answer with the smallest thing the
 * screen can render, which keeps a test that only cares about wiring from having
 * to invent a payload.
 */
export interface ApiStub {
  ptyUpdate: unknown[];
  sessionStats: {
    calls: unknown[];
    handler: (body: unknown) => Promise<unknown>;
  };
  savedPermissions: {
    calls: unknown[];
    handler: (body: unknown) => Promise<unknown>;
  };
  removePermission: {
    calls: unknown[];
    handler: (body: unknown) => Promise<unknown>;
  };
  /**
   * `vcs.diff`, `vcs.status` and `file.list`.
   *
   * Three endpoints rather than one because the diff panel needs all three to
   * reconstruct untracked files, and a stub that collapsed them would hide the
   * question the panel exists to answer: `vcs.diff` cannot report a file git has
   * never seen, so the panel has to subtract the status set from the listing to
   * find one. Each has its own handler so a test can make one of them fail and
   * assert the panel degrades rather than lying.
   */
  vcsDiff: {
    calls: unknown[];
    handler: (body: unknown) => Promise<unknown>;
  };
  vcsStatus: {
    calls: unknown[];
    handler: (body: unknown) => Promise<unknown>;
  };
  fileList: {
    calls: unknown[];
    handler: (body: unknown) => Promise<unknown>;
  };
  sessionDiff: {
    calls: unknown[];
    handler: (body: unknown) => Promise<unknown>;
  };
  /**
   * `permission.reply` and `permission.request.list`.
   *
   * Both are here because the permission provider's whole job is these two calls:
   * adopt what the server already considers pending, and answer one. Without them
   * the client was not a client the provider could talk to, so every effect in it
   * bailed and the module had no coverage.
   *
   * `reply` is a slot with a handler rather than a plain recorder, because a reply
   * that *fails* is the interesting case — the provider clears the request on
   * success and keeps it on failure, and that difference is the whole point of the
   * `busy`/`error` pair the banner renders.
   */
  permissionReply: {
    calls: unknown[];
    handler: (body: unknown) => Promise<unknown>;
  };
  pendingPermissions: {
    calls: unknown[];
    handler: (body: unknown) => Promise<unknown>;
  };
}

function emptyApi(): ApiStub {
  return {
    ptyUpdate: [],
    sessionStats: { calls: [], handler: async () => null },
    savedPermissions: { calls: [], handler: async () => [] },
    removePermission: { calls: [], handler: async () => undefined },
    vcsDiff: { calls: [], handler: async () => ({ data: [] }) },
    vcsStatus: { calls: [], handler: async () => ({ data: [] }) },
    fileList: { calls: [], handler: async () => ({ data: [] }) },
    sessionDiff: { calls: [], handler: async () => [] },
    permissionReply: { calls: [], handler: async () => undefined },
    pendingPermissions: { calls: [], handler: async () => ({ data: [] }) },
  };
}

let api: ApiStub = emptyApi();

/** The recorded calls and the current handlers, for assertions and overrides. */
export function apiStub(): ApiStub {
  return api;
}

/**
 * A fresh fake client, independent of whatever the slot currently holds.
 *
 * For a test that has swapped the client out and needs a working one back. Reading
 * `currentConnection().client` instead would return the `null` the test just set —
 * which is the whole reason this exists, and a mistake that produces a test which
 * appears to re-connect and does not.
 *
 * A fresh instance is safe even though the calls are shared: the namespaces close over
 * the module-level `api`, so every client records into the same log.
 */
export function defaultClient(): unknown {
  return fakeClient();
}

/** Answer `session.stats` with whatever `handler` returns. */
export function setSessionStats(
  handler: (body: unknown) => Promise<unknown>,
): void {
  api.sessionStats.handler = handler;
}

/** Answer `permission.saved.list` with whatever `handler` returns. */
export function setSavedPermissions(
  handler: (body: unknown) => Promise<unknown>,
): void {
  api.savedPermissions.handler = handler;
}

/** Answer `permission.saved.remove` with whatever `handler` returns. */
export function setRemovePermission(
  handler: (body: unknown) => Promise<unknown>,
): void {
  api.removePermission.handler = handler;
}

/**
 * Answer `vcs.diff`, `vcs.status`, `file.list` and `session.diff`.
 *
 * One setter for all four because a diff test almost always needs all four
 * consistent with each other: a listing that disagrees with the status set makes
 * every file look untracked, which is a fixture bug that reads as a product bug.
 */
export function setDiffSources(parts: {
  vcsDiff?: (body: unknown) => Promise<unknown>;
  vcsStatus?: (body: unknown) => Promise<unknown>;
  fileList?: (body: unknown) => Promise<unknown>;
  sessionDiff?: (body: unknown) => Promise<unknown>;
}): void {
  if (parts.vcsDiff) api.vcsDiff.handler = parts.vcsDiff;
  if (parts.vcsStatus) api.vcsStatus.handler = parts.vcsStatus;
  if (parts.fileList) api.fileList.handler = parts.fileList;
  if (parts.sessionDiff) api.sessionDiff.handler = parts.sessionDiff;
}

/**
 * Answer `permission.request.list` with whatever `handler` returns.
 *
 * The default is `{ data: [] }`, which reads as "nothing outstanding" — so a test
 * that does not care about rehydration takes the quiet path. Set it to a non-empty
 * list to test adoption.
 */
export function setPendingPermissions(
  handler: (body: unknown) => Promise<unknown>,
): void {
  api.pendingPermissions.handler = handler;
}

/**
 * Answer `permission.reply`.
 *
 * Pass a handler that throws to reproduce a rejected approval, which is the case
 * where the provider must keep the request in the queue rather than dropping it.
 */
export function setPermissionReply(
  handler: (body: unknown) => Promise<unknown>,
): void {
  api.permissionReply.handler = handler;
}

/**
 * Clear the recorded calls, keeping the handlers.
 *
 * Called by `mount`, so a test always starts with a clean call log while keeping
 * the fixtures its `beforeEach` installed. Resetting the handlers here instead
 * would wipe them *after* `beforeEach` ran — the test would query a default
 * handler and every data assertion would fail for a reason unrelated to the screen.
 *
 * Handler state is reset by {@link resetApiHandlers} for the rare test that needs
 * a bare stub.
 */
export function resetClientCalls(): void {
  api.ptyUpdate = [];
  api.sessionStats.calls = [];
  api.savedPermissions.calls = [];
  api.removePermission.calls = [];
  api.vcsDiff.calls = [];
  api.vcsStatus.calls = [];
  api.fileList.calls = [];
  api.sessionDiff.calls = [];
  api.permissionReply.calls = [];
  api.pendingPermissions.calls = [];
  permissionCalls.respond = [];
  permissionCalls.dismiss = 0;
  permissionCalls.clearError = 0;
}

/** Drop every handler as well as the calls, back to the built-in defaults. */
export function resetApiHandlers(): void {
  api = emptyApi();
}

/**
 * A client with just the endpoints the tested screens call.
 *
 * `pty` is the one that matters for the terminal: §5.1 found that `pty` has no
 * `write`, so every shell write goes through the WebView's socket and the only
 * HTTP call is a resize.
 */
function fakeClient() {
  return {
    pty: {
      update: (body: unknown) => {
        api.ptyUpdate.push(body);
        return Promise.resolve(undefined);
      },
    },
    session: {
      stats: (body: unknown) => {
        api.sessionStats.calls.push(body);
        return api.sessionStats.handler(body);
      },
      diff: (body: unknown) => {
        api.sessionDiff.calls.push(body);
        return api.sessionDiff.handler(body);
      },
    },
    vcs: {
      diff: (body: unknown) => {
        api.vcsDiff.calls.push(body);
        return api.vcsDiff.handler(body);
      },
      status: (body: unknown) => {
        api.vcsStatus.calls.push(body);
        return api.vcsStatus.handler(body);
      },
    },
    file: {
      list: (body: unknown) => {
        api.fileList.calls.push(body);
        return api.fileList.handler(body);
      },
    },
    permission: {
      reply: (body: unknown) => {
        api.permissionReply.calls.push(body);
        return api.permissionReply.handler(body);
      },
      request: {
        list: (body: unknown) => {
          api.pendingPermissions.calls.push(body);
          return api.pendingPermissions.handler(body);
        },
      },
      saved: {
        list: (body: unknown) => {
          api.savedPermissions.calls.push(body);
          return api.savedPermissions.handler(body);
        },
        remove: (body: unknown) => {
          api.removePermission.calls.push(body);
          return api.removePermission.handler(body);
        },
      },
    },
  };
}

/** The current project `useCurrentProject` reports. */
let currentProjectValue: unknown = { id: "prj_test", worktree: "/repo" };

/**
 * Set, or clear, the resolved project.
 *
 * `StatsScreen` refuses to render an unscoped total until this has an id, so a test
 * of its resolving path needs `setCurrentProject(null)`.
 */
export function setCurrentProject(value: unknown): void {
  currentProjectValue = value;
}

/** The value `useCurrentProject()` returns. */
export function currentProject(): { data: unknown; isLoading: boolean } {
  return { data: currentProjectValue, isLoading: false };
}

/** A connection as the app would see one: a client, and the config it points at. */
function connectedDefaults(): TestConnection {
  return {
    client: fakeClient(),
    config: { baseUrl: "http://127.0.0.1:4096" },
    status: "connected",
    sessionId: "ses_test",
    activeDirectory: "/repo",
    project: { id: "prj_test", worktree: "/repo" },
    session: { id: "ses_test", title: "Test session" },
    eventBus: eventBusStub,
  };
}

let connection: TestConnection = connectedDefaults();

/** Point both context hooks at the given theme and connection. */
export function setTestContext(next: {
  theme?: ThemeName;
  connection?: Partial<TestConnection>;
  project?: unknown;
  permission?: Partial<PermissionState>;
}): void {
  if (next.theme) {
    themeName = next.theme;
  }
  connection = { ...connection, ...next.connection };
  // Presence, not truthiness: `project: null` is meaningful here — it is how a test
  // says "the project has not resolved", which is the state several screens wait
  // in before they will show anything.
  if ("project" in next) {
    currentProjectValue = next.project;
  }
  // Merged over the defaults, never over the previous test's state: `mount` calls
  // `resetTestContext` first, so a partial override here means "this field", not
  // "whatever the last test left behind".
  if (next.permission) {
    permissionState = { ...permissionState, ...next.permission };
  }
}

/** Restore the defaults between tests so nothing leaks across them. */
export function resetTestContext(): void {
  themeName = DEFAULT_THEME;
  connection = connectedDefaults();
  currentProjectValue = { id: "prj_test", worktree: "/repo" };
  permissionState = defaultPermissionState();
  resetClientCalls();
  resetClipboard();
  // The three stubs the permission provider reaches into directly. Without these in
  // the reset, a posted notification or a driven app-state change survives into the
  // next test and the failure looks like the next test's fault.
  resetNotifications();
  resetAppState();
  resetEventBus();
}

/**
 * The value `useTheme()` returns.
 *
 * Built from a real palette so a component test cannot pass against a colour the
 * app cannot produce. Colours are not judged here — `color-contrast.test.ts` does
 * that.
 */
export function currentTheme() {
  const palette = themeDefinitions[themeName];
  return {
    themeName,
    theme: palette,
    colors: palette.colors,
    spacing: palette.spacing,
    typography: palette.typography,
    fontScale: 1,
    fontType: "system" as const,
    syncTheme: false,
    setThemeName: () => {},
    setFontScale: () => {},
    setFontType: () => {},
    setSyncTheme: async () => {},
  };
}

/** The value `useConnection()` returns. */
export function currentConnection(): TestConnection {
  return connection;
}

/* -------------------------------------------------------------------------- */
/* Permissions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What `usePermission()` reports, minus the callbacks.
 *
 * `PermissionBanner` is the only consumer, and it makes every decision from these
 * four values plus the actions it takes — so they are the whole surface a test
 * needs to drive.
 */
export interface PermissionState {
  /** The request being shown, or `null` when the queue is empty. */
  pending: PendingPermission | null;
  /** Outstanding requests behind `pending`, including it. */
  pendingCount: number;
  /** `true` while a reply is in flight. */
  busy: boolean;
  /** Last failure message, or `null`. */
  error: string | null;
  /**
   * Replies the user gave by tapping a notification while the app had no client.
   *
   * Present in the default rather than left out because the banner derives a string
   * from it, and `deferredCountLabel(undefined)` is *not* `null` — it renders
   * "undefined replies waiting for the connection". A state that silently disagrees
   * with the real context shape turns a missing field into a visible lie, and no test
   * fails, because nothing was wrong with the component.
   */
  deferredCount: number;
}

/** Calls the component made into `usePermission`, so a test can assert on them. */
export interface PermissionCalls {
  respond: PermissionResponse[];
  dismiss: number;
  clearError: number;
}

function defaultPermissionState(): PermissionState {
  return {
    pending: null,
    pendingCount: 0,
    busy: false,
    error: null,
    deferredCount: 0,
  };
}

let permissionState: PermissionState = defaultPermissionState();
let permissionCalls: PermissionCalls = {
  respond: [],
  dismiss: 0,
  clearError: 0,
};

/**
 * The value `usePermission()` returns.
 *
 * The callbacks record rather than act. The real `respond` posts to the server and
 * then *removes the request from the queue* — a test cannot reproduce that without
 * re-running the provider's state machine, and re-running it would test the
 * provider rather than the banner. The provider's queue algebra is already covered
 * by `api/__tests__/permission-queue.test.ts`; what needs pinning here is that
 * each button asks for the right thing.
 */
export function currentPermission(): PermissionState & {
  respond: (response: PermissionResponse) => Promise<void>;
  dismiss: () => void;
  clearError: () => void;
} {
  return {
    ...permissionState,
    respond: async (response) => {
      permissionCalls.respond.push(response);
    },
    dismiss: () => {
      permissionCalls.dismiss += 1;
    },
    clearError: () => {
      permissionCalls.clearError += 1;
    },
  };
}

/** What the banner did, since the last reset. */
export function permissionCallLog(): Readonly<PermissionCalls> {
  return permissionCalls;
}

/* -------------------------------------------------------------------------- */
/* PTY session                                                                 */
/* -------------------------------------------------------------------------- */

/** Overrides for `usePtySession`, so a test can force a failure state. */
export interface PtySessionStub {
  ptyId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  retryCount: number;
}

let ptySession: PtySessionStub = {
  ptyId: "pty_test",
  status: "ready",
  error: null,
  retryCount: 0,
};

/** Set what the next `usePtySession` call reports. */
export function setPtySession(next: Partial<PtySessionStub>): void {
  ptySession = { ...ptySession, ...next };
}

/** Restore a ready session, for tests that do not care. */
export function resetPtySession(): void {
  ptySession = {
    ptyId: "pty_test",
    status: "ready",
    error: null,
    retryCount: 0,
  };
}

/** The full `usePtySession` return shape, plus counters a test can assert on. */
export function ptySessionStub() {
  return {
    ptyId: ptySession.ptyId,
    status: ptySession.status,
    error: ptySession.error,
    retry: () => {
      ptySession.retryCount += 1;
    },
    reset: () => {},
    dispose: () => {},
    get retryCount() {
      return ptySession.retryCount;
    },
  };
}
