import type { SessionStatsInfo, TokenUsageInfo } from "@opencode/client";

/**
 * Presentation for `session.stats` — the token & cost dashboard.
 *
 * ## Scoping is by project, not directory
 *
 * `SessionStatsInput` takes `project` and has no `location` field at all. This is
 * the same rule `location.ts` documents for the session endpoints: a session's
 * scope is fixed at creation, and stats are reported per project. Passing a
 * directory would be a schema error rather than a silently-ignored field.
 *
 * The consequence is that a dashboard has to say *which* project's numbers it is
 * showing. {@link StatsScope} models that explicitly so the UI can refuse to
 * render an unattributed total rather than quietly mixing in every project the
 * server knows about — a usage figure that silently aggregates is worse than no
 * figure at all.
 *
 * ## No invented token totals
 *
 * `TokenUsageInfo` splits input / output / reasoning / cache.read / cache.write,
 * and those are not interchangeable units: cache reads are billed at a steep
 * discount and providers disagree about whether `input` already includes them.
 * Summing them into one "total tokens" would invent a number that means nothing
 * and would overstate usage by an order of magnitude on a cache-heavy session.
 * So no total is computed. Each figure is displayed as the server reported it.
 *
 * Kept pure so the formatting and share arithmetic is testable without React
 * Native or a server.
 */

/** Which project's usage a set of stats belongs to. */
export type StatsScope =
  | { kind: "project"; id: string; label: string }
  /** Project id not yet resolved. Stats must not be rendered in this state. */
  | { kind: "unknown" };

/** Which window the numbers cover. */
export type StatsRange = "7d" | "30d" | "90d" | "all";

export const STATS_RANGES: readonly StatsRange[] = ["7d", "30d", "90d", "all"];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a range to epoch milliseconds.
 *
 * `all` returns no bounds at all rather than `from: 0`: the server treats an
 * explicit epoch as a real filter, and `0` is a value it has to interpret rather
 * than ignore. Omitting the field is how "no bound" is spelled.
 *
 * `to` is `now` rather than the end of the current day, so the window does not
 * depend on what time it happens to be when the dashboard is opened.
 */
export function statsRangeBounds(
  range: StatsRange,
  now: number = Date.now(),
): { from?: number; to?: number } {
  switch (range) {
    case "7d":
      return { from: now - 7 * DAY_MS, to: now };
    case "30d":
      return { from: now - 30 * DAY_MS, to: now };
    case "90d":
      return { from: now - 90 * DAY_MS, to: now };
    case "all":
      return {};
  }
}

/**
 * Compact a token count for display.
 *
 * Abbreviates at 10,000 rather than 1,000: below that the exact figure is short
 * enough to read at a glance, and `9,847` is more use than `9.8K` when the
 * number is the point.
 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const n = Math.round(value);
  if (n < 0) return "—";
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1_000_000) return `${trim(n / 1_000)}K`;
  if (n < 1_000_000_000) return `${trim(n / 1_000_000)}M`;
  return `${trim(n / 1_000_000_000)}B`;
}

function trim(value: number): string {
  // One decimal below 100, none above: `12.3K` and `45.6M` keep their precision,
  // `456K` does not need it. Crossing over at 10 instead throws away real
  // information (`12.3K` becomes `12K`) for no readability gain.
  const rounded =
    value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded);
}

/**
 * Format a USD amount.
 *
 * Sub-cent amounts keep more precision than cents because usage on a small
 * project routinely lands there, and rounding it to `$0.00` reports "nothing
 * happened" when something did.
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  if (usd < 0) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) {
    // Six significant figures is enough to distinguish a cent from a tenth of
    // one without implying the precision is real.
    return `$${usd.toPrecision(2)}`;
  }
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A model's share of spend, with the parts the dashboard renders. */
export interface ModelShare {
  /** Stable identity for list keys. */
  key: string;
  label: string;
  steps: number;
  cost: number;
  /** 0–100, summing to 100 across the returned list. */
  percent: number;
}

/** `"provider/model"`, or whichever half exists. */
export function modelLabel(model: {
  providerID?: string;
  id?: string;
}): string {
  const provider = model.providerID?.trim();
  const id = model.id?.trim();
  if (provider && id) return `${provider}/${id}`;
  return id || provider || "unknown model";
}

/**
 * Rank models by spend and give each an exact percentage share.
 *
 * Largest-remainder rounding, so the percentages sum to exactly 100 instead of
 * 99 or 101 — a breakdown that visibly does not add up reads as a bug even when
 * the numbers are right.
 *
 * Returns an empty list when total cost is zero: percentages of nothing are
 * undefined, and showing a table of `0%` rows would imply a ranking the data
 * cannot support.
 */
