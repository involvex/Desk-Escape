import { beforeEach, describe, expect, test } from "bun:test";

import { StatsScreen } from "@/screens/StatsScreen";
import { apiStub, setSessionStats } from "@/testing/context-holds";
import { act, renderWithProviders } from "@/testing/harness";

/**
 * Render tests for the usage dashboard.
 *
 * `session-stats.test.ts` covers the aggregation helpers. This file covers what
 * only a render can show: which state the screen is in, whether it tells the
 * truth about its scope, and what a range tap actually re-requests.
 */

/** A `SessionStatsInfo` with every section populated. */
function fullStats() {
  return {
    range: { from: 0, to: 0 },
    sessions: 4,
    subagents: 2,
    prompts: 30,
    steps: 120,
    tokens: {
      input: 1000,
      output: 500,
      reasoning: 250,
      cache: { read: 9000, write: 100 },
    },
    cost: 1.5,
    tools: { mode: "summary", totals: { calls: 12, succeeded: 10 } },
    activeDays: 3,
    streak: 2,
    activity: [
      { date: "2026-09-01", steps: 10 },
      { date: "2026-09-02", steps: 40 },
    ],
    models: [
      {
        model: { providerID: "anthropic", modelID: "claude" },
        steps: 100,
        tokens: {
          input: 900,
          output: 400,
          reasoning: 200,
          cache: { read: 8000, write: 90 },
        },
        cost: 1.2,
      },
    ],
  };
}

/** A `SessionStatsInfo` where nothing happened in the window. */
function emptyStats() {
  return {
    ...fullStats(),
    sessions: 0,
    subagents: 0,
    prompts: 0,
    steps: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    cost: 0,
    tools: { mode: "summary", totals: { calls: 0, succeeded: 0 } },
    activeDays: 0,
    streak: 0,
    activity: [],
    models: [],
  };
}

/** What the screen sends to `session.stats`. */
interface StatsRequest {
  project?: string;
  from: number;
  to: number;
  tools?: string;
}

const navigation = { goBack: () => {} } as never;

function render() {
  return renderWithProviders(
    <StatsScreen navigation={navigation} route={{} as never} />,
  );
}

beforeEach(() => {
  setSessionStats(async () => fullStats());
});

