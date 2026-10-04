import { describe, expect, test } from "bun:test";
import type { FileDiffInfo, SessionRevert } from "@opencode/client";

import {
  canStartRevert,
  initialRevertState,
  latestRevertTargetId,
  revertConfirmationText,
  revertReducer,
  summarizeRevert,
  toRevertFile,
  type RevertState,
} from "@/api/session-revert";
import type { ChatMessage } from "@/types/domain";

/**
 * Tests for the revert state machine.
 *
 * Every guard in the reducer protects against one thing: a destructive commit
 * that the user did not agree to, or a staging stranded on the server that the
 * client has forgotten. Neither throws, so they are only catchable by asserting
 * the transitions directly.
 */

function diff(
  file: string,
  additions: number,
  deletions: number,
): FileDiffInfo {
  return { file, patch: "", additions, deletions } as FileDiffInfo;
}

function staged(files: FileDiffInfo[] = []): RevertState {
  return revertReducer(initialRevertState, {
    type: "staged",
    summary: summarizeRevert({ messageID: "msg_1", files } as SessionRevert),
  });
}

function chat(id: string, role: "user" | "assistant"): ChatMessage {
  return {
    info: {
      id,
      role,
      kind: role,
      time: { created: 1_700_000_000_000 },
    },
    parts: [],
  } as ChatMessage;
}

// ---------------------------------------------------------------------------
// toRevertFile
// ---------------------------------------------------------------------------

describe("toRevertFile", () => {
  test("keeps the counts it is given", () => {
    expect(toRevertFile(diff("src/a.ts", 12, 3))).toEqual({
      path: "src/a.ts",
      additions: 12,
      deletions: 3,
    });
  });

  test("clamps negatives to zero", () => {
    // A negative from the server is a data problem. Rendering "-3 deletions" in a
    // confirmation the user is about to approve is worse than rendering zero.
    expect(toRevertFile(diff("a.ts", -5, -1))).toEqual({
      path: "a.ts",
      additions: 0,
      deletions: 0,
    });
  });

  test("clamps missing and non-finite counts to zero", () => {
    expect(toRevertFile({ file: "a.ts" } as FileDiffInfo)).toEqual({
      path: "a.ts",
      additions: 0,
      deletions: 0,
    });
    expect(
      toRevertFile({
        file: "a.ts",
        additions: Number.NaN,
        deletions: Number.POSITIVE_INFINITY,
      } as FileDiffInfo),
    ).toEqual({ path: "a.ts", additions: 0, deletions: 0 });
  });

  test("floors fractional counts", () => {
    expect(toRevertFile(diff("a.ts", 2.9, 1.2))).toEqual({
      path: "a.ts",
      additions: 2,
      deletions: 1,
    });
  });

  test("trims the path", () => {
    expect(toRevertFile(diff("  src/a.ts  ", 1, 0)).path).toBe("src/a.ts");
  });
});

// ---------------------------------------------------------------------------
// summarizeRevert
// ---------------------------------------------------------------------------

