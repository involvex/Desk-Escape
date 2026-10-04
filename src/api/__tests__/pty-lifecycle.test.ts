import { describe, expect, test } from "bun:test";
import type { Pty } from "@opencode/client";

import {
  isPrunable,
  planPtyLifecycle,
  shouldKeepSession,
} from "@/api/pty-lifecycle";

/**
 * Tests for the PTY lifecycle decision.
 *
 * The whole point of this module is one question: is this shell ours to delete?
 * Getting it wrong in one direction orphans shells on the server forever; getting
 * it wrong in the other destroys a session the user - or another device - was
 * relying on. Both failures are invisible locally, so the boundaries are pinned
 * here.
 */

function running(id: string, overrides: Partial<Pty> = {}): Pty {
  return {
    id,
    title: "Desk Escape",
    command: "/bin/bash",
    args: [],
    cwd: "/repo",
    status: "running",
    pid: 1,
    ...overrides,
  };
}

function exited(id: string): Pty {
  return running(id, { status: "exited", exitCode: 0 });
}

// ---------------------------------------------------------------------------
// isPrunable
// ---------------------------------------------------------------------------

describe("isPrunable", () => {
  test("an exited PTY is a dead record", () => {
    expect(isPrunable(exited("pty_1"))).toBe(true);
  });

  test("a running PTY is not prunable on sight", () => {
    expect(isPrunable(running("pty_1"))).toBe(false);
  });

  test("an exited PTY is prunable regardless of ownership", () => {
    // Dead records are clutter whoever created them, so they are always removed.
    // There is no session left to destroy.
    const plan = planPtyLifecycle({ ptys: [exited("pty_old")], ownedId: null });
    expect(plan.pruneIds).toEqual(["pty_old"]);
  });
});

// ---------------------------------------------------------------------------
// Reuse
// ---------------------------------------------------------------------------

describe("reuse", () => {
  test("adopts a running PTY instead of creating another", () => {
    const plan = planPtyLifecycle({ ptys: [running("pty_1")] });
    expect(plan.reuseId).toBe("pty_1");
  });

  test("creates nothing to adopt when the list is empty", () => {
    const plan = planPtyLifecycle({ ptys: [] });
    expect(plan.reuseId).toBeNull();
    expect(plan.pruneIds).toEqual([]);
  });

  test("only exited PTYs leaves nothing to adopt", () => {
    const plan = planPtyLifecycle({ ptys: [exited("a"), exited("b")] });
    expect(plan.reuseId).toBeNull();
  });

  test("adopts the running one when exited records are also present", () => {
    // The mixed case: the server has one live shell and a pile of tombstones.
    const plan = planPtyLifecycle({
      ptys: [exited("old1"), running("live"), exited("old2")],
    });

    expect(plan.reuseId).toBe("live");
    expect(plan.pruneIds).toEqual(["old1", "old2"]);
  });

  test("picks the first running PTY when several are reported", () => {
    const plan = planPtyLifecycle({
      ptys: [running("first"), running("second")],
    });
    expect(plan.reuseId).toBe("first");
  });
});

// ---------------------------------------------------------------------------
// Ownership: the boundary that matters
// ---------------------------------------------------------------------------

