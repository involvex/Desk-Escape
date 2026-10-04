import { describe, expect, test } from "bun:test";

import { AttachmentChips } from "@/components/AttachmentChips";
import type { ContextAttachment } from "@/types/opencode";
import { renderWithProviders, type RenderResult } from "@/testing/harness";

/**
 * Render tests for the staged-attachment chips.
 *
 * §4.11 built these and covered the queue behind them, but the row itself was
 * forty lines of JSX inside `AgentChat` — reachable only by rendering a FlatList,
 * a composer and a keyboard-avoiding view. Two things went unasserted as a result,
 * and both fail silently: which id the remove button reports, and when "Clear all"
 * is offered at all.
 */

function attachment(id: string, path: string): ContextAttachment {
  return { id, path, addedAt: "2026-01-01T00:00:00.000Z" };
}

/** Render the chips over `files`, recording what they reported. */
async function render(files: readonly ContextAttachment[]): Promise<{
  result: RenderResult;
  calls: { removed: string[]; cleared: number };
}> {
  const calls = { removed: [] as string[], cleared: 0 };
  const result = await renderWithProviders(
    <AttachmentChips
      attachments={files}
      onClearAll={() => {
        calls.cleared += 1;
      }}
      onRemove={(id) => calls.removed.push(id)}
    />,
  );
  return { result, calls };
}

describe("AttachmentChips", () => {
  test("renders nothing when no file is staged", async () => {
    // Not merely blank — an empty row would still push the chat down by the row's
    // height plus its bottom margin.
    const { result } = await render([]);
    expect(result.text()).toBe("");
    expect(result.byType("View")).toHaveLength(0);
    result.unmount();
  });

  test("names each staged file", async () => {
    const { result } = await render([
      attachment("att_1", "src/api/hooks.ts"),
      attachment("att_2", "docs/ARCHITECTURE.md"),
    ]);
    const lines = result.text().split("\n");
    expect(lines).toContain("src/api/hooks.ts");
    expect(lines).toContain("docs/ARCHITECTURE.md");
    result.unmount();
  });

  test("removes by id even though the label is the path", async () => {
    // The pair that makes this worth asserting: two files from different
    // directories can share a basename, and only the id identifies one of them. A
    // remove keyed on the visible path would drop the wrong chip.
    const { result, calls } = await render([
      attachment("att_1", "packages/web/src/index.ts"),
      attachment("att_2", "packages/api/src/index.ts"),
    ]);

    await result.pressAccessibility("Remove packages/api/src/index.ts");

    expect(calls.removed).toEqual(["att_2"]);
    result.unmount();
  });

  test("each chip's cross removes only that chip", async () => {
    const { result, calls } = await render([
      attachment("att_1", "a.ts"),
      attachment("att_2", "b.ts"),
      attachment("att_3", "c.ts"),
    ]);

    await result.pressAccessibility("Remove a.ts");
    await result.pressAccessibility("Remove c.ts");

    expect(calls.removed).toEqual(["att_1", "att_3"]);
    expect(calls.cleared).toBe(0);
    result.unmount();
  });

  test("truncates a long path rather than clipping it", async () => {
    const { result } = await render([
      attachment("att_1", "src/very/deeply/nested/module/index.ts"),
    ]);
    const label = result.byText("src/very/deeply/nested/module/index.ts");
    expect(label).toHaveLength(1);
    // `numberOfLines={1}` is what makes the OS ellipsize; without it a deep path
    // runs off the chip instead of ending in "…".
    expect(label[0]?.props.numberOfLines).toBe(1);
    result.unmount();
  });

  test("offers no clear-all for a single file", async () => {
    // The chip's own cross already removes the one file, so a second control doing
    // the same thing is a mis-tap waiting to happen.
    const { result } = await render([attachment("att_1", "a.ts")]);
    expect(result.text()).not.toContain("Clear all");
    result.unmount();
  });

  test("offers clear-all once there is more than one file", async () => {
    const { result, calls } = await render([
      attachment("att_1", "a.ts"),
      attachment("att_2", "b.ts"),
    ]);
    expect(result.text()).toContain("Clear all");

    await result.pressAccessibility("Clear all attachments");

    expect(calls.cleared).toBe(1);
    // Clearing everything must not also remove the individual entries: the two
    // controls are alternatives, and a clear that fired both would leave the queue
    // reporting files that are no longer staged.
    expect(calls.removed).toEqual([]);
    result.unmount();
  });
});
