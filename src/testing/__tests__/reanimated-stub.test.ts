import { describe, expect, test } from "bun:test";

import {
  Animated,
  reanimatedStub,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "@/testing/reanimated-stub";

/**
 * Self-checks for the `react-native-reanimated` stub.
 *
 * Five components import Reanimated and none of them had any render coverage
 * before this module existed, so the stub is load-bearing for a lot of tests now.
 * That makes its own contract worth asserting: a stub that quietly lied about
 * shared values would make every panel's first frame wrong in a way no assertion
 * would catch.
 *
 * The bargain, restated because these tests exist to hold it in place: **values
 * are real, time is not.** A shared value is a genuinely mutable box and
 * `useAnimatedStyle` genuinely evaluates its worklet, so a component renders its
 * settled state. There is no frame loop, so `withTiming` resolves instantly and
 * no test may observe an animation mid-flight.
 */

describe("useSharedValue", () => {
  test("holds the value it was given", () => {
    expect(useSharedValue(7).value).toBe(7);
  });

  test("a write is visible to the next read", () => {
    // The whole reason this is a box and not a constant: components assign
    // `.value` inside effects to move a panel, and if that assignment went
    // nowhere every sliding panel would render at its initial offset forever.
    const box = useSharedValue(0);
    box.value = 100;
    expect(box.value).toBe(100);
    expect(box.get()).toBe(100);
  });

  test("`set` is the same as assigning, not a second source of truth", () => {
    const box = useSharedValue("a");
    box.set("b");
    expect(box.value).toBe("b");
  });

  test("two boxes do not share state", () => {
    const first = useSharedValue(1);
    const second = useSharedValue(2);
    first.value = 99;
    expect(second.value).toBe(2);
  });

  test("holds a non-number, so a string or object value is not mangled", () => {
    const box = useSharedValue({ open: false });
    box.value = { open: true };
    expect(box.value).toEqual({ open: true });
  });
});

describe("withTiming", () => {
  test("returns the destination, so a panel renders settled", () => {
    // Not "starts at 0 and animates": there is no clock here, so the only
    // defensible answer is the destination. Anything else would leave a test
    // asserting on an intermediate frame.
    expect(withTiming(240, { duration: 220 })).toBe(240);
  });

  test("invokes the completion callback, because the transition is already over", () => {
    let called = false;
    withTiming(1, {}, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  test("accepts being called with no config at all", () => {
    expect(withTiming(5)).toBe(5);
  });
});

describe("useAnimatedStyle", () => {
  test("evaluates the worklet rather than ignoring it", () => {
    // A stub returning a constant would render every animated panel identically
    // regardless of its state, and no assertion about motion would notice.
    const box = useSharedValue(0);
    expect(useAnimatedStyle(() => ({ opacity: box.value }))).toEqual({
      opacity: 0,
    });

    box.value = 1;
    expect(useAnimatedStyle(() => ({ opacity: box.value }))).toEqual({
      opacity: 1,
    });
  });

  test("closes over a shared value, which is the normal usage", () => {
    const x = useSharedValue(10);
    const style = useAnimatedStyle(() => ({
      transform: [{ translateX: x.value }],
    }));

    expect(style).toEqual({ transform: [{ translateX: 10 }] });
  });
});

describe("runOnJS", () => {
  test("returns the function unchanged, since already on the JS thread", () => {
    const fn = () => 42;
    expect(runOnJS(fn)).toBe(fn);
  });
});

describe("Animated", () => {
  test("a builder composes but never advances", () => {
    // `start` invokes nothing, completion callback included. A component waiting
    // on one therefore stays waiting — the honest outcome for an animation that
    // never ran, and the reason no test may depend on one completing.
    let finished = false;
    Animated.timing(1, {}).start(() => {
      finished = true;
    });
    expect(finished).toBe(false);
  });

  test("every builder a component in the app uses exists", () => {
    for (const name of [
      "timing",
      "spring",
      "sequence",
      "parallel",
      "delay",
      "loop",
    ]) {
      const handle = (
        Animated as unknown as Record<string, () => { start: () => void }>
      )[name]?.();
      expect(typeof handle?.start).toBe("function");
    }
  });

  test("createAnimatedComponent is the identity, so the element still renders", () => {
    const component = () => null;
    expect(Animated.createAnimatedComponent(component)).toBe(component);
  });
});

describe("the module namespace", () => {
  test("exposes a default export, because the app does a default import", () => {
    // `import Animated from "react-native-reanimated"` resolves through `default`.
    // A namespace object with no `default` would throw at module link, which is a
    // confusing way to learn about it.
    expect(reanimatedStub.default).toBe(Animated);
  });

  test("exposes everything the app's five importers reference", () => {
    // `ChatScrollBar`, `FileDrawer`, `Snackbar`, `WorkspaceScreen` and
    // `UnifiedDiff` between them import this list. A gap here is a module-link
    // failure in whichever component asked for it next.
    for (const name of [
      "useSharedValue",
      "useAnimatedStyle",
      "useDerivedValue",
      "withTiming",
      "withSpring",
      "runOnJS",
      "makeMutable",
      "createAnimatedComponent",
    ]) {
      expect(
        typeof (reanimatedStub as unknown as Record<string, unknown>)[name],
      ).toBe("function");
    }
  });

  test("makeMutable builds the same box, without being a hook", () => {
    // It shares the implementation with `useSharedValue` rather than calling it,
    // so the rules-of-hooks check has nothing to complain about.
    const box = reanimatedStub.makeMutable(3);
    box.value = 4;
    expect(box.get()).toBe(4);
  });
});
