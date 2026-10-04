import type { FileDiffInfo, SessionRevert } from "@opencode/client";

import type { ChatMessage } from "@/types/domain";

/**
 * Undo / revert, as a pure state machine over the two-phase `session.revert` API.
 *
 * ## The API is two-phase, and that is the point
 *
 * `stage` asks the server what *would* change and returns it; `commit` applies
 * it; `clear` throws the staging away.
 *
 * ## The anchor is exclusive, and that is verified rather than assumed
 *
 * An earlier version of this file could not establish whether `stage`'s
 * `messageID` means "keep up to here" or "undo from here" — the parameter reads
 * the same either way — and so refused to interpret it, showing only the
 * consequences the *server* reported. Probed against a live server
 * (`scripts/probe-server-contracts.mjs`, Q3), the answer is unambiguous:
 * `messageID` is the first message to be **removed**. Staging changes nothing;
 * committing a revert anchored at the third of four messages leaves the first two
 * and deletes the anchor along with everything after it.
 *
 * That is why {@link latestRevertTargetId} anchors on the most recent *user*
 * message: "undo my last request" should take the request itself, not stop one
 * short of it. It also means this module still does not need to interpret the id —
 * it stages, shows the consequences the server reported (`files`), and commits
 * only what came back — but it now knows which way the cut runs, so the staged
 * summary can describe a removal rather than hedge about a boundary.
 *
 * Note the symmetry with `session.fork({before})`, also verified: both anchors are
 * exclusive, so "fork from here" and "undo from here" cut at the same place.
 *
 * ## Reverting is destructive and file-level irreversible
 *
 * Committing rewinds the conversation *and* rewrites files on disk. There is no
 * undo for the undo. So the staged state is not skippable: {@link RevertState}
 * has no transition that reaches "committed" without passing through "staged".
 *
 * Kept pure so the target-selection and guard logic is testable without React,
 * React Native, or a server.
 */

/** A file the staged revert would restore. */
export interface RevertFile {
  path: string;
  additions: number;
  deletions: number;
}

/** What the server says a staged revert would do. */
export interface RevertSummary {
  /** The anchor the server chose, echoed back for display. */
  anchorMessageId: string;
  files: RevertFile[];
  fileCount: number;
  /** Total lines the revert would restore. */
  additions: number;
  deletions: number;
  /**
   * `true` when the revert touches no files at all — only the conversation.
   * Worth surfacing: "Undo" that silently rewrites three source files reads very
   * differently from one that only trims the transcript.
   */
  filesOnly: boolean;
}

/**
 * Where a revert has got to.
 *
 * `staged` is the only state from which a commit is legal, and reaching it
 * requires a successful `stage`.
 */
export type RevertPhase = "idle" | "staging" | "staged" | "committing";

export interface RevertState {
  phase: RevertPhase;
  /** Present from `staged` until the state returns to `idle`. */
  summary: RevertSummary | null;
  /** Last failure message, or `null`. */
  error: string | null;
}

export const initialRevertState: RevertState = {
  phase: "idle",
  summary: null,
  error: null,
};

/**
 * Normalize one `FileDiffInfo` into a display row.
 *
 * The counts are clamped at zero: a negative from the server is a data problem,
 * and rendering `-3 deletions` in a confirmation the user is about to approve
 * would be worse than showing zero.
 */
export function toRevertFile(diff: FileDiffInfo): RevertFile {
  const count = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : 0;

  return {
    path: (diff.file ?? "").trim(),
    additions: count(diff.additions),
    deletions: count(diff.deletions),
  };
}

/** Summarize a staged revert as the server described it. */
export function summarizeRevert(revert: SessionRevert): RevertSummary {
  const files = (revert.files ?? [])
    .map(toRevertFile)
    // A diff with no path cannot be shown or reasoned about; dropping it here
    // keeps the counts honest rather than inflating them with an unnameable file.
    .filter((file) => file.path.length > 0);

  return {
    anchorMessageId: revert.messageID ?? "",
    files,
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    filesOnly: files.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export type RevertAction =
  | { type: "stage" }
  | { type: "staged"; summary: RevertSummary }
  | { type: "stage-failed"; error: string }
  | { type: "commit" }
  | { type: "committed" }
  | { type: "commit-failed"; error: string }
  | { type: "clear" }
  | { type: "reset" };

/**
 * Revert state transitions.
 *
 * Every guard here exists because the operations are destructive: `stage` while
 * already staged would orphan the first staging on the server, and `commit`
 * without one would either no-op or — worse — commit whatever stale staging
 * happened to be left over from an earlier interaction.
 */
export function revertReducer(
  state: RevertState,
  action: RevertAction,
): RevertState {
  switch (action.type) {
    case "stage":
      // Staging twice would leave the server holding a revert the client no
      // longer knows about, so the second press is absorbed rather than sent.
      if (state.phase === "staging" || state.phase === "staged") {
        return state;
      }
      return { phase: "staging", summary: null, error: null };

    case "staged":
      return { phase: "staged", summary: action.summary, error: null };

    case "stage-failed":
      return { phase: "idle", summary: null, error: action.error };

    case "commit":
      if (state.phase !== "staged" || state.summary === null) {
        return state;
      }
      return { phase: "committing", summary: state.summary, error: null };

    case "committed":
      return initialRevertState;

    case "commit-failed":
      // Back to `staged`, not `idle`: the server still holds the staging, and
      // dropping the UI's copy of it would leave the user with no way to retry
      // or to abandon a change that is pending on the server.
      if (state.phase !== "committing") {
        return state;
      }
      return { phase: "staged", summary: state.summary, error: action.error };

    case "clear":
      // Clearing nothing is a no-op rather than a reset: it keeps an unrelated
      // error message from being wiped by a stray tap.
      if (state.phase !== "staged" && state.phase !== "committing") {
        return state;
      }
      return { phase: "idle", summary: null, error: state.error };

    case "reset":
      return initialRevertState;
  }
}

/**
 * The message an undo would anchor to: the most recent user message.
 *
 * Only user messages. An assistant message is the agent's output rather than
 * the instruction being undone, and anchoring on one is not a request anyone
 * makes. Returns `null` when there is no user message — with nothing the user
 * asked for, there is nothing to undo.
 */
export function latestRevertTargetId(
  messages: readonly ChatMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.info.role === "user") {
      return message.info.id;
    }
  }
  return null;
}

/** Whether an undo affordance should be offered at all. */
export function canStartRevert(
  messages: readonly ChatMessage[],
  state: RevertState,
): boolean {
  if (state.phase === "staging" || state.phase === "committing") {
    return false;
  }
  return latestRevertTargetId(messages) !== null;
}

/**
 * The confirmation copy for a staged revert.
 *
 * Names the files, because they are the irreversible part. A revert that only
 * trims the conversation says so instead of implying disk changes.
 */
export function revertConfirmationText(summary: RevertSummary): string {
  const { fileCount, additions, deletions } = summary;

  if (fileCount === 0) {
    return "Only the conversation will be reverted. No files change.";
  }

  const lines = summary.files
    .slice(0, 5)
    .map((file) => `  ${file.path}  +${file.additions} −${file.deletions}`);

  const remainder =
    fileCount > lines.length ? [`  …and ${fileCount - lines.length} more`] : [];

  return [
    `${fileCount} file${fileCount === 1 ? "" : "s"} will be restored:`,
    ...lines,
    ...remainder,
    "",
    `Total +${additions} −${deletions}. This cannot be undone.`,
  ].join("\n");
}
