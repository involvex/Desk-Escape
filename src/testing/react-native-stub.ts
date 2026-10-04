/**
 * A minimal stand-in for `react-native`, for rendering components under `bun:test`.
 *
 * ## Why this exists rather than the real thing
 *
 * `react-native@0.86` ships **Flow-typed source**, not compiled JavaScript, and
 * reaching it outside Metro needs the whole of React Native's Jest preset:
 * Flow stripping, Haste module resolution, platform-specific file selection
 * (`.ios.js` / `.android.js` / `.native.js`), `NativeModules` and
 * `TurboModuleRegistry` stubs, and the `__DEV__` / bridge globals. That setup
 * assumes Jest, which this project does not use.
 *
 * What is under test here is *this app's* logic — how a screen maps data to
 * states, how it wires up contexts, what its buttons call. None of that lives in
 * React Native. So the host components are shimmed and React itself does the real
 * work through `test-renderer`.
 *
 * ## What that means for how much these tests are worth
 *
 * They pin **our** behaviour, not React Native's rendering. A green
 * `StatsScreen` test means the screen renders the right text for a given query
 * result and calls the right thing on a tap — not that React Native would lay the
 * rows out identically. Anything layout- or gesture-specific is out of scope and
 * needs a real device or a Detox run.
 *
 * ## Keeping the shim honest
 *
 * The risk of a shim is silent divergence: the app starts importing `Switch`, the
 * shim does not have it, and a test quietly renders nothing. So this module
 * throws on any export it does not implement, and `rn-stub-coverage.test.ts`
 * re-scans the app's source on every run to assert the shim covers every
 * `react-native` import in `src/`. A new import fails the suite instead of
 * quietly testing nothing.
 */

import {
  Fragment,
  createElement,
  forwardRef,
  type ComponentProps,
  type ReactNode,
} from "react";

/* -------------------------------------------------------------------------- */
/* Alerts                                                                      */
/* -------------------------------------------------------------------------- */

/** Every `Alert.alert(...)` call, so tests can assert on confirmations. */
export interface AlertCall {
  title: string;
  message?: string;
  buttons?: unknown[];
}

const alertCalls: AlertCall[] = [];

/**
 * Mirrors `Alert.alert(title, message?, buttons?, options?)`.
 *
 * The third argument is a single array, not a rest parameter — keeping the same
 * shape means a test reads the buttons exactly as the app handed them over.
 */
function recordAlert(
  title: string,
  message?: string,
  buttons?: unknown[],
): void {
  alertCalls.push({ title, message, buttons });
}

/** The recorded alerts, newest last. */
export function takeAlertCalls(): AlertCall[] {
  return alertCalls.splice(0, alertCalls.length);
}

/* -------------------------------------------------------------------------- */
/* Host components                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A host component that renders as its own name.
 *
 * Keeping the RN name as the host type is what makes assertions readable:
 * `root.queryAll((i) => i.type === "Pressable")` means what it looks like.
 * `ref` is threaded through to the host instance, matching real RN closely enough
 * that a component reaching for one does not crash the test.
 */
function host<P extends object>(type: string) {
  const Component = forwardRef<unknown, P>((props, ref) =>
    createElement(type, { ...props, ref }),
  );
  Component.displayName = type;
  return Component;
}

export const View = host<Record<string, unknown>>("View");
export const Text = host<Record<string, unknown>>("Text");
export const ScrollView = host<Record<string, unknown>>("ScrollView");
export const ActivityIndicator =
  host<Record<string, unknown>>("ActivityIndicator");
export const RefreshControl = host<Record<string, unknown>>("RefreshControl");

/**
 * `Pressable` forwards its press handler.
 *
 * Real `Pressable` is a gesture responder that synthesises press-in/press-out
 * before calling `onPress`. The shim exposes `onPress` directly, so a test
 * presses by calling it. Anything asserting *gesture* behaviour — a long press, a
 * cancelled touch — is not covered by this.
 */