export function modelShares(stats: SessionStatsInfo): ModelShare[] {
  const models = stats.models ?? [];
  if (models.length === 0) return [];

  const rows = models.map((entry) => ({
    key: `${entry.model.providerID}/${entry.model.id}`,
    label: modelLabel(entry.model),
    steps: entry.steps ?? 0,
    cost: entry.cost ?? 0,
  }));

  const total = rows.reduce((sum, row) => sum + Math.max(0, row.cost), 0);
  if (total <= 0) {
    return [];
  }

  const exact = rows.map((row) => ({
    row,
    share: (Math.max(0, row.cost) / total) * 100,
  }));

  // Largest remainder: floor everything, then hand the leftover units to the
  // rows with the biggest fractional parts.
  const floored = exact.map((entry) => ({
    ...entry,
    percent: Math.floor(entry.share),
  }));
  let leftover = 100 - floored.reduce((sum, entry) => sum + entry.percent, 0);

  const byRemainder = [...exact]
    .map((entry) => ({
      key: entry.row.key,
      remainder: entry.share - Math.floor(entry.share),
    }))
    .sort((a, b) => b.remainder - a.remainder);

  const bump = new Map<string, number>();
  for (const entry of byRemainder) {
    if (leftover <= 0) break;
    bump.set(entry.key, (bump.get(entry.key) ?? 0) + 1);
    leftover -= 1;
  }

  return floored
    .map((entry) => ({
      ...entry.row,
      percent: entry.percent + (bump.get(entry.row.key) ?? 0),
    }))
    .sort((a, b) => b.cost - a.cost || (a.key < b.key ? -1 : 1));
}

/** One bar of the activity sparkline. */
export interface ActivityBar {
  /** `YYYY-MM-DD` as reported by the server. */
  date: string;
  steps: number;
  /** 0–1, relative to the busiest day in the window. */
  intensity: number;
}

/**
 * Normalize daily steps into sparkline bars, oldest first.
 *
 * Days the server omitted are *not* interpolated: an omitted day is unknown, and
 * drawing it as zero would put a dip in the chart that never happened. The
 * caller renders what it is given, so gaps read as gaps.
 *
 * The busiest day is always full scale, so a window with activity never renders
 * flat. A window with no activity at all yields zero-height bars rather than a
 * division by zero.
 */
export function activityBars(stats: SessionStatsInfo): ActivityBar[] {
  const activity = stats.activity ?? [];
  if (activity.length === 0) return [];

  const steps = activity.map((entry) => Math.max(0, entry.steps ?? 0));
  const peak = Math.max(...steps);

  return activity
    .map((entry, index) => ({
      date: entry.date,
      steps: steps[index] ?? 0,
      intensity: peak <= 0 ? 0 : (steps[index] ?? 0) / peak,
    }))
    .reverse();
}

/**
 * The four token figures, in display order.
 *
 * Returned as a list rather than a sum on purpose — see the module comment.
 */
export function tokenBreakdown(tokens: TokenUsageInfo): {
  key: string;
  label: string;
  value: number;
  display: string;
}[] {
  const rows: { key: string; label: string; value: number }[] = [
    { key: "input", label: "Input", value: tokens.input ?? 0 },
    { key: "output", label: "Output", value: tokens.output ?? 0 },
    { key: "reasoning", label: "Reasoning", value: tokens.reasoning ?? 0 },
    { key: "cacheRead", label: "Cache read", value: tokens.cache?.read ?? 0 },
    {
      key: "cacheWrite",
      label: "Cache write",
      value: tokens.cache?.write ?? 0,
    },
  ];

  return rows.map((row) => ({
    ...row,
    display: formatTokenCount(row.value),
  }));
}

/** One headline number, with a label chosen from the server's own vocabulary. */
export interface StatTile {
  key: string;
  label: string;
  value: string;
}

/** The headline row: sessions, prompts, steps, cost. */
export function statTiles(stats: SessionStatsInfo): StatTile[] {
  return [
    { key: "sessions", label: "Sessions", value: String(stats.sessions ?? 0) },
    { key: "prompts", label: "Prompts", value: String(stats.prompts ?? 0) },
    { key: "steps", label: "Steps", value: String(stats.steps ?? 0) },
    {
      key: "cost",
      label: "Cost",
      value: formatCost(stats.cost ?? 0),
    },
  ];
}

/** Whether a window contains anything at all worth rendering. */
export function isEmptyStats(stats: SessionStatsInfo): boolean {
  return (stats.sessions ?? 0) === 0 && (stats.steps ?? 0) === 0;
}
