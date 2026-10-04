import { describe, expect, test } from "bun:test";
import { useEffect, useState } from "react";
import { createRoot } from "test-renderer";
import { Pressable as HostPressable, Text as HostText } from "react-native";

import { act, renderWithProviders } from "@/testing/harness";
import { actViolationsSeen, drainActViolations } from "@/testing/setup";
import { clipboardWrites, writeToClipboard } from "@/testing/clipboard-stub";
import {
  currentConnection,
  currentPermission,
  currentProject,
  currentTheme,
} from "@/testing/context-holds";

/**
 * Proves the harness itself works.
 *
 * Without these, a harness bug and a screen bug look identical: both produce a
 * test that cannot find what it expected. Each check below corresponds to one
 * capability the screen tests rely on.
 */

/** Every effect run seen so far, across the tests in this file. */
const effectRuns: string[] = [];

/** Proves effects ran and that `act` waited for them. */
function EffectProbe() {
  useEffect(() => {
    effectRuns.push("mount");
  }, []);
  return <HostText>probe</HostText>;
}

function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <HostPressable onPress={() => setCount((c) => c + 1)}>
      <HostText>{`${label}=${count}`}</HostText>
    </HostPressable>
  );
}

describe("harness", () => {
  test("renders a tree and exposes its text", async () => {
    const result = await renderWithProviders(<Counter label="n" />);
    expect(result.text()).toContain("n=0");
    result.unmount();
  });

  test("effects flush before assertions", async () => {
    effectRuns.length = 0;
    const result = await renderWithProviders(<EffectProbe />);

    // No `flush()` on purpose. If rendering awaited effects this is already true; if
    // it does not, the harness needs fixing and this is where it shows.
    expect(effectRuns).toEqual(["mount"]);
    expect(result.text()).toContain("probe");

    // And a subsequent interaction does not re-run a mount-only effect.
    await result.flush();
    expect(effectRuns).toEqual(["mount"]);
    result.unmount();
  });

  test("presses fire handlers inside act", async () => {
    const result = await renderWithProviders(<Counter label="n" />);
    expect(result.text()).toContain("n=0");

    await result.pressText("n=0");
    expect(result.text()).toContain("n=1");

    result.unmount();
  });

  test("pressExact skips a substring match that is not a control", async () => {
    // The hazard `pressExact` exists for: a button captioned "Always" sitting under
    // prose that also says "Always". Substring matching finds the prose first and
    // then fails, so the exact matcher has to reach the button instead.
    const presses: string[] = [];
    const result = await renderWithProviders(
      <>
        <HostText>“Always” remembers this choice.</HostText>
        <HostPressable onPress={() => presses.push("always")}>
          <HostText>Always</HostText>
        </HostPressable>
      </>,
    );

    expect(() => result.pressText("Always")).toThrow(/no ancestor carries/);
    await result.pressExact("Always");

    expect(presses).toEqual(["always"]);
    result.unmount();
  });

  test("pressExact fails with the rendered text when nothing matches", async () => {
    const result = await renderWithProviders(<Counter label="n" />);
    expect(() => result.pressExact("n=0 ")).toThrow(/Rendered text/);
    result.unmount();
  });

  test("finds host nodes by type", async () => {
    const result = await renderWithProviders(<Counter label="n" />);
    expect(result.byType("Text").length).toBeGreaterThan(0);
    expect(result.byType("Pressable").length).toBeGreaterThan(0);
    result.unmount();
  });

  test("a missing host type fails with what was actually rendered", async () => {
    const result = await renderWithProviders(<Counter label="n" />);
    // The message has to be diagnostic, otherwise a failing screen test gives no
    // clue whether the screen or the harness is at fault.
    expect(() => result.find("WebView")).toThrow(/Available host types/);
    result.unmount();
  });

  test("a missing pressable label fails with the rendered text", async () => {
    const result = await renderWithProviders(<Counter label="n" />);
    expect(() => result.pressText("nope")).toThrow(/Rendered text/);
    result.unmount();
  });

  test("merges extra props into the element under test", async () => {
    const result = await renderWithProviders(<Counter label="a" />, {
      props: { label: "b" },
    });
    expect(result.text()).toContain("b=0");
    result.unmount();
  });

  test("context slots do not leak between mounts", async () => {
    // The slots are module-level, so a test that sets one has to be undone by the
    // next mount or the failure lands in an unrelated test — a connection stuck on
    // `null` directory, a theme left as `oled-black`, a permission request that is
    // still queued. `mount` resets first for exactly this reason, and this is the
    // check that the reason stays true.
    const first = await renderWithProviders(<Counter label="n" />, {
      connection: { sessionId: "ses_leak", activeDirectory: "/leak" },
      permission: { pendingCount: 7 },
      project: null,
      theme: "oled-black",
    });
    // A clipboard write before the second mount: the log is module-level too, and a
    // leaked entry turns a later `toEqual([...])` on it into a failure about
    // ordering rather than about the component.
    await writeToClipboard("leaked");
    first.unmount();

    const second = await renderWithProviders(<Counter label="n" />);

    expect(currentConnection().sessionId).toBe("ses_test");
    expect(currentConnection().activeDirectory).toBe("/repo");
    expect(currentProject().data).not.toBeNull();
    expect(currentTheme().themeName).toBe("dev-dark");
    expect(currentPermission().pendingCount).toBe(0);
    expect(clipboardWrites()).toEqual([]);

    second.unmount();
  });

  test("the act tripwire is armed", () => {
    // A tripwire cannot be verified by disarming it — nothing steps on it once the
    // interception is gone. So this provokes a violation and checks it was noticed,
    // then drains it so it does not fail the test that proved it works.
    const before = actViolationsSeen();
    console.error(
      "An update to Counter inside a test was not wrapped in act(...).",
    );

    expect(actViolationsSeen()).toBe(before + 1);
    expect(drainActViolations()).toBe(before + 1);
  });

  test("root mounts and unmounts without act warnings", () => {
    // `IS_REACT_ACT_ENVIRONMENT` is set in the preload; without it React logs a
    // warning per act() call and effects run outside the act scope.
    const warnings: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      warnings.push(String(args[0]));
    };
    try {
      const root = createRoot({ textComponentTypes: ["Text"] });
      act(() => {
        root.render(<HostText>hi</HostText>);
      });
      act(() => root.unmount());
    } finally {
      console.error = original;
    }
    expect(warnings.filter((w) => w.includes("act("))).toEqual([]);
  });
});
