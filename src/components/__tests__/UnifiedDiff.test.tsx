import { beforeEach, describe, expect, test } from "bun:test";

import { UnifiedDiff } from "@/components/UnifiedDiff";
import { apiStub, setDiffSources } from "@/testing/context-holds";
import { renderWithProviders } from "@/testing/harness";

/**
 * Render tests for the diff panel.
 *
 * `diff-view.test.ts` covers the pure model -- counting, flattening, filtering,
 * collapsing. This file covers the four claims the panel makes that only a render
 * can settle:
 *
 *   1. A file git has never seen appears. (`vcs.diff` cannot report one.)
 *   2. The body is not built when its file is collapsed. (The hang this rewrite
 *      exists to fix -- and the stub renders every row it is given, so absence
 *      here is real absence.)
 *   3. A failed listing degrades instead of claiming every file is new.
 *   4. The header total is the sum of what the rows show.
 */

const ON_CLOSE = () => {};

/** One `vcs.diff` entry, as the server sends it. */
function diffEntry(file: string, patch: string) {
  return { file, patch };
}

/** A patch with one addition and one removal. */
const ONE_UP_ONE_DOWN = [
  "@@ -1,2 +1,2 @@",
  " context line",
  "-removed line",
  "+added line",
].join("\n");

function render() {
  return renderWithProviders(<UnifiedDiff onClose={ON_CLOSE} visible />);
}

beforeEach(() => {
  // A consistent fixture: the diff reports one tracked file, the status set knows
  // that file, and the listing holds it plus one file git has never seen.
  setDiffSources({
    vcsDiff: async () => ({
      data: [diffEntry("src/tracked.ts", ONE_UP_ONE_DOWN)],
    }),
    vcsStatus: async () => ({
      data: [
        {
          file: "src/tracked.ts",
          additions: 1,
          deletions: 1,
          status: "modified",
        },
      ],
    }),
    fileList: async () => ({
      data: [{ path: "src/tracked.ts" }, { path: "src/brand-new.ts" }],
    }),
  });
});

describe("UnifiedDiff", () => {
  test("shows a file git has never seen, which vcs.diff cannot report", async () => {
    const result = await render();
    await result.flush();

    const text = result.text();
    expect(text).toContain("src/tracked.ts");
    // The whole point of subtracting the status set from the listing: a brand new
    // file has no diff entry at all, so without this it is simply absent.
    expect(text).toContain("src/brand-new.ts");
    result.unmount();
  });

  test("labels an untracked file new file rather than claiming +0", async () => {
    // "+0 −0" would be a confident statement about a measurement nobody made:
    // there is no patch for a file git has never seen, so no lines to count.
    const result = await render();
    await result.flush();

    expect(result.text()).toContain("new file");
    result.unmount();
  });

  test("reports the totals it is showing on the rows", async () => {
    const result = await render();
    await result.flush();

    expect(result.text()).toContain("+1 −1");
    expect(result.text()).toContain("2 files");
    result.unmount();
  });

  test("collapses a file, and its body stops being built", async () => {
    // The stub renders every row it is handed, so a collapsed body showing up at
    // all would mean the row list was not actually emptied -- which is the
    // mechanism the hang fix depends on.
    const result = await render();
    await result.flush();
    expect(result.text()).toContain("+added line");

    await result.pressExact("src/tracked.ts");
    await result.flush();

    expect(result.text()).not.toContain("+added line");
    // The header stays, so the file can be opened again.
    expect(result.text()).toContain("src/tracked.ts");
    result.unmount();
  });

  test("a failed listing degrades to the tracked diff instead of lying", async () => {
    // Half the reconstruction is worse than none. If the status set fails, every
    // listed file would be reported as new -- the panel would claim five new
    // files when the truth is one modified file.
    setDiffSources({
      vcsStatus: async () => {
        throw new Error("vcs.status unavailable");
      },
    });

    const result = await render();
    await result.flush();

    const text = result.text();
    expect(text).toContain("src/tracked.ts");
    expect(text).not.toContain("new file");
    result.unmount();
  });

  test("asks for the working tree, not a branch or a commit range", async () => {
    const result = await render();
    await result.flush();

    expect(apiStub().vcsDiff.calls).toHaveLength(1);
    expect(apiStub().vcsDiff.calls[0]).toMatchObject({ mode: "working" });
    result.unmount();
  });

  test("says so when there is nothing to show", async () => {
    setDiffSources({
      vcsDiff: async () => ({ data: [] }),
      vcsStatus: async () => ({ data: [] }),
      fileList: async () => ({ data: [] }),
    });

    const result = await render();
    await result.flush();

    expect(result.text()).toContain("No changes");
    result.unmount();
  });

  test("re-reads the working tree on its own while the panel is open", async () => {
    // The agent writes files continuously, so a panel the user must refresh by
    // hand answers "what did it just change?" with a stale answer — which is the
    // only reason to have the panel open. Asserted through the registered query
    // because the interval is invisible in the rendered output.
    const result = await render();
    await result.flush();

    const query = result.queryClient
      .getQueryCache()
      .find({ queryKey: ["workspace-diff", "/repo", "ses_test"] });
    // `refetchInterval` is on the resolved options at runtime but is not part of
    // the public `QueryOptions` type in this version, so it is read through a
    // narrow local type rather than by casting the query to `any`.
    const options = query?.options as { refetchInterval?: unknown } | undefined;
    expect(options?.refetchInterval).toBe(15_000);
    result.unmount();
  });

  test("closing forgets the filter, so the panel reopens clean", async () => {
    // Reset here rather than in an effect: an effect that clears the filter runs
    // after the panel is already hidden, so it re-renders to change state nobody
    // can see.
    const result = await render();
    await result.flush();

    await result.pressExact("src/tracked.ts");
    await result.flush();
    expect(result.text()).not.toContain("+added line");

    await result.pressAccessibility("Close");
    await result.flush();

    // Collapsed state is back to expanded, which is only observable as the body
    // reappearing.
    expect(result.text()).toContain("+added line");
    result.unmount();
  });
});
