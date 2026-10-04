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

/** `useSharedValue`: a plain mutable box, plus the accessors Reanimated provides. */
export function useSharedValue<T>(initial: T): SharedValueStub<T> {
  return sharedValueBox(initial);
}

/**
 * The box both `useSharedValue` and `makeMutable` build.
 *
 * Split out so `makeMutable` is not a hook calling a hook: it is not, and the
 * linter's rules-of-hooks check is right to say so. The behaviour is identical.
 */
function sharedValueBox<T>(initial: T): SharedValueStub<T> {
  const box: SharedValueStub<T> = {
    value: initial,
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
 */
export function useAnimatedStyle<T>(factory: () => T): T {
  return factory();
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

/** `runOnJS`: already on the JS thread, so the function is returned unchanged. */
export function runOnJS<T extends (...args: never[]) => unknown>(fn: T): T {
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
  useDerivedValue: <T>(factory: () => T): { value: T } => ({
    value: factory(),
  }),
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