describe("summarizeRevert", () => {
  test("sums additions and deletions across files", () => {
    const summary = summarizeRevert({
      messageID: "msg_1",
      files: [diff("a.ts", 10, 2), diff("b.ts", 5, 1)],
    } as SessionRevert);
    expect(summary.fileCount).toBe(2);
    expect(summary.additions).toBe(15);
    expect(summary.deletions).toBe(3);
  });

  test("echoes the anchor the server chose", () => {
    // Deliberately not interpreted: the client does not assume whether this id
    // means "keep up to here" or "undo from here".
    const summary = summarizeRevert({
      messageID: "msg_anchor",
      files: [],
    } as SessionRevert);
    expect(summary.anchorMessageId).toBe("msg_anchor");
  });

  test("is filesOnly when files are present", () => {
    const summary = summarizeRevert({
      messageID: "m",
      files: [diff("a.ts", 1, 0)],
    } as SessionRevert);
    expect(summary.filesOnly).toBe(true);
  });

  test("is not filesOnly for a conversation-only revert", () => {
    // "Undo" that silently rewrites three source files reads very differently
    // from one that only trims the transcript.
    expect(
      summarizeRevert({ messageID: "m", files: [] } as SessionRevert).filesOnly,
    ).toBe(false);
    expect(summarizeRevert({ messageID: "m" } as SessionRevert).filesOnly).toBe(
      false,
    );
  });

  test("drops entries with no path rather than inflating the counts", () => {
    const summary = summarizeRevert({
      messageID: "m",
      files: [diff("a.ts", 10, 1), diff("   ", 99, 99), diff("", 5, 5)],
    } as SessionRevert);
    expect(summary.fileCount).toBe(1);
    expect(summary.additions).toBe(10);
    expect(summary.deletions).toBe(1);
  });

  test("tolerates a missing files array", () => {
    const summary = summarizeRevert({ messageID: "m" } as SessionRevert);
    expect(summary.files).toEqual([]);
    expect(summary.fileCount).toBe(0);
    expect(summary.additions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// revertReducer
// ---------------------------------------------------------------------------

describe("revertReducer", () => {
  test("starts idle", () => {
    expect(initialRevertState).toEqual({
      phase: "idle",
      summary: null,
      error: null,
    });
  });

  test("stage moves to staging", () => {
    expect(revertReducer(initialRevertState, { type: "stage" }).phase).toBe(
      "staging",
    );
  });

  test("staged carries the summary and clears any error", () => {
    const state = revertReducer(
      { phase: "staging", summary: null, error: "old" },
      {
        type: "staged",
        summary: summarizeRevert({ messageID: "m" } as SessionRevert),
      },
    );
    expect(state.phase).toBe("staged");
    expect(state.summary?.anchorMessageId).toBe("m");
    expect(state.error).toBeNull();
  });

  test("stage is absorbed while already staging or staged", () => {
    // Two presses would leave the server holding a revert the client has
    // forgotten about.
    const staging = revertReducer(initialRevertState, { type: "stage" });
    expect(revertReducer(staging, { type: "stage" })).toBe(staging);
    const already = staged();
    expect(revertReducer(already, { type: "stage" })).toBe(already);
  });

  test("stage-failed returns to idle and keeps the message", () => {
    const state = revertReducer(
      revertReducer(initialRevertState, { type: "stage" }),
      { type: "stage-failed", error: "nope" },
    );
    expect(state.phase).toBe("idle");
    expect(state.summary).toBeNull();
    expect(state.error).toBe("nope");
  });

  test("commit is refused without a staged summary", () => {
    // Committing with nothing staged would apply whatever stale revert the
    // server happened to still be holding.
    expect(revertReducer(initialRevertState, { type: "commit" }).phase).toBe(
      "idle",
    );
    const staging = revertReducer(initialRevertState, { type: "stage" });
    expect(revertReducer(staging, { type: "commit" }).phase).toBe("staging");
  });

  test("commit moves a staged revert to committing", () => {
    const state = revertReducer(staged(), { type: "commit" });
    expect(state.phase).toBe("committing");
    // The summary is retained so the UI can keep showing what is in flight.
    expect(state.summary).not.toBeNull();
  });

  test("committed returns to the initial state", () => {
    const state = revertReducer(revertReducer(staged(), { type: "commit" }), {
      type: "committed",
    });
    expect(state).toEqual(initialRevertState);
  });

  test("commit-failed returns to staged, not idle", () => {
    // The server still holds the staging. Dropping the client's copy would
    // leave the user unable to retry *or* to abandon a pending change.
    const committing = revertReducer(staged(), { type: "commit" });
    const state = revertReducer(committing, {
      type: "commit-failed",
      error: "disk full",
    });
    expect(state.phase).toBe("staged");
    expect(state.summary).not.toBeNull();
    expect(state.error).toBe("disk full");
  });

  test("commit-failed is ignored unless a commit was in flight", () => {
    const state = staged();
    expect(revertReducer(state, { type: "commit-failed", error: "x" })).toBe(
      state,
    );
  });

  test("clear abandons a staged revert", () => {
    const state = revertReducer(staged(), { type: "clear" });
    expect(state.phase).toBe("idle");
    expect(state.summary).toBeNull();
  });

  test("clear while idle is a no-op that keeps the error", () => {
    // A stray tap must not wipe an error the user still needs to read.
    const state: RevertState = {
      phase: "idle",
      summary: null,
      error: "keep me",
    };
    expect(revertReducer(state, { type: "clear" })).toBe(state);
  });

  test("reset clears everything from any phase", () => {
    const busy = revertReducer(staged(), { type: "commit" });
    expect(revertReducer(busy, { type: "reset" })).toEqual(initialRevertState);
  });

  test("no transition reaches committed without passing through staged", () => {
    // The property the whole machine exists to hold.
    const canCommitFrom = (s: RevertState) =>
      revertReducer(s, { type: "commit" }).phase === "committing";

    for (const phase of ["idle", "staging", "staged", "committing"] as const) {
      const state: RevertState = {
        phase,
        summary:
          phase === "staged" || phase === "committing"
            ? summarizeRevert({ messageID: "m" } as SessionRevert)
            : null,
        error: null,
      };
      if (phase === "staged" || phase === "committing") {
        expect(canCommitFrom(state)).toBe(true);
      } else {
        expect(canCommitFrom(state)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

describe("latestRevertTargetId", () => {
  test("is the last user message", () => {
    const messages = [
      chat("u1", "user"),
      chat("a1", "assistant"),
      chat("u2", "user"),
      chat("a2", "assistant"),
    ];
    expect(latestRevertTargetId(messages)).toBe("u2");
  });

  test("is null when the user has sent nothing", () => {
    // Nothing was asked for, so there is nothing to undo.
    expect(latestRevertTargetId([])).toBeNull();
    expect(latestRevertTargetId([chat("a1", "assistant")])).toBeNull();
  });

  test("never targets an assistant message", () => {
    // An assistant message is output, not the instruction being undone.
    const messages = [chat("u1", "user"), chat("a1", "assistant")];
    expect(latestRevertTargetId(messages)).toBe("u1");
  });

  test("handles consecutive user messages", () => {
    const messages = [chat("u1", "user"), chat("u2", "user")];
    expect(latestRevertTargetId(messages)).toBe("u2");
  });

  test("skips holes in the array", () => {
    const sparse = [chat("u1", "user"), undefined, chat("u2", "user")] as never;
    expect(latestRevertTargetId(sparse)).toBe("u2");
  });
});

describe("canStartRevert", () => {
  test("is true when a user message exists and nothing is in flight", () => {
    expect(canStartRevert([chat("u1", "user")], initialRevertState)).toBe(true);
  });

  test("is false with no user message", () => {
    expect(canStartRevert([], initialRevertState)).toBe(false);
  });

  test("is false while staging or committing", () => {
    const messages = [chat("u1", "user")];
    expect(
      canStartRevert(messages, {
        phase: "staging",
        summary: null,
        error: null,
      }),
    ).toBe(false);
    expect(canStartRevert(messages, { ...staged(), phase: "committing" })).toBe(
      false,
    );
  });

  test("is true while already staged, so the staged banner stays reachable", () => {
    // The staged state is not a blocker; it is the thing the user is looking at.
    expect(canStartRevert([chat("u1", "user")], staged())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Confirmation copy
// ---------------------------------------------------------------------------

describe("revertConfirmationText", () => {
  test("says only the conversation changes when there are no files", () => {
    const summary = summarizeRevert({ messageID: "m" } as SessionRevert);
    expect(revertConfirmationText(summary)).toBe(
      "Only the conversation will be reverted. No files change.",
    );
  });

  test("lists each file with its counts", () => {
    const summary = summarizeRevert({
      messageID: "m",
      files: [diff("src/a.ts", 10, 2), diff("src/b.ts", 1, 0)],
    } as SessionRevert);
    const text = revertConfirmationText(summary);
    expect(text).toContain("2 files will be restored:");
    expect(text).toContain("src/a.ts  +10 −2");
    expect(text).toContain("src/b.ts  +1 −0");
    expect(text).toContain("Total +11 −2. This cannot be undone.");
  });

  test("uses the singular for one file", () => {
    const summary = summarizeRevert({
      messageID: "m",
      files: [diff("a.ts", 1, 1)],
    } as SessionRevert);
    expect(revertConfirmationText(summary)).toContain(
      "1 file will be restored:",
    );
  });

  test("truncates a long file list and says how many were withheld", () => {
    const summary = summarizeRevert({
      messageID: "m",
      files: Array.from({ length: 8 }, (_, i) => diff(`f${i}.ts`, 1, 0)),
    } as SessionRevert);
    const text = revertConfirmationText(summary);
    expect(text).toContain("f0.ts");
    expect(text).not.toContain("f5.ts");
    expect(text).toContain("…and 3 more");
    // The total still reflects every file, not just the listed ones.
    expect(text).toContain("Total +8 −0");
  });

  test("does not claim more files when the list is exactly at the cap", () => {
    const summary = summarizeRevert({
      messageID: "m",
      files: Array.from({ length: 5 }, (_, i) => diff(`f${i}.ts`, 1, 0)),
    } as SessionRevert);
    expect(revertConfirmationText(summary)).not.toContain("more");
  });

  test("keeps the file list and the total visually separated", () => {
    const summary = summarizeRevert({
      messageID: "m",
      files: [diff("a.ts", 3, 1)],
    } as SessionRevert);
    expect(revertConfirmationText(summary)).toContain("\n\nTotal");
  });
});
