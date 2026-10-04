/**
 * Test bootstrap: installed as `preload` in `bunfig.toml`.
 *
 * Replaces the modules that cannot load outside Metro, and sets the React flag
 * that makes `act(...)` work. Everything here is global to the suite — that is
 * deliberate, because `mock.module` has to run before any test file imports the
 * component under test, and a per-file registration would be one forgotten
 * import away from a silent no-op.
 *
 * Existing tests are unaffected: they cover pure modules and never import any of
 * these.
 */

import { afterEach, mock } from "bun:test";
import { createElement, type ComponentType, type ReactNode } from "react";

import { collectNamedImports } from "./source-imports";
import {
  currentConnection,
  currentPermission,
  currentProject,
  currentTheme,
  ptySessionStub,
} from "./context-holds";
import { webViewStubModule } from "./webview-stub";
import { clipboardStubModule } from "./clipboard-stub";

/** `forwardRef` components are objects; `createElement` needs the component type. */
type ReactElementType = ComponentType<Record<string, unknown>>;

/* -------------------------------------------------------------------------- */
/* act() violations are failures                                               */
/* -------------------------------------------------------------------------- */

/**
 * React updates state outside `act` and *warns*. The assertions still pass, because
 * the deferred update is the same update — but it was not processed the way the app
 * processes it, and effect ordering is the whole reason this harness exists. A log
 * line at the end of a run is not a guard; it is a note somebody has to remember to
 * read. So it fails the test that caused it.
 */
const actViolations: string[] = [];

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = String(args[0] ?? "");
  if (first.includes("not wrapped in act")) {
    actViolations.push(first);
  }
  originalConsoleError(...args);
};

/** How many act violations have been seen and not yet drained. */
export function actViolationsSeen(): number {
  return actViolations.length;
}

/**
 * Discard the recorded violations.
 *
 * Only for the self-check that proves the tripwire is armed — it has to provoke one
 * to know the provocation is noticed, and must not then fail its own test for it.
 */
export function drainActViolations(): number {
  return actViolations.splice(0, actViolations.length).length;
}

afterEach(() => {
  if (actViolations.length === 0) {
    return;
  }
  const seen = actViolations.splice(0, actViolations.length);
  throw new Error(
    `${seen.length} state update(s) ran outside act().\n` +
      "A component's setState was triggered from a test body rather than from " +
      "act(). The assertion would still pass — the update is the same one, just " +
      "processed differently — which is exactly why this has to be loud.\n" +
      `Reported: ${seen.join(" | ")}`,
  );
});

/* -------------------------------------------------------------------------- */
/* React's act() support                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Without this React logs "The current testing environment is not configured to
 * support act(...)" and runs effects outside the act scope, which makes effect
 * ordering unobservable — precisely what §11.1 is here to pin.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/* -------------------------------------------------------------------------- */
/* Module substitutions                                                        */
/* -------------------------------------------------------------------------- */

const { reactNativeStub } = await import("./react-native-stub");
mock.module("react-native", () => reactNativeStub);

/**
 * The app's own contexts.
 *
 * Registered here rather than per-render because `mock.module` only takes effect
 * before the module graph is linked. Calling it again later — as the first version
 * of the harness did, to inject a theme — makes Bun re-resolve `react-native`
 * against the real package, and loading the component then fails with
 * "Export named 'TurboModuleRegistry' not found". These read from mutable slots
 * that each test fills in instead.
 *
 * The real providers reach for AsyncStorage, secure storage and a live socket, and
 * neither context object is exported, so this is the only seam that does not drag
 * the app's whole startup into a unit test.
 */
mock.module("@/context/ThemeContext", () => ({
  useTheme: () => currentTheme(),
  ThemeProvider: ({ children }: { children: unknown }) => children,
}));

mock.module("@/context/ConnectionContext", () => ({
  useConnection: () => currentConnection(),
  ConnectionProvider: ({ children }: { children: unknown }) => children,
}));

/**
 * The permission queue.
 *
 * Mocked for the same reason as the two above, and more strongly: the real
 * `PermissionProvider` subscribes to the event bus, adopts pending requests on
 * mount, and listens for notification taps, so rendering it would mean standing up
 * the whole connection. `usePermission` is a read of four values and three
 * actions, so the values are injected and the actions recorded.
 */
