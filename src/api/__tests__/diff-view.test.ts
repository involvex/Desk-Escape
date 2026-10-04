import { describe, expect, test } from "bun:test";

import {
  countHunkLines,
  countTotals,
  describeSection,
  filterSections,
  toDiffSections,
  toggleCollapsed,
  withUntracked,
} from "@/api/diff-view";
import type { VcsFileStatus } from "@opencode/client";

import type { DiffHunk, FileDiffEntry } from "@/types/opencode";

function hunk(header: string, ...lines: DiffHunk["lines"]): DiffHunk {
  return { header, lines };
}

function file(path: string, ...hunks: DiffHunk[]): FileDiffEntry {
  return { path, hunks };
}

/**
 * The one element of a single-element list.
 *
 * `noUncheckedIndexedAccess` makes `const [x] = list` type `T | undefined`, and
 * the alternative -- a non-null assertion -- would silence a genuinely empty
 * list too. Throwing names the failure instead.
 */
function only<T>(items: readonly T[]): T {
  if (items.length !== 1) {
    throw new Error(`expected exactly one item, got ${items.length}`);
  }
  return items[0] as T;
}

const SAMPLE = file(
  "src/a.ts",
  hunk(
    "@@ -1,2 +1,3 @@",
    { type: "context", content: "one" },
    { type: "add", content: "two" },
  ),
  hunk("@@ -10 +11 @@", { type: "remove", content: "old" }),
);

describe("countHunkLines", () => {
  test("counts adds and removes, ignoring context", () => {
    // Context lines are the bulk of a patch and are not a change in either
    // direction, so counting them would report a diff that changed nothing.
    expect(
      countHunkLines([
        hunk(
          "@@ @@",
          { type: "add", content: "a" },
          { type: "add", content: "b" },
          { type: "remove", content: "c" },
          { type: "context", content: "d" },
          { type: "context", content: "e" },
        ),
      ]),
    ).toEqual({ additions: 2, deletions: 1 });
  });

  test("a file with no hunks counts zero rather than being absent", () => {
    expect(countHunkLines([])).toEqual({ additions: 0, deletions: 0 });
  });

  test("sums across every hunk in the file", () => {
    expect(countHunkLines(SAMPLE.hunks)).toEqual({
      additions: 1,
      deletions: 1,
    });
  });
});

