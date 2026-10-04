import { describe, expect, test } from "bun:test";

import { RevertBanner } from "@/components/RevertBanner";
import {
  initialRevertState,
  type RevertState,
  type RevertSummary,
} from "@/api/session-revert";
import { renderWithProviders } from "@/testing/harness";

/**
 * Render tests for the revert banner.
 *
 * `session-revert.test.ts` pins the state machine and the wording helper. This
 * file pins the thing that machine feeds: that each phase reaches the screen, that
 * irreversible wording is actually on screen before the destructive button is, and
 * that the buttons call the right callbacks.
 */

function summary(overrides: Partial<RevertSummary> = {}): RevertSummary {
  return {
    anchorMessageId: "msg_anchor",
    files: [{ path: "src/a.ts", additions: 10, deletions: 4 }],
    fileCount: 1,
    additions: 10,
    deletions: 4,
    filesOnly: false,
    ...overrides,
  };
}

function state(overrides: Partial<RevertState> = {}): RevertState {
  return { ...initialRevertState, ...overrides };
}

/** Render with no-op callbacks and report which ones fired. */
async function render(revertState: RevertState, hasTarget = true) {
  const calls: string[] = [];
  const result = await renderWithProviders(
    <RevertBanner
      hasTarget={hasTarget}
      onClear={() => calls.push("clear")}
      onCommit={() => calls.push("commit")}
      state={revertState}
    />,
  );
  return { ...result, calls };
}

describe("RevertBanner", () => {
  test("stays out of the way when idle with nothing to undo", async () => {
    const result = await render(state(), false);
    // Not "renders nothing" in general — the assertion that matters is that the
    // whole tree is empty, so an idle banner cannot occupy layout space.
    expect(result.text()).toBe("");
    expect(result.byType("View")).toHaveLength(0);
    result.unmount();
  });

  test("prompts when idle with a target to undo", async () => {
    const result = await render(state(), true);
    expect(result.text()).toContain("Undo the last turn?");
    result.unmount();
  });

  test("says the staging is reversible while it happens", async () => {
    const result = await render(state({ phase: "staging" }));
    expect(result.text()).toContain("Checking what to undo");
    // While staging there is nothing to confirm or deny, so no buttons at all.
    expect(result.byType("Pressable")).toHaveLength(0);
    result.unmount();
  });

  test("shows a spinner while staging or committing", async () => {
    const staging = await render(state({ phase: "staging" }));
    expect(staging.byType("ActivityIndicator")).toHaveLength(1);
    staging.unmount();

    const committing = await render(state({ phase: "committing" }));
    expect(committing.byType("ActivityIndicator")).toHaveLength(1);
    expect(committing.text()).toContain("Reverting");
    committing.unmount();
  });

  test("states the consequences before offering the destructive action", async () => {
    const result = await render(state({ phase: "staged", summary: summary() }));
    // The wording comes from `revertConfirmationText`, already covered by the
    // pure tests. What matters here is that it is on screen *next to* the
    // button — a banner that showed "Ready to undo" and hid the file count would
    // still pass those tests.
    expect(result.text()).toContain("src/a.ts");
    expect(result.text()).toMatch(/cannot be undone|irreversible/i);
    expect(result.text()).toContain("Revert");
    result.unmount();
  });

  test("offers both actions when staged", async () => {
    const result = await render(state({ phase: "staged", summary: summary() }));
    expect(result.text()).toContain("Revert");
    expect(result.text()).toContain("Keep");
    result.unmount();
  });

  test("Revert commits and Keep clears", async () => {
    const result = await render(state({ phase: "staged", summary: summary() }));

    await result.pressText("Revert");
    expect(result.calls).toEqual(["commit"]);

    await result.pressText("Keep");
    expect(result.calls).toEqual(["commit", "clear"]);

    result.unmount();
  });

  test("drops the buttons once committing, so it cannot be fired twice", async () => {
    // A double-tap on "Revert" would send two `session.revert.commit` calls.
    // Removing the action as soon as the request is in flight is what prevents
    // the second one.
    const result = await render(
      state({ phase: "committing", summary: summary() }),
    );
    expect(result.text()).not.toContain("Keep");
    expect(result.byType("Pressable")).toHaveLength(0);
    result.unmount();
  });

  test("shows the error from a failed stage without offering a commit", async () => {
    const result = await render(
      state({ phase: "idle", error: "Session is still streaming" }),
    );
    expect(result.text()).toContain("Session is still streaming");
    expect(result.byType("Pressable")).toHaveLength(0);
    result.unmount();
  });

  test("says a transcript-only revert touches no files", async () => {
    // The distinction the banner exists to make: rewriting three source files and
    // trimming the conversation are not the same promise.
    const result = await render(
      state({
        phase: "staged",
        summary: summary({ filesOnly: true, files: [], fileCount: 0 }),
      }),
    );
    expect(result.text()).toMatch(/no files/i);
    result.unmount();
  });

  test("renders with no summary at all rather than crashing", async () => {
    // `staged` without a summary should be impossible — the machine requires a
    // summary to reach `staged` — but a crash here would blank the workspace, so
    // the degenerate case is pinned rather than assumed away.
    const result = await render(state({ phase: "staged", summary: null }));
    expect(result.text()).toContain("Ready to undo");
    expect(result.text()).toContain("Revert");
    result.unmount();
  });
});
