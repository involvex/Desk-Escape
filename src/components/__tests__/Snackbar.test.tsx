import { describe, expect, test } from "bun:test";

import { Snackbar } from "@/components/Snackbar";
import {
  renderTimeSharedValueReads,
  resetRenderTimeReads,
  runOnJSCallsMade,
  resetRunOnJSCalls,
} from "@/testing/reanimated-stub";
import { renderWithProviders } from "@/testing/harness";

/** A no-op snackbar that lingers long enough to observe its mounted state. */
function snackbar(visible: boolean) {
  return (
    <Snackbar
      message="Hello"
      action={{ label: "Undo", onPress: () => {} }}
      visible={visible}
      onDismiss={() => {}}
      durationMs={5000}
    />
  );
}

describe("Snackbar", () => {
  test("renders its message and action while visible", async () => {
    const result = await renderWithProviders(snackbar(true));

    expect(result.text()).toContain("Hello");
    expect(result.byType("Pressable").length).toBe(1);
    result.unmount();
  });

  test("renders nothing once dismissed", async () => {
    const result = await renderWithProviders(snackbar(false));
    await result.flush();

    // The snackbar unmounts once its hide animation has been dispatched, instead
    // of lingering in the tree as an invisible host.
    expect(result.text()).toBe("");
    expect(result.byType("Pressable").length).toBe(0);
    result.unmount();
  });

  test("never reads a shared value during render", async () => {
    // The root cause of the "[Reanimated] Reading from `value` during component
    // render" warnings was this: Snackbar used to read `opacity.value` in the
    // component body to decide whether to unmount. That is a strict-mode
    // violation that drives a render loop (read → animate → read → …) on every
    // snackbar that is animating, which is exactly the loop that flapped the
    // session header and stalled the message-fetch query.
    //
    // The stub can't reproduce the warning (it has no frame loop and no strict
    // mode), but it *counts* body `.value` reads — so "zero" is the assertion
    // that fails on the old code and passes on the fixed one. This is checked
    // across both branches of the visibility toggle, since the read lived in the
    // `!visible` side.
    resetRenderTimeReads();

    const shown = await renderWithProviders(snackbar(true));
    expect(renderTimeSharedValueReads()).toBe(0);
    shown.unmount();

    resetRenderTimeReads();
    const hidden = await renderWithProviders(snackbar(false));
    await hidden.flush();
    expect(renderTimeSharedValueReads()).toBe(0);
    hidden.unmount();
  });

  test("routes the withTiming completion callback's setState through runOnJS", async () => {
    // A `withTiming` completion callback executes on the UI worklet thread in a
    // real runtime; calling a React state setter there synchronously is what
    // raises "[Worklets] Tried to synchronously call a Remote Function …
    // dispatchSetState on the UI Runtime". The fix is to hand the setter to the
    // JS thread via `runOnJS`.
    //
    // The stub can't reproduce the UI-thread boundary, but it counts every
    // `runOnJS(...)` hand-off, so "greater than zero" is the assertion that fails
    // on code that calls the setter directly from the callback and passes once
    // the `runOnJS` wrapper is in place. Both branches hit this path, so it is
    // checked for show and hide.
    resetRunOnJSCalls();
    const shown = await renderWithProviders(snackbar(true));
    expect(runOnJSCallsMade()).toBeGreaterThan(0);
    shown.unmount();

    resetRunOnJSCalls();
    const hidden = await renderWithProviders(snackbar(false));
    await hidden.flush();
    expect(runOnJSCallsMade()).toBeGreaterThan(0);
    hidden.unmount();
  });
});