export const Pressable = host<Record<string, unknown>>("Pressable");

/**
 * `TouchableOpacity` forwards its press handler, like `Pressable`.
 *
 * The opacity animation is not reproduced — it would need a real animation clock,
 * and a fake one would make "did the press register" depend on timing.
 */
export const TouchableOpacity =
  host<Record<string, unknown>>("TouchableOpacity");

/** Minimal `FlatList`: renders every item so row content can be asserted. */
export interface FlatListProps<T> {
  data?: readonly T[] | null;
  renderItem: (info: {
    item: T;
    index: number;
    separators: unknown;
  }) => ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  ListEmptyComponent?: React.ComponentType | ReactNode;
  ListHeaderComponent?: React.ComponentType | ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerStyle?: unknown;
  [key: string]: unknown;
}

export function FlatList<T>({
  data,
  renderItem,
  keyExtractor,
  ListEmptyComponent,
  ListHeaderComponent,
  ...rest
}: FlatListProps<T>) {
  const items = data ?? [];

  const resolve = (value: React.ComponentType | ReactNode): ReactNode => {
    if (value === null || value === undefined) {
      return null;
    }
    // A component type has to be *rendered*; anything else is already a node.
    return typeof value === "function"
      ? createElement(value as React.ComponentType)
      : (value as ReactNode);
  };

  return createElement(
    "FlatList",
    rest,
    resolve(ListHeaderComponent),
    items.length === 0
      ? resolve(ListEmptyComponent as React.ComponentType | ReactNode)
      : items.map((item, index) =>
          createElement(
            Fragment,
            { key: keyExtractor?.(item, index) ?? String(index) },
            renderItem({ item, index, separators: {} }),
          ),
        ),
  );
}
FlatList.displayName = "FlatList";

/* -------------------------------------------------------------------------- */
/* StyleSheet                                                                  */
/* -------------------------------------------------------------------------- */

type Style = Record<string, unknown>;

/**
 * `StyleSheet.create` returns its input unchanged.
 *
 * Real RN returns opaque registered IDs and only resolves them in a renderer. The
 * shim keeps the object, which is *better* for assertions: a test can read
 * `props.style.backgroundColor` directly instead of going through `flatten`.
 */
export const StyleSheet = {
  create<T extends Record<string, Style>>(styles: T): T {
    return styles;
  },
  flatten(style: unknown): Style {
    if (Array.isArray(style)) {
      return style.reduce<Style>(
        (merged, entry) => ({ ...merged, ...StyleSheet.flatten(entry) }),
        {},
      );
    }
    return (style ?? {}) as Style;
  },
  compose(a: unknown, b: unknown): unknown {
    return [a, b];
  },
  absoluteFill: {},
  absoluteFillObject: {},
  hairlineWidth: 1,
};

/* -------------------------------------------------------------------------- */
/* Animated                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A handle for an animation that never runs.
 *
 * Every builder returns one of these, so `Animated.loop(...).start()` composes and
 * then does nothing.
 */
interface InertAnimation {
  start: (callback?: () => void) => void;
  stop: () => void;
  reset: () => void;
}

function inertAnimation(): InertAnimation {
  // `start` invokes nothing, including the completion callback. A component waiting
  // on `start`'s callback to flip a flag therefore stays waiting — which is the
  // honest outcome for an animation that did not happen, and is why no test may
  // depend on one completing.
  return { start: () => {}, stop: () => {}, reset: () => {} };
}

/** A number that can be animated. Assigning to it just assigns. */
class AnimatedValue {
  private current: number;

  constructor(initial: number) {
    this.current = initial;
  }

  setValue(next: number): void {
    this.current = next;
  }

  /** Always the value it was last given, because nothing has ever moved it. */
  __getValue(): number {
    return this.current;
  }

  interpolate(): AnimatedValue {
    return this;
  }

  addListener(): string {
    return "listener";
  }

  removeAllListeners(): void {}
}

