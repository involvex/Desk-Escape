/**
 * A `react-native-reanimated` stand-in, kept separate from the React Native stub
 * because it is a different module with a different relationship to the truth.
 *
 * ## Why this exists
 *
 * Five components import `react-native-reanimated` — `ChatScrollBar`,
 * `FileDrawer`, `Snackbar`, `WorkspaceScreen` and `UnifiedDiff`. Until now none
 * of them could be render-tested at all: the real package reaches native code at
 * *module load* through `TurboModuleRegistry`, so importing it under Bun failed
 * with "Export named 'TurboModuleRegistry' not found" before a single assertion
 * ran. That is why reanimated-importing components had no render coverage at all.
 *
 * ## What is real and what is not
 *
 * The *values* are real in the way that matters: `useSharedValue` returns a
 * mutable box, `useAnimatedStyle` actually evaluates the worklet, and
 * `withTiming`/`withSpring` jump straight to their destination. So a component's
 * first rendered frame is its **settled** state, which is the state a test can
 * make an assertion about. A panel closed with `translateX = screenWidth` is
 * off-screen on the first frame, exactly as it would be before the slide-in
 * animation begins.
 *
 * What is fake is time. There is no frame loop, so a transition takes no frames:
 * `withTiming(to)` returns `to`, not an intermediate value. A test therefore
 * never observes an animation mid-flight, which is the correct trade — asserting
 * on motion would require a fake clock that could only be wrong.
 */

/** A mutable box standing in for a Reanimated shared value. */
export interface SharedValueStub<T> {
  value: T;
  get(): T;
  set(next: T): void;
}

/**
 * Whether `useAnimatedStyle` / `useDerivedValue` is currently evaluating its
 * worklet factory.
 *
 * In a real runtime Reanimated runs those factories on the UI thread, *outside*
 * React's render pass, so reading `.value` there is legal. The stub runs them
 * synchronously inside React's render to keep the same call site, so we set
 * this flag around the factory call to mark "this read is inside a worklet."
 */
let inWorklet = false;

/**
 * Render-time reads of a shared value's `.value`.
 *
 * Real Reanimated emits a strict-mode warning ("Reading from `value` during
 * component render…") whenever `.value` is read in the component body rather
 * than inside a worklet, and that warning is what precedes the render loop that
 * saturates the JS thread. The stub can't reproduce the warning (it has no
 * strict-mode enforcement and no frame loop), so instead it *counts* such reads —
 * letting a test assert `renderTimeSharedValueReads() === 0` after rendering,
 * which fails on the old code that read `opacity.value` in the body.
 */
let renderTimeReads = 0;

/**
 * Reset the render-time-read counter. Every asserting test must call this first.
 */
export function resetRenderTimeReads(): void {
  renderTimeReads = 0;
}

/** How many `.value` reads have happened outside a worklet since the last reset. */
export function renderTimeSharedValueReads(): number {
  return renderTimeReads;
}

/**
 * `runOnJS` hand-offs observed across this process.
 *
 * In a real runtime a `withTiming` completion callback executes on the UI
 * worklet thread, so reaching for a React state setter from it directly is what
 * throws "[Worklets] Tried to synchronously call a Remote Function …
 * dispatchSetState on the UI Runtime". The fix is to route the setter through
 * `runOnJS`, and the stub records each hand-off so a test can assert the wrapper
 * is actually used — otherwise this is a production-only crash that no render
 * test could otherwise catch (the stub runs callbacks on the JS thread, where the
 * synchronous call would succeed).
 */
let runOnJSCalls = 0;

/** Reset the `runOnJS` hand-off counter. */
export function resetRunOnJSCalls(): void {
  runOnJSCalls = 0;
}

/** How many `runOnJS(...)` hand-offs have happened since the last reset. */
export function runOnJSCallsMade(): number {
  return runOnJSCalls;
}

/** `useSharedValue`: a plain mutable box, plus the accessors Reanimated provides. */
export function useSharedValue<T>(initial: T): SharedValueStub<T> {
  return sharedValueBox(initial);
}

/**
 * The box both `useSharedValue` and `makeMutable` build.
 *
 * Split out so `makeMutable` is not a hook calling a hook: it is not, and the
 * linter's rules-of-hooks check is right to say so. The behaviour is identical.
 *
 * `value` is a getter/setter rather than a plain property so a read taken
 * outside a worklet (i.e. during a React render) is observable — see
 * `renderTimeReads` above. Writes are unaffected.
 */
function sharedValueBox<T>(initial: T): SharedValueStub<T> {
  let current = initial;
  const box: SharedValueStub<T> = {
    get value(): T {
      if (!inWorklet) {
        renderTimeReads += 1;
      }
      return current;
    },
    set value(next: T) {
      current = next;
    },
    get: () => box.value,
    set: (next: T) => {
      box.value = next;
    },
  };
  return box;
}