describe("StatsScreen", () => {
  test("refuses to show figures before the project resolves", async () => {
    // `session.stats` takes no `location`, so an unscoped request may report every
    // project the server knows about. Showing a total there would be wrong, not
    // merely imprecise.
    setSessionStats(async () => fullStats());
    const result = await renderWithProviders(
      <StatsScreen navigation={navigation} route={{} as never} />,
      { project: null },
    );

    expect(result.text()).toContain("Resolving which project");
    expect(result.text()).not.toContain("Project: ");
    // And it never even attempts the request. A query started here throws inside its
    // own `queryFn` before reaching the client, so the endpoint sees nothing either
    // way — the difference is only visible in the cache, where a *registered but
    // disabled* query sits idle while an enabled one has fetched and failed.
    expect(apiStub().sessionStats.calls).toHaveLength(0);
    const unresolved = result.queryClient.getQueryState([
      "stats",
      "unresolved",
      "7d",
    ]);
    // Settled: a registered-but-disabled query stays `pending` and never leaves
    // `idle`. An enabled one would have fetched, and its own guard — "Project not
    // resolved." — would have moved it to `error`.
    expect(unresolved?.status).toBe("pending");
    expect(unresolved?.fetchStatus).toBe("idle");
    result.unmount();
  });

  test("labels every figure with the project it belongs to", async () => {
    const result = await render();
    await result.flush();

    expect(result.text()).toContain("Project: prj_test");
    expect(result.text()).toContain("Usage & cost");
    result.unmount();
  });

  test("scopes the request to the project and asks for tool summaries", async () => {
    const result = await render();
    await result.flush();

    expect(apiStub().sessionStats.calls).toHaveLength(1);
    expect(apiStub().sessionStats.calls[0]).toMatchObject({
      project: "prj_test",
      tools: "summary",
    });
    result.unmount();
  });

  test("shows the headline figures", async () => {
    const result = await render();
    await result.flush();

    const text = result.text();
    expect(text).toContain("Sessions");
    expect(text).toContain("Steps");
    expect(text).toMatch(/\$?1\.50/);
    result.unmount();
  });

  test("breaks tokens down without inventing a total", async () => {
    // Summing cache reads with billed tokens would overstate a cache-heavy session
    // by roughly an order of magnitude, so the screen shows five figures and no sum.
    const result = await render();
    await result.flush();

    const text = result.text();
    expect(text).toContain("Cache read");
    expect(text).toContain("Reasoning");
    expect(text).toContain("1,000");
    expect(text).toContain("9,000");
    expect(text).not.toMatch(/\b11,?750\b/);
    result.unmount();
  });

  test("says so plainly when the window is empty", async () => {
    setSessionStats(async () => emptyStats());
    const result = await render();
    await result.flush();

    expect(result.text()).toContain("No usage recorded for this project");
    // An empty window is not an error, and it is not a zeroed dashboard either.
    expect(result.text()).not.toContain("Project: ");
    result.unmount();
  });

  test("surfaces a failure instead of showing zeroes", async () => {
    setSessionStats(async () => {
      throw new Error("project not found");
    });
    const result = await render();
    await result.flush();

    expect(result.text()).toContain("project not found");
    // Crucially, no figures: a failed query must not look like an idle one.
    expect(result.text()).not.toContain("Project: ");
    result.unmount();
  });

  test("a range tap re-requests with that range's bounds", async () => {
    const result = await render();
    await result.flush();
    const first = apiStub().sessionStats.calls[0] as StatsRequest;

    await result.pressText("30d");
    await result.flush();

    expect(apiStub().sessionStats.calls).toHaveLength(2);
    const second = apiStub().sessionStats.calls[1] as StatsRequest;
    expect(second.project).toBe("prj_test");
    // A wider window reaches further back. The upper bound is `now`, so it moves
    // with the clock between the two calls — comparing it for equality would be
    // asserting that time stood still.
    expect(second.from).toBeLessThan(first.from);
    expect(second.to).toBeGreaterThanOrEqual(first.to);
    result.unmount();
  });

  test("shows activity rows and model shares when present", async () => {
    const result = await render();
    await result.flush();

    const text = result.text();
    expect(text).toContain("Activity");
    expect(text).toContain("2026-09-02");
    expect(text).toContain("By model");
    // Labelled by provider, which is what distinguishes one row from another when
    // two projects use the same model id under different accounts.
    expect(text).toContain("anthropic");
    result.unmount();
  });

  test("offers every range", async () => {
    const result = await render();
    await result.flush();

    const text = result.text();
    for (const range of ["7d", "30d", "90d", "all"]) {
      expect(text).toContain(range);
    }
    result.unmount();
  });

  test("pull to refresh re-requests", async () => {
    const result = await render();
    await result.flush();
    expect(apiStub().sessionStats.calls).toHaveLength(1);

    // The refresh control is handed to the scroll view as an *element prop*, so it
    // is never mounted and never becomes a host node. It has to be reached through
    // the prop, which is how `ScrollView` itself consumes it.
    const scroll = result.find("ScrollView");
    const refresh = scroll.props.refreshControl as {
      props: { onRefresh?: () => void };
    };
    expect(typeof refresh.props.onRefresh).toBe("function");

    await act(async () => {
      refresh.props.onRefresh!();
    });
    await result.flush();

    expect(apiStub().sessionStats.calls).toHaveLength(2);
    result.unmount();
  });

  test("back goes back", async () => {
    let wentBack = false;
    const result = await renderWithProviders(
      <StatsScreen
        navigation={{ goBack: () => (wentBack = true) } as never}
        route={{} as never}
      />,
    );
    await result.flush();

    // Icon-only control: the chevron has no text, so it is addressed by the label it
    // gives a screen reader.
    await result.pressAccessibility("Back");
    expect(wentBack).toBe(true);
    result.unmount();
  });
});