mock.module("@/context/PermissionContext", () => ({
  usePermission: () => currentPermission(),
  PermissionProvider: ({ children }: { children: unknown }) => children,
}));

/**
 * `react-native-safe-area-context` measures insets through native modules and
 * fails to load without them. Only `SafeAreaView` matters here, and it renders a
 * plain host element.
 *
 * `createElement` rather than calling `View(...)`: the stub's components come from
 * `forwardRef`, which produces an object, not a function.
 */
mock.module("react-native-safe-area-context", () => ({
  SafeAreaView: (props: Record<string, unknown>) =>
    createElement(reactNativeStub.View as ReactElementType, {
      ...props,
      testID: props.testID ?? "safe-area",
    }),
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  initialWindowMetrics: { insets: { top: 0, right: 0, bottom: 0, left: 0 } },
}));

/**
 * `lucide-react-native` is built on `react-native-svg`, which reaches native
 * code. Icons carry no behaviour worth asserting, so each one becomes a host
 * element named after the icon — which also makes them findable in a query.
 *
 * The keys come from the app's own imports rather than a hand-written list:
 * Bun resolves *named* ESM imports statically, so a `Proxy` that answered any
 * property would still fail with "Export named 'X' not found". Scanning means a
 * newly-used icon is covered without editing this file.
 */
const iconNames = [...collectNamedImports("lucide-react-native")];

mock.module("lucide-react-native", () => {
  const icons: Record<string, unknown> = {};
  for (const name of iconNames) {
    const Component = (props: Record<string, unknown>) =>
      createElement(reactNativeStub.View as ReactElementType, {
        ...props,
        testID: props.testID ?? `icon:${name}`,
      });
    Component.displayName = name;
    icons[name] = Component;
  }
  return icons;
});

/**
 * `react-native-markdown-display`.
 *
 * It pulls in `react-native-fit-image`, which reads `Image.propTypes` off React
 * Native at *module load* — before a tree is rendered and before a test could
 * assert anything. Stubbing the parser is the same substitution as the WebView's.
 *
 * The source is rendered as text, which is all `MarkdownRenderer` needs: it passes
 * `style` and `rules` and hands the markdown through untouched. What *is* under
 * test stays under test — the rule wiring, the collapsible sections and the "Run"
 * button are the app's own code; the third-party markdown parser is not, and
 * `utils/terminal-input.test.ts` covers the runnable-language decision that feeds
 * the button.
 */
mock.module("react-native-markdown-display", () => ({
  __esModule: true,
  default: ({ children }: { children?: unknown }) =>
    createElement(
      reactNativeStub.Text as ReactElementType,
      null,
      children as ReactNode,
    ),
}));

/**
 * The pasteboard.
 *
 * `expo-clipboard` reaches native modules and cannot load outside a device build.
 * Only the two calls the app makes are needed, and a test has to be able to make
 * the write *fail* — "Copied" appearing for a write that did not happen is the bug
 * `utils/clipboard.ts` exists to prevent, so the stub has to be able to reproduce
 * it.
 */
mock.module("expo-clipboard", () => clipboardStubModule);

/**
 * The terminal's WebView.
 *
 * `TerminalPanel` owns the app's only WebSocket, so testing its wiring means
 * standing in for the view that holds it. Left real, the component renders
 * "React Native WebView does not support this platform" and every lifecycle
 * message the panel depends on goes nowhere.
 */
mock.module("react-native-webview", () => webViewStubModule);

/**
 * The PTY layer. `pty-lifecycle.test.ts` already covers the planning behind
 * `usePtySession`; here it only has to answer with a ready session.
 */
mock.module("@/api/use-pty-session", () => ({
  usePtySession: () => ptySessionStub(),
  requestPtyConnectTicket: async () => ({ ticket: "tkt_test", expiresIn: 60 }),
}));

/**
 * The resolved project.
 *
 * Mocked rather than stubbed at the HTTP layer because both the stats dashboard
 * and the terminal panel read it, and the panel treats it as a *fallback* for a
 * missing directory — so a test clearing it has to clear it deliberately.
 */
mock.module("@/api/hooks", () => ({
  useCurrentProject: () => currentProject(),
}));

/** The chosen shell; §2.4 made it a real preference. */
mock.module("@/context/PreferencesContext", () => ({
  usePreferences: () => ({ terminalShell: "bash" }),
}));
