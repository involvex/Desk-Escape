import { describe, expect, test } from "bun:test";

import {
  formatSessionDate,
  getSessionTimeAgo,
  groupSessionsByTime,
  rankSessionsWithPins,
} from "@/utils/session-ranking";
import type { Session } from "@/types/domain";

/**
 * Session ranking decides which sessions surface first in the picker, and the
 * time helpers render the labels the user reads to judge staleness.
 *
 * These pin the behaviours that are easy to regress and awkward to notice:
 * pinning guarantees, group boundaries, and the `time.updated` field the
 * ranking actually depends on.
 */

let seq = 0;
function session(overrides: Partial<Session> = {}): Session {
  seq += 1;
  return {
    id: `ses_${seq}`,
    title: `Session ${seq}`,
    time: { created: 0, updated: Date.now() },
    ...overrides,
  } as Session;
}

/**
 * Ranking reads `Date.now()` internally, so fixture timestamps must be
 * relative to the real clock. A hardcoded date would place every session
 * months in the past, where the recency term underflows to zero for all of
 * them and the sort falls back to input order.
 */
const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

describe("rankSessionsWithPins", () => {
  test("returns an empty list unchanged", () => {
    expect(rankSessionsWithPins([], [])).toEqual([]);
  });

  test("orders unpinned sessions by recency, newest first", () => {
    const older = session({ time: { created: 0, updated: NOW - 2 * HOUR } });
    const mid = session({ time: { created: 0, updated: NOW - 1 * HOUR } });
    const newest = session({ time: { created: 0, updated: NOW } });

    expect(
      rankSessionsWithPins([older, newest, mid], []).map((s) => s.id),
    ).toEqual([newest.id, mid.id, older.id]);
  });

  test("places a pinned session above every unpinned one", () => {
    const recent = session({ time: { created: 0, updated: NOW } });
    const stale = session({ time: { created: 0, updated: NOW - 30 * DAY } });

    const ranked = rankSessionsWithPins([recent, stale], [stale.id]);

    expect(ranked[0]?.id).toBe(stale.id);
  });

  test("preserves the user's pin order among pinned sessions", () => {
    // Pins are an explicit user ordering, so `pinnedIds` order wins over
    // recency - a deliberately re-pinned older session stays where it was put.
    const first = session({ time: { created: 0, updated: NOW - 5 * DAY } });
    const second = session({ time: { created: 0, updated: NOW - 1 * DAY } });
    const unpinned = session({ time: { created: 0, updated: NOW } });

    const ranked = rankSessionsWithPins(
      [second, unpinned, first],
      [first.id, second.id],
    );

    expect(ranked.map((s) => s.id)).toEqual([first.id, second.id, unpinned.id]);
  });

  test("floats every pinned session above the unpinned ones", () => {
    const stalePin = session({ time: { created: 0, updated: NOW - 20 * DAY } });
    const fresh = session({ time: { created: 0, updated: NOW - 1 * HOUR } });

    const ranked = rankSessionsWithPins([fresh, stalePin], [stalePin.id]);

    expect(ranked.map((s) => s.id)).toEqual([stalePin.id, fresh.id]);
  });

  test("ignores a pin that matches no session", () => {
    const only = session();

    expect(
      rankSessionsWithPins([only], ["ses_missing"]).map((s) => s.id),
    ).toEqual([only.id]);
  });

  test("does not mutate the input array", () => {
    const a = session({ time: { created: 0, updated: NOW - 10 * MINUTE } });
    const b = session({ time: { created: 0, updated: NOW } });
    const input = [a, b];

    rankSessionsWithPins(input, []);

    expect(input.map((s) => s.id)).toEqual([a.id, b.id]);
  });

  test("pins survive a session that ranks lowest without activity", () => {
    // `summary` is never populated by the adapter, so the activity component of
    // the score is always 0. Ranking therefore degrades to pure recency decay.
    // This test documents that pinning still overrides a stale session.
    const stale = session({ time: { created: 0, updated: NOW - 90 * DAY } });
    const fresh = session({ time: { created: 0, updated: NOW - 1 * HOUR } });

    const ranked = rankSessionsWithPins([fresh, stale], [stale.id]);

    expect(ranked[0]?.id).toBe(stale.id);
    expect(ranked).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe("groupSessionsByTime", () => {
  test("returns no groups for no sessions", () => {
    expect(groupSessionsByTime([])).toEqual([]);
  });

  test("returns groups in today/yesterday/this-week/older order", () => {
    // Buckets are cut at *local midnight*, not at fixed elapsed times, so a
    // fixture written as "30 hours ago" only lands in Yesterday when the suite
    // runs after 06:00 — between midnight and 06:00 it is two days back and the
    // test fails on a quarter of all days. Anchoring each fixture to the same
    // midnight edges the implementation uses puts one sample unambiguously in
    // each bucket at any hour.
    const todayStart = (() => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    })();

    const groups = groupSessionsByTime([
      { time: { created: 0, updated: todayStart - 8 * DAY } } as Session, // older
      { time: { created: 0, updated: todayStart - 2 * DAY } } as Session, // this-week
      { time: { created: 0, updated: todayStart - 1 } } as Session, // yesterday
      { time: { created: 0, updated: todayStart } } as Session, // today
    ]);

    expect(groups.map((g) => g.group)).toEqual([
      "today",
      "yesterday",
      "this-week",
      "older",
    ]);
  });

  test("omits empty groups", () => {
    const groups = groupSessionsByTime([
      { time: { created: 0, updated: Date.now() } } as Session,
    ]);

    expect(groups.map((g) => g.group)).toEqual(["today"]);
  });

  test("labels groups for display", () => {
    const groups = groupSessionsByTime([
      { time: { created: 0, updated: Date.now() } } as Session,
    ]);

    expect(groups[0]?.label).toBe("Today");
  });

  test("puts an older update in the today group", () => {
    // Anything since local midnight is "today", regardless of how old it is.
    const groups = groupSessionsByTime([
      { time: { created: 0, updated: Date.now() - 1 * HOUR } } as Session,
    ]);

    expect(groups[0]?.group).toBe("today");
  });
});

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

describe("getSessionTimeAgo", () => {
  test("recent activity reads as just now", () => {
    expect(getSessionTimeAgo(NOW, NOW)).toBe("just now");
  });

  test("sub-minute activity reads as just now", () => {
    expect(getSessionTimeAgo(NOW - 30 * 1000, NOW)).toBe("just now");
  });

  test("minutes", () => {
    expect(getSessionTimeAgo(NOW - 5 * MINUTE, NOW)).toBe("5m ago");
    expect(getSessionTimeAgo(NOW - 59 * MINUTE, NOW)).toBe("59m ago");
  });

  test("hours", () => {
    expect(getSessionTimeAgo(NOW - 1 * HOUR, NOW)).toBe("1h ago");
    expect(getSessionTimeAgo(NOW - 23 * HOUR, NOW)).toBe("23h ago");
  });

  test("a single day reads as yesterday", () => {
    expect(getSessionTimeAgo(NOW - 24 * HOUR, NOW)).toBe("yesterday");
  });

  test("days", () => {
    expect(getSessionTimeAgo(NOW - 2 * DAY, NOW)).toBe("2d ago");
    expect(getSessionTimeAgo(NOW - 6 * DAY, NOW)).toBe("6d ago");
  });

  test("weeks", () => {
    expect(getSessionTimeAgo(NOW - 7 * DAY, NOW)).toBe("1w ago");
    expect(getSessionTimeAgo(NOW - 21 * DAY, NOW)).toBe("3w ago");
  });
});

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

describe("formatSessionDate", () => {
  test("formats a timestamp as a short date", () => {
    const formatted = formatSessionDate(new Date(2026, 0, 15).getTime());

    expect(formatted).toContain("2026");
    expect(formatted).toContain("15");
  });
});
