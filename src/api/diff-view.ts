import {
  indexFileStatuses,
  markUntracked,
  type FileStatusIndex,
} from "@/api/opencode/adapter";
import type { VcsFileStatus } from "@opencode/client";

import type { DiffHunk, DiffLine, FileDiffEntry } from "@/types/opencode";

/**
 * Presentation for the diff panel, as a pure model.
 *
 * ## Why the panel was rewritten rather than patched
 *
 * `UnifiedDiff.tsx` rendered every file, hunk and line inside a single
 * `ScrollView`. That is not a style preference: React Native mounts every child,
 * so a working-tree diff over a few hundred changed lines produced tens of
 * thousands of native views and the panel hung on mid-range Android before it
 * finished its first frame. The fix is a virtualized list, but virtualizing
 * needs a flat, keyed row model rather than nested `map` calls -- which is what
 * this module builds.
 *
 * ## Untracked files are absent, not empty
 *
 * V2's `vcs.diff` reports only what git already tracks. A file git has never
 * seen has no diff entry at all, so "new file" is invisible in the panel -- the
 * one thing a reviewer most needs to see. `indexFileStatuses` and `markUntracked`
 * already existed in the adapter to reconstruct that set by subtracting the
 * status keys from the paths `file.list` reports; nothing called them. They are
 * wired up here, and the tests say why the reconstruction is necessary rather
 * than only that it runs.
 *
 * An untracked file carries no patch, so no line counts can be derived for it.
 * It is labelled "new file" and shows **no** numbers, because "+0" would be a
 * confident statement about a measurement nobody made.
 */

/** One renderable row: a hunk header, or a line inside a hunk. */
export type DiffRow =
  | { kind: "hunk"; key: string; header: string }
  | { kind: "line"; key: string; hunkHeader: string; line: DiffLine };

/** Additions and deletions in one file, counted from the parsed hunks. */
export interface DiffCounts {
  additions: number;
  deletions: number;
}

/** Everything the panel needs to render one file, already flattened. */
export interface DiffSection {
  /** Stable list key. The path, which the server guarantees unique per entry. */
  path: string;
  title: string;
  counts: DiffCounts;
  /** True when the file is reconstructed as untracked rather than diffed. */
  untracked: boolean;
  rows: DiffRow[];
}

/** Count additions and deletions across a file's hunks. */
export function countHunkLines(hunks: readonly DiffHunk[]): DiffCounts {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") additions += 1;
      else if (line.type === "remove") deletions += 1;
    }
  }
  return { additions, deletions };
}

/**
 * Count across a whole diff, for the panel's header.
 *
 * Untracked files contribute zero rather than their line count, matching what
 * each row shows: the number on the summary is the sum of the numbers a reader
 * can actually see.
 */
export function countTotals(sections: readonly DiffSection[]): DiffCounts {
  return sections.reduce<DiffCounts>(
    (total, section) => ({
      additions: total.additions + section.counts.additions,
      deletions: total.deletions + section.counts.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

/**
 * Flatten files into sections of keyed rows.
 *
 * The row keys combine the path, the hunk index and the line index rather than the
 * hunk header alone, because two hunks in one file can carry the same header
 * after a rename or a mode change -- and a duplicate key silently drops a row.
 *
 * `collapsed` is honoured *here* rather than by the caller blanking `rows`
 * afterwards. The two look equivalent from the outside and only one is: this runs
 * before the rows exist, so a collapsed file never allocates them. A caller that
 * filters afterwards still builds every `DiffRow` for every file on every
 * 15-second refresh, and for a large diff that allocation is what dominates -- the
 * virtualized list hides the *views*, not the model.
 */
export function toDiffSections(
  files: readonly FileDiffEntry[],
  options: {
    untrackedPaths?: ReadonlySet<string>;
    collapsed?: ReadonlySet<string>;
  } = {},
): DiffSection[] {
  const untracked = options.untrackedPaths ?? new Set<string>();
  const collapsed = options.collapsed ?? new Set<string>();

  return files.map((file) => {
    const rows: DiffRow[] = [];

    // Skipped off the same predicate `toggleCollapsed` maintains, so expanding a file
    // rebuilds it on the next render and cannot leave a permanently empty body.
    if (!collapsed.has(file.path)) {
      file.hunks.forEach((hunk, hunkIndex) => {
        rows.push({
          kind: "hunk",
          key: `${file.path}#${hunkIndex}`,
          header: hunk.header,
        });
        hunk.lines.forEach((line, lineIndex) => {
          rows.push({
            kind: "line",
            key: `${file.path}#${hunkIndex}.${lineIndex}`,
            hunkHeader: hunk.header,
            line,
          });
        });
      });
    }

    return {
      path: file.path,
      title: file.path,
      // Counted from the hunks, never from `rows`. A collapsed file still reports its
      // additions and deletions in its header; counting the rows that were not built
      // would report "+0 -0" for a file the user had merely folded away, which reads as
      // a change that was undone rather than one that is out of sight.
      counts: countHunkLines(file.hunks),
      untracked: untracked.has(file.path),
      rows,
    };
  });
}

/**
 * Add the files git has never seen, as entries with no hunks.
 *
 * `listedPaths` is what `file.list` reports; `statuses` is what `vcs.status`
 * reports. A path in the first and absent from the second is untracked, which is
 * the only way to recover the set now that V2 dropped the `"untracked"` status.
 *
 * The reconstructed paths are returned separately rather than left implicit in
 * the entries, because "this file has no hunks" and "this file has no patch
 * because git has never seen it" are different facts that happen to look alike.
 * A caller that only got the merged list could label a mode-only change on a
 * tracked file as "new file".
 */
export function withUntracked(
  files: readonly FileDiffEntry[],
  listedPaths: readonly string[],
  statuses: readonly VcsFileStatus[] | undefined,
): { files: FileDiffEntry[]; untrackedPaths: Set<string> } {
  const index: FileStatusIndex = indexFileStatuses(statuses);
  const alreadyShown = new Set(files.map((file) => file.path));
  const extras = markUntracked(listedPaths, index).filter(
    (entry) => !alreadyShown.has(entry.file),
  );

  if (extras.length === 0) {
    return { files: [...files], untrackedPaths: new Set() };
  }
  const untrackedPaths = new Set(extras.map((entry) => entry.file));
  return {
    files: [
      ...files,
      ...extras.map((entry) => ({ path: entry.file, hunks: [] as DiffHunk[] })),
    ],
    untrackedPaths,
  };
}

/**
 * Filter files by path substring, case-insensitively.
 *
 * An empty or whitespace-only query keeps everything, so clearing the box cannot
 * leave the panel empty and read as "no changes".
 */
export function filterSections(
  sections: readonly DiffSection[],
  query: string,
): DiffSection[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...sections];
  return sections.filter((section) =>
    section.path.toLowerCase().includes(needle),
  );
}

/**
 * Whether a file's body is hidden.
 *
 * A `Set` rather than a record so an unknown path is absent rather than `false`,
 * and copying is explicit -- mutating the set in place would make a collapsed
 * toggle change the previous state too, which React would not see.
 */
export function toggleCollapsed(
  collapsed: ReadonlySet<string>,
  path: string,
): ReadonlySet<string> {
  const next = new Set(collapsed);
  if (!next.delete(path)) next.add(path);
  return next;
}

/** The one-line label for a file header. */
export function describeSection(section: DiffSection): string {
  const { additions, deletions } = section.counts;
  if (section.untracked) return "new file";
  if (additions === 0 && deletions === 0) return "no line changes";
  return `+${additions} −${deletions}`;
}
