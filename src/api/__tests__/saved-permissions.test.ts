import { describe, expect, test } from "bun:test";

import type { PermissionSavedInfo } from "@/api/permissions";
import {
  describeGrant,
  formatGrantAge,
  isWildcardGrant,
  needsConfirmation,
  toGrantViews,
} from "@/api/saved-permissions";

/**
 * Tests for the persisted-grant list.
 *
 * The bug these guard is a permission the user granted durably and can never
 * take back. A grant that is invisible is not granted consent, it is a surprise
 * waiting to happen — so the paths that lose, mangle or hide a grant are the
 * ones worth pinning.
 */

function grant(
  id: string,
  overrides: Partial<PermissionSavedInfo> = {},
): PermissionSavedInfo {
  return {
    id,
    projectID: "proj_1",
    action: "bash",
    resource: "npm test",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
    ...overrides,
  } as PermissionSavedInfo;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// isWildcardGrant
// ---------------------------------------------------------------------------

describe("isWildcardGrant", () => {
  test("recognises the asterisk wildcard", () => {
    expect(isWildcardGrant("*")).toBe(true);
    expect(isWildcardGrant(" * ")).toBe(true);
  });

  test("treats an empty resource as a wildcard", () => {
    // An empty target grants nothing specific. Labelling it as a wildcard is the
    // honest reading; anything else understates how much the grant covers.
    expect(isWildcardGrant("")).toBe(true);
    expect(isWildcardGrant("   ")).toBe(true);
  });

  test("is false for a specific target", () => {
    expect(isWildcardGrant("npm test")).toBe(false);
    expect(isWildcardGrant("/src/**")).toBe(false);
    expect(isWildcardGrant("git push")).toBe(false);
  });

  test("does not treat a glob that merely contains a star as a wildcard", () => {
    // `/src/**` is a prefix pattern, far narrower than "any command", and must
    // not be reported as a blanket grant.
    expect(isWildcardGrant("/src/**")).toBe(false);
    expect(isWildcardGrant("npm run *")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toGrantViews
// ---------------------------------------------------------------------------

describe("toGrantViews", () => {
  test("maps every grant", () => {
    const views = toGrantViews([grant("a"), grant("b")]);
    expect(views).toHaveLength(2);
    expect(views.map((v) => v.id).sort()).toEqual(["a", "b"]);
  });

  test("handles an empty list", () => {
    expect(toGrantViews([])).toEqual([]);
  });

  test("orders most recently updated first", () => {
    const views = toGrantViews([
      grant("old", { time: { created: 0, updated: 1_000 } }),
      grant("new", { time: { created: 0, updated: 9_000 } }),
      grant("mid", { time: { created: 0, updated: 5_000 } }),
    ]);
    expect(views.map((v) => v.id)).toEqual(["new", "mid", "old"]);
  });

  test("puts undated grants last rather than dropping or promoting them", () => {
    // A missing timestamp is still a live grant. Sorting it to the top would
    // read as "just granted", which is a claim the data does not support.
    const views = toGrantViews([
      grant("undated", { time: undefined as never }),
      grant("dated", { time: { created: 0, updated: 5_000 } }),
    ]);
    expect(views.map((v) => v.id)).toEqual(["dated", "undated"]);
  });

  test("treats a nonsensical timestamp as unknown", () => {
    const views = toGrantViews([
      grant("negative", { time: { created: -5, updated: -5 } }),
      grant("nan", { time: { created: 0, updated: Number.NaN } }),
      grant("zero", { time: { created: 0, updated: 0 } }),
    ]);
    expect(views.every((v) => v.updatedAt === null)).toBe(true);
  });

  test("breaks ties on id so the order is stable across reloads", () => {
    // Same timestamps: without a tiebreak the list reshuffles on every fetch,
    // which looks like the app is editing it.
    const same = { created: 0, updated: 1_000 };
    const first = toGrantViews([
      grant("b", { time: same }),
      grant("a", { time: same }),
    ]);
    const second = toGrantViews([
      grant("a", { time: same }),
      grant("b", { time: same }),
    ]);
    expect(first.map((v) => v.id)).toEqual(["a", "b"]);
    expect(second.map((v) => v.id)).toEqual(["a", "b"]);
  });

  test("trims whitespace off the fields it displays", () => {
    const view = toGrantViews([
      grant("a", {
        action: " bash ",
        resource: " npm test ",
        projectID: " p ",
      }),
    ])[0]!;
    expect(view.action).toBe("bash");
    expect(view.resource).toBe("npm test");
    expect(view.project).toBe("p");
  });

  test("survives missing string fields instead of rendering undefined", () => {
    const view = toGrantViews([
      grant("a", { action: undefined as never, resource: undefined as never }),
    ])[0]!;
    expect(view.action).toBe("");
    expect(view.resource).toBe("");
    // And it is still listed, flagged as covering everything.
    expect(view.wildcard).toBe(true);
  });

  test("flags a wildcard grant", () => {
    const views = toGrantViews([grant("a", { resource: "*" })]);
    expect(views[0]!.wildcard).toBe(true);
  });

  test("does not mutate the input array", () => {
    const input = [grant("b"), grant("a")];
    const copy = [...input];
    toGrantViews(input);
    expect(input).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// describeGrant
// ---------------------------------------------------------------------------

describe("describeGrant", () => {
  test("names the action and the specific target", () => {
    const view = toGrantViews([grant("a")])[0]!;
    expect(describeGrant(view)).toBe("bash: npm test");
  });

  test("says in words when a grant covers the whole action", () => {
    // Rendering `bash: *` would hide the difference between "npm test" and
    // "every command the agent can think to run".
    const view = toGrantViews([grant("a", { resource: "*" })])[0]!;
    expect(describeGrant(view)).toBe("Any bash command");
  });

  test("falls back to a neutral action name when the server omits one", () => {
    const view = toGrantViews([grant("a", { action: "" })])[0]!;
    expect(describeGrant(view)).toBe("permission: npm test");
  });

  test("does not render the literal string undefined", () => {
    const view = toGrantViews([
      grant("a", { action: undefined as never, resource: undefined as never }),
    ])[0]!;
    expect(describeGrant(view)).toBe("Any permission command");
    expect(describeGrant(view)).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------------------
// formatGrantAge
// ---------------------------------------------------------------------------

describe("formatGrantAge", () => {
  const NOW = 1_700_000_000_000;

  test("says unknown when there is no timestamp", () => {
    // Better than implying the grant is new, which would push the user towards
    // keeping it.
    expect(formatGrantAge(null, NOW)).toBe("unknown");
  });

  test("collapses the last minute to just now", () => {
    expect(formatGrantAge(NOW, NOW)).toBe("just now");
    expect(formatGrantAge(NOW - 59_000, NOW)).toBe("just now");
  });

  test("reports minutes, hours and days", () => {
    expect(formatGrantAge(NOW - MINUTE, NOW)).toBe("1m ago");
    expect(formatGrantAge(NOW - 59 * MINUTE, NOW)).toBe("59m ago");
    expect(formatGrantAge(NOW - HOUR, NOW)).toBe("1h ago");
    expect(formatGrantAge(NOW - 23 * HOUR, NOW)).toBe("23h ago");
    expect(formatGrantAge(NOW - DAY, NOW)).toBe("1d ago");
    expect(formatGrantAge(NOW - 29 * DAY, NOW)).toBe("29d ago");
  });

  test("rolls over to months and years", () => {
    // Months are 30 days, so twelve of them is exactly the year boundary — the
    // label goes to years at 360 days, not at 365.
    expect(formatGrantAge(NOW - 30 * DAY, NOW)).toBe("1mo ago");
    expect(formatGrantAge(NOW - 359 * DAY, NOW)).toBe("11mo ago");
    expect(formatGrantAge(NOW - 360 * DAY, NOW)).toBe("1y ago");
    expect(formatGrantAge(NOW - 400 * DAY, NOW)).toBe("1y ago");
  });

  test("does not render a negative age for a future timestamp", () => {
    // Clock skew between device and server is common; "-3m ago" is nonsense.
    expect(formatGrantAge(NOW + 5 * MINUTE, NOW)).toBe("just now");
  });
});

// ---------------------------------------------------------------------------
// needsConfirmation
// ---------------------------------------------------------------------------

describe("needsConfirmation", () => {
  test("is required for a wildcard", () => {
    // Revoking a blanket grant re-prompts for everything it silently covered.
    expect(
      needsConfirmation(toGrantViews([grant("a", { resource: "*" })])[0]!),
    ).toBe(true);
  });

  test("is not required for a single specific target", () => {
    expect(needsConfirmation(toGrantViews([grant("a")])[0]!)).toBe(false);
  });
});