describe("toDiffSections", () => {
  test("flattens hunks and lines into one keyed row list", () => {
    const section = only(toDiffSections([SAMPLE]));

    expect(section.rows.map((r) => r.kind)).toEqual([
      "hunk",
      "line",
      "line",
      "hunk",
      "line",
    ]);
    expect(section.counts).toEqual({ additions: 1, deletions: 1 });
  });

  test("keys rows by index, so two identical hunk headers stay distinct", () => {
    // Two hunks can carry the same header after a rename or mode change. Keying
    // on the header alone would give React two children the same key, and React
    // drops one silently -- the patch would render short with nothing logged.
    const section = only(
      toDiffSections([
        file(
          "x",
          hunk("@@ @@", { type: "add", content: "1" }),
          hunk("@@ @@", { type: "add", content: "2" }),
        ),
      ]),
    );

    const keys = section.rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("marks a file untracked only when its path is in the set", () => {
    const sections = toDiffSections(
      [
        file("tracked.ts", hunk("@@ @@", { type: "add", content: "a" })),
        file("new.ts"),
      ],
      { untrackedPaths: new Set(["new.ts"]) },
    );

    expect(sections[0]?.untracked).toBe(false);
    expect(sections[1]?.untracked).toBe(true);
  });

  test("an empty diff produces no sections", () => {
    expect(toDiffSections([])).toEqual([]);
  });
});

describe("countTotals", () => {
  test("sums the sections, so the header matches the visible rows", () => {
    const sections = toDiffSections([
      SAMPLE,
      file(
        "src/b.ts",
        hunk(
          "@@ @@",
          { type: "add", content: "x" },
          { type: "add", content: "y" },
        ),
      ),
    ]);

    expect(countTotals(sections)).toEqual({ additions: 3, deletions: 1 });
  });

  test("an untracked file contributes nothing, because it shows no numbers", () => {
    // The header total is the sum of what a reader can see on each row. If an
    // untracked file contributed its line count, the panel would claim a
    // measurement it never made.
    const sections = toDiffSections([file("new.ts")], {
      untrackedPaths: new Set(["new.ts"]),
    });
    expect(countTotals(sections)).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("withUntracked", () => {
  const listed = ["src/a.ts", "src/new.ts", "src/other.ts"];
  const MODIFIED: VcsFileStatus = {
    file: "src/a.ts",
    additions: 1,
    deletions: 0,
    status: "modified",
  };

  test("adds a file git has never seen", () => {
    // The point of the whole exercise: a brand new file has no `vcs.diff` entry
    // at all, so without this it is simply absent from the panel.
    const { files } = withUntracked([SAMPLE], listed, [MODIFIED]);

    expect(files.map((f) => f.path)).toEqual([
      "src/a.ts",
      "src/new.ts",
      "src/other.ts",
    ]);
  });

  test("gives every added file no hunks, since no patch exists for one", () => {
    // With no status set, all three listed paths are untracked -- including
    // `src/a.ts`, which is also in the diff. The tracked entry keeps its hunks and
    // the reconstructed one has none, because git has no diff for a file it has
    // never seen.
    const { files } = withUntracked([SAMPLE], listed, []);
    const added = files.filter((f) => f.path !== "src/a.ts");

    expect(added.map((f) => f.path)).toEqual(["src/new.ts", "src/other.ts"]);
    for (const file of added) {
      expect(file.hunks).toEqual([]);
    }
    expect(files[0]?.hunks).toHaveLength(2);
  });

  test("reports which paths it reconstructed", () => {
    // Not inferable from the entries: an untracked file and a mode-only change on
    // a tracked file both arrive as "no hunks". A caller that had to guess would
    // call the second one new.
    const { untrackedPaths } = withUntracked([SAMPLE], listed, [MODIFIED]);

    expect([...untrackedPaths].sort()).toEqual(["src/new.ts", "src/other.ts"]);
    expect(untrackedPaths.has("src/a.ts")).toBe(false);
  });

  test("does not duplicate a file the diff already reports", () => {
    // The realistic case is an *empty* status set: `vcs.diff` reports a modified
    // file, the listing also contains it, and nothing marks it as known. The
    // reconstruction then "finds" it again, and without the dedupe filter it
    // appears twice — two headers and two bodies for one file, the second looking
    // like a second edit.
    const { files, untrackedPaths } = withUntracked([SAMPLE], listed, []);

    expect(files.filter((f) => f.path === "src/a.ts")).toHaveLength(1);
    expect(untrackedPaths.has("src/a.ts")).toBe(false);
  });

  test("does not re-add a file the status set already covers", () => {
    const { files, untrackedPaths } = withUntracked([SAMPLE], listed, [
      MODIFIED,
    ]);

    expect(files.filter((f) => f.path === "src/a.ts")).toHaveLength(1);
    expect(untrackedPaths.has("src/a.ts")).toBe(false);
  });

  test("returns a copy rather than the input array", () => {
    const input = [SAMPLE];
    const { files, untrackedPaths } = withUntracked(input, [], []);

    expect(files).not.toBe(input);
    expect(files).toEqual(input);
    expect(untrackedPaths.size).toBe(0);
  });

  test("matches paths case- and separator-insensitively, as the adapter normalises them", () => {
    // `indexFileStatuses` normalises before keying. If the listed paths were not
    // compared the same way, every file would look untracked.
    const { files } = withUntracked(
      [],
      ["src\\deep\\new.ts"],
      [
        {
          file: "src/deep/known.ts",
          additions: 0,
          deletions: 0,
          status: "modified",
        },
      ],
    );

    expect(files.map((f) => f.path)).toEqual(["src\\deep\\new.ts"]);
  });
});

describe("filterSections", () => {
  const sections = toDiffSections([
    file("src/a.ts"),
    file("docs/b.md"),
    file("src/deep/c.ts"),
    // Deliberately mixed case. Every other path here is already lowercase, so a
    // filter that forgot to fold case would still match them and the test would
    // pass for the wrong reason.
    file("src/screens/AuthPanel.tsx"),
  ]);

  test("keeps matches by substring, case-insensitively", () => {
    expect(filterSections(sections, "SRC/").map((s) => s.path)).toEqual([
      "src/a.ts",
      "src/deep/c.ts",
      "src/screens/AuthPanel.tsx",
    ]);
  });

  test("finds a mixed-case path from a lowercase query", () => {
    expect(filterSections(sections, "authpanel").map((s) => s.path)).toEqual([
      "src/screens/AuthPanel.tsx",
    ]);
  });

  test("finds a lowercase path from a mixed-case query", () => {
    expect(filterSections(sections, "A.TS").map((s) => s.path)).toEqual([
      "src/a.ts",
    ]);
  });

  test("an empty query keeps everything", () => {
    // Clearing the box must not make the panel read as "no changes".
    expect(filterSections(sections, "")).toHaveLength(4);
    expect(filterSections(sections, "   ")).toHaveLength(4);
  });

  test("a query matching nothing yields nothing, not everything", () => {
    expect(filterSections(sections, "zzz")).toEqual([]);
  });

  test("trims the query, so a stray space is not a search term", () => {
    expect(filterSections(sections, "  b.md  ")).toHaveLength(1);
  });
});

describe("toggleCollapsed", () => {
  test("adds then removes a path", () => {
    const once = toggleCollapsed(new Set(), "a.ts");
    expect(once.has("a.ts")).toBe(true);
    expect(toggleCollapsed(once, "a.ts").has("a.ts")).toBe(false);
  });

  test("does not mutate the set it was given", () => {
    // Mutating in place would change the previous render's state too, so React
    // would see no change and the header would not update.
    const before = new Set(["a.ts"]);
    toggleCollapsed(before, "b.ts");
    expect(before.has("b.ts")).toBe(false);
  });

  test("leaves other files' state alone", () => {
    const before = new Set(["a.ts"]);
    const after = toggleCollapsed(before, "b.ts");
    expect(after.has("a.ts")).toBe(true);
  });
});

describe("describeSection", () => {
  test("says new file for an untracked file rather than claiming +0", () => {
    const section = only(
      toDiffSections([file("new.ts")], {
        untrackedPaths: new Set(["new.ts"]),
      }),
    );
    expect(describeSection(section)).toBe("new file");
  });

  test("reports both counts when a file changed", () => {
    const section = only(toDiffSections([SAMPLE]));
    expect(describeSection(section)).toBe("+1 −1");
  });

  test("says so when a file has a diff entry but no changed lines", () => {
    // A mode-only change lands here. "+0 −0" would read as a rendering bug.
    const section = only(toDiffSections([file("bin.png", hunk("@@ @@"))]));
    expect(describeSection(section)).toBe("no line changes");
  });
});
