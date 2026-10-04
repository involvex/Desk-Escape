import { describe, expect, test } from "bun:test";
import { StyleSheet } from "react-native";

import { PermissionBanner } from "@/components/PermissionBanner";
import type { PendingPermission } from "@/api/permissions";
import { permissionCallLog } from "@/testing/context-holds";
import {
  renderWithProviders,
  type RenderOptions,
  type RenderResult,
} from "@/testing/harness";

/**
 * Render tests for the approval banner.
 *
 * `api/__tests__/permission-queue.test.ts` pins the queue algebra — enqueue,
 * dedupe, dismiss-head, rehydrate, merge. That is deliberately a pure module with
 * no React in it, which means everything the banner *decides* was untested: which
 * request it shows, what it says about the request behind it, whether the buttons
 * are live while a reply is in flight, and — the one that would actually strand a
 * turn — which decision each button reports.
 */

function pending(
  overrides: Partial<PendingPermission> = {},
): PendingPermission {
  return {
    id: "perm_1",
    sessionId: "ses_test",
    action: "bash",
    resources: ["src/a.ts"],
    message: "Run the test suite?",
    title: "Run a shell command",
    description: "Run the test suite?",
    receivedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Render the banner against one permission context state. */
async function render(state: RenderOptions = {}): Promise<RenderResult> {
  return renderWithProviders(<PermissionBanner />, state);
}

/** The rendered text, one entry per `Text` node. */
function lines(result: RenderResult): string[] {
  return result.text().split("\n");
}

describe("PermissionBanner", () => {
  test("renders nothing when no request is pending", async () => {
    // Not just "no text" — an empty tree, so an idle banner takes no layout space
    // above the chat.
    const result = await render({ permission: {} });
    expect(result.text()).toBe("");
    expect(result.byType("View")).toHaveLength(0);
    expect(result.byType("Pressable")).toHaveLength(0);
    result.unmount();
  });

  test("shows the request it has been given", async () => {
    const result = await render({
      permission: {
        pending: pending({ title: "Edit files", message: "Patch src/a.ts?" }),
        pendingCount: 1,
      },
    });
    const text = result.text();
    expect(text).toContain("Edit files");
    expect(text).toContain("Patch src/a.ts?");
    result.unmount();
  });

  test("counts the requests waiting behind the one shown", async () => {
    // Without this, answering the head makes a different prompt appear with
    // nothing to say why — which reads as the app losing track of the request.
    const single = await render({
      permission: { pending: pending(), pendingCount: 1 },
    });
    expect(single.text()).not.toContain("1 of ");
    const singleRows = single.byType("Text").length;
    single.unmount();

    const queued = await render({
      permission: { pending: pending(), pendingCount: 3 },
    });
    expect(queued.text()).toContain("1 of 3");
    // A `Text` node, not just a string. `queueDepthLabel` returns `null` for one
    // request so the caller can render nothing — and rendering an empty node
    // instead satisfies every "the text is not there" assertion while still leaving
    // a gap where the count goes.
    expect(queued.byType("Text")).toHaveLength(singleRows + 1);
    queued.unmount();
  });

  test("renders one row per resource, and no list when there are none", async () => {
    const listed = await render({
      permission: {
        pending: pending({ resources: ["src/a.ts", "src/b.ts"] }),
        pendingCount: 1,
      },
    });
    expect(lines(listed)).toContain("src/a.ts");
    expect(lines(listed)).toContain("src/b.ts");
    // banner + resource list + the actions row. Counting the list container is
    // what pins the guard: an empty bordered box reads as a broken prompt rather
    // than as "nothing to list".
    expect(listed.byType("View")).toHaveLength(3);
    listed.unmount();

    const bare = await render({
      permission: { pending: pending({ resources: [] }), pendingCount: 1 },
    });
    expect(bare.text()).not.toContain("src/a.ts");
    expect(bare.byType("View")).toHaveLength(2);
    bare.unmount();
  });

  test("omits the message row when the server sent none", async () => {
    const withMessage = await render({
      permission: { pending: pending({ message: "Patch src/a.ts?" }) },
    });
    expect(withMessage.text()).toContain("Patch src/a.ts?");
    const withMessageRows = withMessage.byType("Text").length;
    withMessage.unmount();

    const without = await render({
      permission: { pending: pending({ message: "" }) },
    });
    // One Text node fewer: the row is not rendered empty, which would leave a
    // blank line between the title and the resource list.
    expect(without.byType("Text")).toHaveLength(withMessageRows - 1);
    without.unmount();
  });

  describe("what Always would remember", () => {
    test("names the action and the project when both are known", async () => {
      const result = await render({
        permission: {
          pending: pending({ action: "bash", resources: ["src/a.ts"] }),
        },
      });
      const text = result.text();
      expect(text).toContain(
        "“Always” remembers this for bash in this project.",
      );
      expect(text).not.toContain("remembers this choice");
      result.unmount();
    });

    test("falls back to the project-only wording with no action", async () => {
      // An unrecognised action arrives as `""`, and claiming to remember "this for
      // " would be nonsense — so the specific sentence has to be conditional.
      const result = await render({
        permission: {
          pending: pending({ action: "", resources: ["src/a.ts"] }),
        },
      });
      expect(result.text()).toContain(
        "“Always” remembers this choice for the project.",
      );
      result.unmount();
    });

    test("falls back to the project-only wording with no resources", async () => {
      const result = await render({
        permission: { pending: pending({ action: "bash", resources: [] }) },
      });
      expect(result.text()).toContain(
        "“Always” remembers this choice for the project.",
      );
      result.unmount();
    });
  });

  test("shows the last failure and lets it be dismissed", async () => {
    const result = await render({
      permission: { pending: pending(), error: "Not connected." },
    });
    expect(result.text()).toContain("Not connected.");

    // The failure is the only thing on the banner that is its own tap target —
    // it is a retry hint, not a decision.
    await result.pressText("Not connected.");

    expect(permissionCallLog().clearError).toBe(1);
    result.unmount();
  });

  describe("a reply the user gave from a notification", () => {
    test("says how many are waiting for the connection", async () => {
      // The visible half of "never drop a tap". Before it, the reply was discarded and
      // nothing was said: the OS had dismissed the notification, so the system recorded
      // the interaction as handled while the agent stayed blocked on the prompt. The
      // buttons here stay live — the tap has already been given, what is missing is a
      // client to send it with, and disabling the in-app answers would take away the
      // one route that still works.
      const result = await render({
        permission: { pending: pending(), deferredCount: 1 },
      });

      expect(result.text()).toContain("1 reply waiting for the connection");
      result.unmount();
    });

    test("pluralises, because several can be outstanding", async () => {
      // §4.9's queue: the agent blocks on requests in order, so more than one can be
      // waiting at a time and a singular label would understate what is outstanding.
      const result = await render({
        permission: { pending: pending(), deferredCount: 3 },
      });

      expect(result.text()).toContain("3 replies waiting for the connection");
      result.unmount();
    });

    test("says nothing when no reply is held", async () => {
      // The ordinary case, and the one a label bug would hide: a stray "0 replies"
      // would train the user to ignore the line that matters.
      const result = await render({ permission: { pending: pending() } });

      expect(result.text()).not.toContain("waiting for the connection");
      result.unmount();
    });

    test("leaves the in-app decisions live while a reply is held", async () => {
      // The point of the held reply is that it has not reached the agent. If the
      // in-app buttons were disabled too, the request would be unanswerable from
      // anywhere until the connection came back on its own.
      const result = await render({
        permission: { pending: pending(), deferredCount: 1 },
      });

      const buttons = result.byType("Pressable");
      for (const button of buttons) {
        expect(button.props.disabled).toBeFalsy();
      }
      result.unmount();
    });
  });

  test("disables every decision while a reply is in flight", async () => {
    // Pressing twice is how a permission gets answered twice, and the agent is
    // blocked on exactly one answer.
    const result = await render({
      permission: { pending: pending(), busy: true },
    });
    const buttons = result.byType("Pressable");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button.props.disabled).toBe(true);
    }
    // ...and visibly so, not just inert.
    expect(StyleSheet.flatten(buttons[0]?.props.style)?.opacity).toBe(0.5);
    result.unmount();
  });

  test("leaves the decisions live when nothing is in flight", async () => {
    const result = await render({ permission: { pending: pending() } });
    const buttons = result.byType("Pressable");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button.props.disabled).toBe(false);
    }
    expect(StyleSheet.flatten(buttons[0]?.props.style)?.opacity).toBe(1);
    result.unmount();
  });

  test("reports each answer under the label that produced it", async () => {
    // The four buttons look alike, so what pins them is which response each one
    // sends. "always" is the dangerous one to get wrong: it persists a grant the
    // user did not intend to give.
    for (const [label, expected] of [
      ["Allow once", "once"],
      ["Always", "always"],
      ["Reject", "reject"],
    ] as const) {
      const result = await render({ permission: { pending: pending() } });
      await result.pressExact(label);
      expect(permissionCallLog().respond).toEqual([expected]);
      result.unmount();
    }
  });

  test("dismiss reports nothing to the server", async () => {
    // Dismiss is "not now" — the request stays pending server-side and returns on
    // the next rehydration. Sending a decision here would answer a question the
    // user never chose an answer to.
    const result = await render({ permission: { pending: pending() } });
    await result.pressExact("Dismiss");

    expect(permissionCallLog().dismiss).toBe(1);
    expect(permissionCallLog().respond).toEqual([]);
    result.unmount();
  });
});