/**
 * `Animated`, present only so a module graph links.
 *
 * `CollapsiblePartGroup` imports it and pulses a tool call while it streams. Nothing
 * about that pulse is under test, and nothing here advances: an animated component
 * renders its settled props and stops.
 *
 * **This is a fake, and it is a fake with a known lie.** `rn-stub-coverage.test.ts`
 * records it under `INERT` rather than `IMPLEMENTED`, because "the component loaded
 * and rendered" is all it can tell you — asserting on *motion* here would pass for
 * the wrong reason. Assert on state instead.
 */
export const Animated = {
  Value: AnimatedValue,
  View: host<Record<string, unknown>>("Animated.View"),
  timing: () => inertAnimation(),
  sequence: () => inertAnimation(),
  parallel: () => inertAnimation(),
  loop: () => inertAnimation(),
  delay: () => inertAnimation(),
};

/* -------------------------------------------------------------------------- */
/* Appearance                                                                  */
/* -------------------------------------------------------------------------- */

let colorScheme: "light" | "dark" = "dark";

/** Set what `useColorScheme` reports. */
export function setColorScheme(next: "light" | "dark"): void {
  colorScheme = next;
}

export function useColorScheme(): "light" | "dark" {
  return colorScheme;
}

const dimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };

/** Override the reported window size for layout-dependent assertions. */
export function setWindowDimensions(next: Partial<typeof dimensions>): void {
  Object.assign(dimensions, next);
}

export function useWindowDimensions(): typeof dimensions {
  return dimensions;
}

export const Platform = {
  OS: "ios" as const,
  Version: 17,
  isTV: false,
  select: <T>(spec: { ios?: T; android?: T; default?: T }): T | undefined =>
    spec.ios ?? spec.default,
};

/* -------------------------------------------------------------------------- */
/* Drift guard                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Names the app actually imports from `react-native`.
 *
 * `rn-stub-coverage.test.ts` asserts this set is fully implemented here. Exported
 * so that test does not have to re-parse the source itself.
 */
export const IMPLEMENTED = [
  "ActivityIndicator",
  "Alert",
  "FlatList",
  "Platform",
  "Pressable",
  "RefreshControl",
  "ScrollView",
  "StyleSheet",
  "Text",
  "TouchableOpacity",
  "View",
  "useColorScheme",
  "useWindowDimensions",
] as const;

/**
 * Exported so a module graph links, but not counted as covered.
 *
 * `Animated` is here rather than in `IMPLEMENTED` because what the stub provides is
 * not an implementation: it renders, and it does not move. Keeping the two lists
 * apart is what stops "the test imported and rendered the component" from being
 * mistaken for "the test covered the component". See `rn-stub-coverage.test.ts`.
 */
export const INERT = ["Animated"] as const;

/**
 * A module namespace that refuses anything unimplemented.
 *
 * Used as the `mock.module` target so a missing member fails loudly, with the
 * name, at the moment the component under test asks for it — instead of
 * rendering `undefined` and producing a test that passes for the wrong reason.
 */
export const reactNativeStub = new Proxy(
  {
    View,
    Text,
    ScrollView,
    ActivityIndicator,
    RefreshControl,
    Pressable,
    TouchableOpacity,
    FlatList,
    StyleSheet,
    Alert: { alert: recordAlert },
    Animated,
    useColorScheme,
    useWindowDimensions,
    Platform,
  } as Record<string, unknown>,
  {
    get(target, property: string | symbol) {
      if (property in target || typeof property === "symbol") {
        return target[property as string];
      }
      throw new Error(
        `react-native stub does not implement \`${String(property)}\`. ` +
          `Add it to src/testing/react-native-stub.ts and to IMPLEMENTED — ` +
          `a silently-missing host component makes component tests pass ` +
          `without testing anything.`,
      );
    },
  },
);

/** Type-only re-exports the app may import; nothing to implement at runtime. */
export type { ComponentProps };