/**
 * `useAnimatedStyle`: evaluates the worklet and returns its plain object.
 *
 * The worklet closes over shared values, so it re-runs whenever it is called.
 * Components call it during render, which means the style reflects the current
 * `.value` at render time — and because `withTiming` resolves immediately, that
 * is the destination rather than the start.
 *
 * The factory is flagged as running inside a worklet so its `.value` reads are
 * not recorded by `renderTimeReads` — mirroring real Reanimated, where the
 * factory executes on the UI thread outside React's render pass.
 */
export function useAnimatedStyle<T>(factory: () => T): T {
  inWorklet = true;
  try {
    return factory();
  } finally {
    inWorklet = false;
  }
}

/**
 * `withTiming` / `withSpring` / `withDecay`: jump to the destination.
 *
 * `config` is accepted and ignored. The third argument is a callback Reanimated
 * invokes on completion; it is called immediately, because the transition is
 * already over by the time this returns.
 */
export function withTiming<T>(
  toValue: T,
  _config?: unknown,
  callback?: () => void,
): T {
  callback?.();
  return toValue;
}

export function withSpring<T>(
  toValue: T,
  _config?: unknown,
  callback?: () => void,
): T {
  callback?.();
  return toValue;
}

export function withDecay(_config: unknown, callback?: () => void): number {
  callback?.();
  return 0;
}

export function withSequence<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

/**
 * `runOnJS`: hands a JS function to the UI thread by returning it unchanged here.
 *
 * The stub is single-threaded, so it returns the function directly — but it also
 * counts the hand-off so a test can assert a component did not call a React state
 * setter straight out of a `withTiming` completion callback (a call that runs on
 * the real UI thread and is what crashes with dispatchSetState-as-remote-fn).
 */
export function runOnJS<T extends (...args: never[]) => unknown>(fn: T): T {
  runOnJSCalls += 1;
  return fn;
}

/** A handle for a builder that never runs, matching the RN stub's `Animated`. */
interface InertAnimation {
  start: (callback?: () => void) => void;
  stop: () => void;
  reset: () => void;
}

function inertAnimation(): InertAnimation {
  // `start` invokes nothing, completion callback included, so a component waiting
  // on one stays waiting — the honest outcome for an animation that never ran.
  return { start: () => {}, stop: () => {}, reset: () => {} };
}

/** A value that can be animated. Assigning to it just assigns. */
class AnimatedValueStub {
  private current: number;

  constructor(initial: number) {
    this.current = initial;
  }

  setValue(next: number): void {
    this.current = next;
  }

  /** Always whatever it was last given, because nothing has ever moved it. */
  __getValue(): number {
    return this.current;
  }

  interpolate(): AnimatedValueStub {
    return this;
  }

  addListener(): string {
    return "listener";
  }

  removeAllListeners(): void {}
}

/**
 * The default export: present so a module graph links, inert so a render settles.
 *
 * The builders accept and ignore their arguments, but they are *typed* to accept
 * them. Typing them as zero-argument functions would make `Animated.timing(1, {})`
 * a compile error in every component that calls it, so the stub would push each
 * caller towards a cast — and a cast defeats the point of a stub.
 */
export const Animated = {
  View: "Animated.View",
  Text: "Animated.Text",
  ScrollView: "Animated.ScrollView",
  Value: class extends AnimatedValueStub {},
  timing: (_toValue?: unknown, _config?: unknown) => inertAnimation(),
  spring: (_toValue?: unknown, _config?: unknown) => inertAnimation(),
  decay: (_config?: unknown) => inertAnimation(),
  sequence: (..._animations: unknown[]) => inertAnimation(),
  parallel: (..._animations: unknown[]) => inertAnimation(),
  delay: (_delay?: number) => inertAnimation(),
  loop: (_animation?: unknown) => inertAnimation(),
  createAnimatedComponent: <T>(component: T): T => component,
};

/** Everything this module provides, as the preload's `mock.module` wants it. */
export const reanimatedStub = {
  default: Animated,
  Animated,
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue: <T>(factory: () => T): { value: T } => {
    inWorklet = true;
    try {
      return { value: factory() };
    } finally {
      inWorklet = false;
    }
  },
  withTiming,
  withSpring,
  withDecay,
  withSequence,
  runOnJS,
  createAnimatedComponent: Animated.createAnimatedComponent,
  Easing: {
    linear: (t: number) => t,
    ease: (t: number) => t,
    inOut: (fn: (t: number) => number) => fn,
    out: (fn: (t: number) => number) => fn,
  },
  ReduceMotion: { System: "system", Always: "always", Never: "never" },
  Extrapolation: { Extend: "extend", Clamp: "clamp", Identity: "identity" },
  cancelAnimation: () => {},
  makeMutable: <T>(initial: T): SharedValueStub<T> => sharedValueBox(initial),
};
