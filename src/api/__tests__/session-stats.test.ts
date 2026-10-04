import { describe, expect, test } from "bun:test";
import type { SessionStatsInfo } from "@opencode/client";

import {
  activityBars,
  formatCost,
  formatTokenCount,
  isEmptyStats,
  modelLabel,
  modelShares,
  statTiles,
  statsRangeBounds,
  tokenBreakdown,
} from "@/api/session-stats";

/**
 * Tests for the stats presentation layer.
 *
 * Two mistakes here would be invisible in review and wrong on screen: a token
 * "total" that quietly double-counts cache reads, and percentage shares that do
 * not add up to 100. Both are asserted directly.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function stats(overrides: Partial<SessionStatsInfo> = {}): SessionStatsInfo {
  return {
    range: { from: 0, to: NOW },
    sessions: 0,
    subagents: 0,
    prompts: 0,
    steps: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
    tools: { mode: "none" },
    activeDays: 0,
    streak: 0,
    activity: [],
    models: [],
    ...overrides,
  } as SessionStatsInfo;
}

// ---------------------------------------------------------------------------
// statsRangeBounds
// ---------------------------------------------------------------------------

describe("statsRangeBounds", () => {
  test("spans the requested number of days up to now", () => {
    expect(statsRangeBounds("7d", NOW)).toEqual({
      from: NOW - 7 * DAY,
      to: NOW,
    });
    expect(statsRangeBounds("30d", NOW)).toEqual({
      from: NOW - 30 * DAY,
      to: NOW,
    });
    expect(statsRangeBounds("90d", NOW)).toEqual({
      from: NOW - 90 * DAY,
      to: NOW,
    });
  });

  test("all sends no bounds rather than an epoch", () => {
    // The server reads an explicit 0 as a real filter. Omitting the field is how
    // "no bound" is spelled.
    expect(statsRangeBounds("all", NOW)).toEqual({});
  });

  test("ends at now rather than the end of the day", () => {
    // Otherwise the same range would cover a different amount depending on what
    // time the dashboard happened to be opened.
    const bounds = statsRangeBounds("7d", NOW);
    expect(bounds.to).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// formatTokenCount
// ---------------------------------------------------------------------------

describe("formatTokenCount", () => {
  test("shows small counts exactly", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(847)).toBe("847");
    expect(formatTokenCount(9_847)).toBe("9,847");
  });

  test("abbreviates only above the exact-figure threshold", () => {
    // Below 10,000 the exact number is short enough to read, and `9.8K` is less
    // use than `9,847`.
    expect(formatTokenCount(9_999)).toBe("9,999");
    expect(formatTokenCount(10_000)).toBe("10K");
    expect(formatTokenCount(12_300)).toBe("12.3K");
  });

  test("abbreviates millions and billions", () => {
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
    expect(formatTokenCount(45_600_000)).toBe("45.6M");
    expect(formatTokenCount(2_400_000_000)).toBe("2.4B");
  });

  test("rounds to whole units above ten", () => {
    expect(formatTokenCount(456_000)).toBe("456K");
    expect(formatTokenCount(456_000_000)).toBe("456M");
  });

  test("refuses nonsense rather than rendering it", () => {
    expect(formatTokenCount(Number.NaN)).toBe("—");
    expect(formatTokenCount(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatTokenCount(-5)).toBe("—");
  });

  test("rounds fractional counts", () => {
    expect(formatTokenCount(1234.6)).toBe("1,235");
  });
});

// ---------------------------------------------------------------------------
// formatCost
// ---------------------------------------------------------------------------

describe("formatCost", () => {
  test("shows cents for ordinary amounts", () => {
    expect(formatCost(0.42)).toBe("$0.42");
    expect(formatCost(12.3)).toBe("$12.30");
    expect(formatCost(1)).toBe("$1.00");
  });

  test("keeps precision below a cent", () => {
    // Rounding a small project's usage to "$0.00" reports that nothing happened
    // when something did.
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(0.000_042)).toBe("$0.000042");
  });

  test("distinguishes an exact zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  test("groups thousands", () => {
    expect(formatCost(1234.5)).toBe("$1,234.50");
    expect(formatCost(1_234_567)).toBe("$1,234,567.00");
  });

  test("refuses nonsense rather than rendering it", () => {
    expect(formatCost(Number.NaN)).toBe("—");
    expect(formatCost(-1)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// modelLabel
// ---------------------------------------------------------------------------

describe("modelLabel", () => {
  test("joins provider and id", () => {
    expect(modelLabel({ providerID: "anthropic", id: "claude-opus-5" })).toBe(
      "anthropic/claude-opus-5",
    );
  });

  test("uses whichever half exists", () => {
    expect(modelLabel({ id: "gpt-5" })).toBe("gpt-5");
    expect(modelLabel({ providerID: "openai" })).toBe("openai");
  });

  test("names an entirely empty reference", () => {
    expect(modelLabel({})).toBe("unknown model");
  });
});

// ---------------------------------------------------------------------------
// modelShares
// ---------------------------------------------------------------------------

describe("modelShares", () => {
  const model = (providerID: string, id: string, cost: number, steps = 1) => ({
    model: { providerID, id },
    steps,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost,
  });

  test("ranks by spend", () => {
    const shares = modelShares(
      stats({
        models: [model("a", "small", 1), model("a", "big", 9)],
      } as never),
    );
    expect(shares.map((s) => s.label)).toEqual(["a/big", "a/small"]);
  });

  test("shares sum to exactly 100", () => {
    // A breakdown that visibly does not add up reads as a bug even when every
    // individual figure is right.
    const shares = modelShares(
      stats({
        models: [
          model("a", "one", 1),
          model("a", "two", 1),
          model("a", "three", 1),
        ],
      } as never),
    );
    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
    expect(shares.map((s) => s.percent)).toEqual([34, 33, 33]);
  });

  test("sums to 100 for an awkward split", () => {
    // 1/7ths does not divide evenly, which is where naive rounding shows.
    const shares = modelShares(
      stats({
        models: Array.from({ length: 7 }, (_, i) => model("a", `m${i}`, 1)),
      } as never),
    );
    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
  });

  test("sums to 100 with a single model", () => {
    const shares = modelShares(
      stats({ models: [model("a", "only", 42)] } as never),
    );
    expect(shares[0]!.percent).toBe(100);
  });

  test("sums to 100 when shares end in a half", () => {
    // 5:3 of 8 is 62.5/37.5. Rounding each instead of flooring overshoots to 101
    // and there is no leftover to correct it, because the total already exceeds
    // 100. Equal-value splits never expose this, so it is pinned explicitly.
    const shares = modelShares(
      stats({
        models: [model("a", "five", 5), model("a", "three", 3)],
      } as never),
    );
    expect(shares.map((s) => s.percent)).toEqual([63, 37]);
    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
  });

  test("sums to 100 for three models with half shares", () => {
    const shares = modelShares(
      stats({
        models: [
          model("a", "five", 5),
          model("a", "two", 2),
          model("a", "one", 1),
        ],
      } as never),
    );
    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
  });

  test("is empty rather than a table of zero-percent rows", () => {
    // Percentages of nothing are undefined; a ranking implies an ordering the
    // data cannot support.
    expect(
      modelShares(stats({ models: [model("a", "free", 0)] } as never)),
    ).toEqual([]);
  });

  test("is empty for no models at all", () => {
    expect(modelShares(stats())).toEqual([]);
  });

  test("keeps a free model in the list at zero percent", () => {
    // Hiding it would hide the fact that it was used at all, and the point of the
    // breakdown is to show where spend went *and* what did not.
    const shares = modelShares(
      stats({
        models: [model("a", "free", 0), model("a", "paid", 5)],
      } as never),
    );
    expect(shares).toHaveLength(2);
    expect(shares.map((s) => s.percent)).toEqual([100, 0]);
    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
  });

  test("clamps a negative cost to zero rather than skewing shares", () => {
    const shares = modelShares(
      stats({
        models: [model("a", "bad", -10), model("a", "good", 5)],
      } as never),
    );
    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
    expect(shares[0]!.percent).toBe(100);
  });

  test("orders equal-cost models deterministically", () => {
    const shares = modelShares(
      stats({
        models: [model("a", "zebra", 5), model("a", "alpha", 5)],
      } as never),
    );
    // Without a tiebreak the list reshuffles on every refetch.
    expect(shares.map((s) => s.label)).toEqual(["a/alpha", "a/zebra"]);
  });
});

// ---------------------------------------------------------------------------
// activityBars
// ---------------------------------------------------------------------------

describe("activityBars", () => {
  const day = (date: string, steps: number) => ({ date, steps });

  test("is oldest first", () => {
    const bars = activityBars(
      stats({
        activity: [day("2026-10-02", 5), day("2026-10-01", 9)],
      } as never),
    );
    expect(bars.map((b) => b.date)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  test("scales the busiest day to full", () => {
    // A window with activity must never render flat. Bars are oldest-first, so
    // the later, busier day is last.
    const bars = activityBars(
      stats({
        activity: [day("2026-10-01", 10), day("2026-10-02", 20)],
      } as never),
    );
    expect(bars[1]!.intensity).toBe(0.5);
    expect(bars[0]!.intensity).toBe(1);
  });

  test("is all zeroes rather than NaN for an empty window", () => {
    const bars = activityBars(
      stats({
        activity: [day("2026-10-01", 0), day("2026-10-02", 0)],
      } as never),
    );
    expect(bars.map((b) => b.intensity)).toEqual([0, 0]);
    expect(bars.every((b) => Number.isFinite(b.intensity))).toBe(true);
  });

  test("is empty for no activity", () => {
    expect(activityBars(stats())).toEqual([]);
  });

  test("does not invent days the server omitted", () => {
    // An omitted day is unknown. Drawing it as zero would put a dip in the chart
    // that never happened.
    const bars = activityBars(
      stats({
        activity: [day("2026-10-01", 5), day("2026-10-03", 5)],
      } as never),
    );
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.date)).not.toContain("2026-10-02");
  });

  test("clamps negative steps", () => {
    const bars = activityBars(
      stats({
        activity: [day("2026-10-01", -3), day("2026-10-02", 4)],
      } as never),
    );
    // Negative steps are a data problem; clamped to zero rather than rendered as
    // a bar below the baseline.
    expect(bars[1]!.intensity).toBe(0);
    expect(bars[0]!.intensity).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// tokenBreakdown
// ---------------------------------------------------------------------------

describe("tokenBreakdown", () => {
  test("lists each figure the server reported, without inventing a total", () => {
    const rows = tokenBreakdown({
      input: 1_000,
      output: 500,
      reasoning: 250,
      cache: { read: 90_000, write: 2_000 },
    });
    expect(rows.map((r) => r.key)).toEqual([
      "input",
      "output",
      "reasoning",
      "cacheRead",
      "cacheWrite",
    ]);
    // 93,750 total would be dominated by a cache read billed at a fraction of
    // the price, so there is deliberately no total row.
    expect(rows.some((r) => /total/i.test(r.label))).toBe(false);
  });

  test("formats each figure", () => {
    const rows = tokenBreakdown({
      input: 1_000,
      output: 500,
      reasoning: 250,
      cache: { read: 90_000, write: 2_000 },
    });
    expect(rows.map((r) => r.display)).toEqual([
      "1,000",
      "500",
      "250",
      "90K",
      "2,000",
    ]);
  });

  test("tolerates a missing cache object", () => {
    const rows = tokenBreakdown({
      input: 1,
      output: 2,
    } as never);
    const cacheRead = rows.find((r) => r.key === "cacheRead")!;
    expect(cacheRead.value).toBe(0);
    expect(cacheRead.display).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// statTiles / isEmptyStats
// ---------------------------------------------------------------------------

describe("statTiles", () => {
  test("renders the headline numbers", () => {
    const tiles = statTiles(
      stats({ sessions: 4, prompts: 12, steps: 87, cost: 3.5 }),
    );
    expect(tiles.map((t) => t.key)).toEqual([
      "sessions",
      "prompts",
      "steps",
      "cost",
    ]);
    expect(tiles.find((t) => t.key === "cost")!.value).toBe("$3.50");
  });

  test("renders zeroes rather than blanks", () => {
    expect(statTiles(stats()).map((t) => t.value)).toEqual([
      "0",
      "0",
      "0",
      "$0.00",
    ]);
  });
});

describe("isEmptyStats", () => {
  test("is true only when there was no activity", () => {
    expect(isEmptyStats(stats())).toBe(true);
    expect(isEmptyStats(stats({ steps: 1 }))).toBe(false);
    expect(isEmptyStats(stats({ sessions: 1 }))).toBe(false);
  });

  test("does not treat prompts alone as activity", () => {
    // A session that was opened and abandoned has prompts but no steps.
    expect(isEmptyStats(stats({ prompts: 3 }))).toBe(true);
  });
});