describe("ownership", () => {
  test("an adopted PTY is never replaced when the shell changes", () => {
    // The regression this guards: deleting a shell this device did not start
    // would kill someone else's session - another client, or a shell the user
    // left running.
    const plan = planPtyLifecycle({
      ptys: [running("theirs")],
      ownedId: null,
      replaceOwned: true,
    });

    expect(plan.reuseId).toBe("theirs");
    expect(plan.pruneIds).toEqual([]);
  });

  test("an adopted PTY survives a replace request with no owned id", () => {
    const plan = planPtyLifecycle({
      ptys: [running("theirs")],
      ownedId: undefined,
      replaceOwned: true,
    });

    expect(plan.reuseId).toBe("theirs");
    expect(plan.pruneIds).toEqual([]);
  });

  test("an owned PTY is replaced when the shell changes", () => {
    // The user picked a different shell, and this device started the old one, so
    // the stale shell must go or the preference stays inert.
    const plan = planPtyLifecycle({
      ptys: [running("mine")],
      ownedId: "mine",
      replaceOwned: true,
    });

    expect(plan.reuseId).toBeNull();
    expect(plan.pruneIds).toEqual(["mine"]);
  });

  test("an owned PTY is kept when nothing asked for a replacement", () => {
    const plan = planPtyLifecycle({
      ptys: [running("mine")],
      ownedId: "mine",
      replaceOwned: false,
    });

    expect(plan.reuseId).toBe("mine");
    expect(plan.pruneIds).toEqual([]);
  });

  test("ownership must match, not merely exist", () => {
    // We own a different PTY than the running one, so the running one is not ours.
    const plan = planPtyLifecycle({
      ptys: [running("theirs")],
      ownedId: "mine",
      replaceOwned: true,
    });

    expect(plan.reuseId).toBe("theirs");
    expect(plan.pruneIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

describe("pruning", () => {
  test("prunes every exited record", () => {
    const plan = planPtyLifecycle({
      ptys: [exited("a"), exited("b"), exited("c")],
    });
    expect(plan.pruneIds).toEqual(["a", "b", "c"]);
  });

  test("does not prune a running PTY on sight", () => {
    const plan = planPtyLifecycle({ ptys: [running("live")] });
    expect(plan.pruneIds).toEqual([]);
  });

  test("does not list the same id twice", () => {
    // A duplicated record would produce two `pty.remove` calls for one PTY.
    const plan = planPtyLifecycle({
      ptys: [exited("dup"), exited("dup")],
    });
    expect(plan.pruneIds).toEqual(["dup"]);
  });

  test("a replaced PTY already listed as exited is not double-listed", () => {
    const plan = planPtyLifecycle({
      ptys: [exited("mine")],
      ownedId: "mine",
      replaceOwned: true,
    });
    expect(plan.pruneIds).toEqual(["mine"]);
  });

  test("pruning an exited PTY does not block reuse of a running one", () => {
    const plan = planPtyLifecycle({
      ptys: [exited("old"), running("live")],
      ownedId: "old",
    });

    expect(plan.reuseId).toBe("live");
    expect(plan.pruneIds).toEqual(["old"]);
  });

  test("defaults are safe with no options", () => {
    // `ownedId` and `replaceOwned` are optional; omitting both must behave as
    // "adopt, never delete a live shell".
    const plan = planPtyLifecycle({ ptys: [running("live")] });
    expect(plan).toEqual({ reuseId: "live", pruneIds: [] });
  });
});

// ---------------------------------------------------------------------------
// The ready short-circuit
// ---------------------------------------------------------------------------

describe("shouldKeepSession", () => {
  test("a ready session with an id is left alone", () => {
    // The ordinary case: the effect re-runs on an unrelated dependency change and
    // must not re-list or re-create anything.
    expect(
      shouldKeepSession({
        phase: "ready",
        ptyId: "pty_1",
        replaceOwned: false,
      }),
    ).toBe(true);
  });

  test("a shell change forces work even when ready", () => {
    // The regression: returning early on `ready` first made the shell preference
    // permanently inert, because `shell` is a dependency of the effect that makes
    // this decision.
    expect(
      shouldKeepSession({ phase: "ready", ptyId: "pty_1", replaceOwned: true }),
    ).toBe(false);
  });

  test("idle always needs work", () => {
    expect(
      shouldKeepSession({ phase: "idle", ptyId: "pty_1", replaceOwned: false }),
    ).toBe(false);
  });

  test("loading always needs work", () => {
    expect(
      shouldKeepSession({ phase: "loading", ptyId: null, replaceOwned: false }),
    ).toBe(false);
  });

  test("an errored session always needs work", () => {
    expect(
      shouldKeepSession({ phase: "error", ptyId: null, replaceOwned: false }),
    ).toBe(false);
  });

  test("ready without an id is not a usable session", () => {
    // Possible transiently: status can survive a failed assignment. Treating it as
    // ready would strand the panel with no PTY to connect to.
    expect(
      shouldKeepSession({ phase: "ready", ptyId: null, replaceOwned: false }),
    ).toBe(false);
  });

  test("an empty id is not a usable session", () => {
    expect(
      shouldKeepSession({ phase: "ready", ptyId: "", replaceOwned: false }),
    ).toBe(false);
  });

  test("replaceOwned wins over every phase", () => {
    // Belt and braces: whatever else is true, a pending replacement must run.
    for (const phase of ["idle", "loading", "ready", "error"] as const) {
      expect(
        shouldKeepSession({ phase, ptyId: "pty_1", replaceOwned: true }),
      ).toBe(false);
    }
  });
});
