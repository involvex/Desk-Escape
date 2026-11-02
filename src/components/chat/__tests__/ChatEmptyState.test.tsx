import { describe, expect, test } from "bun:test";

import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { renderWithProviders } from "@/testing/harness";

/**
 * The empty state used to be rendered through an inverted `FlatList`'s
 * `ListEmptyComponent`, which turned it upside down, and a failed transcript
 * query rendered it too — so "the session is empty" and "the fetch broke" looked
 * identical. These tests pin the two distinct states.
 */

const noop = () => {};

function emptyState(overrides: Partial<Parameters<typeof ChatEmptyState>[0]>) {
  return (
    <ChatEmptyState
      error={null}
      hintCommand="help"
      onRetry={noop}
      onTryHint={noop}
      {...overrides}
    />
  );
}

describe("ChatEmptyState", () => {
  test("invites the user to try the hint command", async () => {
    const result = await renderWithProviders(emptyState({}));

    expect(result.text()).toContain("Ask the agent to inspect");
    expect(result.text()).toContain("Try /help");
    result.unmount();
  });

  test("offers the create/palette actions only when their callbacks exist", async () => {
    const withActions = await renderWithProviders(
      emptyState({ onCreateSession: noop, onOpenPalette: noop }),
    );
    expect(withActions.text()).toContain("New session");
    expect(withActions.text()).toContain("Command palette");
    withActions.unmount();

    const withoutActions = await renderWithProviders(emptyState({}));
    expect(withoutActions.text()).not.toContain("New session");
    expect(withoutActions.text()).not.toContain("Command palette");
    withoutActions.unmount();
  });

  test("shows the failure and a working retry instead of the empty copy", async () => {
    let retries = 0;
    const result = await renderWithProviders(
      emptyState({
        error: "Could not reach the OpenCode server.",
        onRetry: () => {
          retries += 1;
        },
      }),
    );

    expect(result.text()).toContain("Couldn't load this transcript");
    expect(result.text()).toContain("Could not reach the OpenCode server.");
    expect(result.text()).not.toContain("Ask the agent to inspect");

    await result.pressText("Retry");
    expect(retries).toBe(1);
    result.unmount();
  });

  test("labels the retry as in-flight while a refetch is running", async () => {
    const result = await renderWithProviders(
      emptyState({ error: "boom", isRetrying: true }),
    );

    expect(result.text()).toContain("Retrying…");
    result.unmount();
  });

  test("runs the hint action from the chip", async () => {
    let hints = 0;
    const result = await renderWithProviders(
      emptyState({
        onTryHint: () => {
          hints += 1;
        },
      }),
    );

    await result.pressExact("Try /help");
    expect(hints).toBe(1);
    result.unmount();
  });
});
