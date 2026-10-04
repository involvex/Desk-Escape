import type { Pty } from "@opencode/client";

/**
 * What to do with the PTYs the server reports for a directory.
 *
 * The reuse decision was previously implicit inside the hook's effect, which
 * meant the ownership question - "did *this* device start this shell, or did it
 * find one somebody else left running?" - was never answered. Without that
 * answer the only safe cleanup is none, which is why nothing was ever deleted.
 *
 * Kept pure so the rules can be tested without React or a server.
 */

export interface PtyLifecyclePlan {
  /** A running PTY to adopt instead of creating a new one. */
  reuseId: string | null;
  /** Ids the client should remove via `pty.remove`. */
  pruneIds: string[];
}

export interface PtyLifecycleInput {
  /** Every PTY the server reports for this directory. */
  ptys: readonly Pty[];
  /**
   * The PTY this client created, if any.
   *
   * Only a PTY in this set may be auto-removed. A PTY this client merely
   * *found* belongs to whoever started it - possibly another device, possibly a
   * shell the user deliberately left running - and deleting it would destroy
   * someone else's session.
   */
  ownedId?: string | null;
  /**
   * Set when a setting changed in a way that makes the current PTY wrong, such
   * as the user picking a different shell. Only an owned PTY is replaced.
   */
  replaceOwned?: boolean;
}

/**
 * Exited PTYs are dead records.
 *
 * They cost nothing to keep running, but they do accumulate: the list endpoint
 * returns them forever, so a long-lived server fills with tombstones and the one
 * genuinely usable shell becomes harder to find. Nothing else in the app removes
 * them, so they are pruned on sight.
 */
export function isPrunable(pty: Pty): boolean {
  return pty.status === "exited";
}

/** The subset of session status that matters for the short-circuit decision. */
export type SessionPhase = "idle" | "loading" | "ready" | "error";

export interface KeepSessionInput {
  phase: SessionPhase;
  ptyId: string | null;
  /** A shell-preference change makes the current PTY wrong. See below. */
  replaceOwned: boolean;
}

/**
 * Whether an already-attached session may be left alone.
 *
 * Extracted because the ordering is load-bearing and got it wrong once: the
 * original code returned early on `status === "ready" && ptyId` *before* working
 * out whether a shell-preference change had invalidated the session. Since `shell`
 * is a dependency of the effect that owns this decision, that early return
 * swallowed the change and the setting could never take effect — §2.4, the shell
 * preference being inert, which was still true after the first attempt to fix it.
 *
 * So: a ready session is only left alone when nothing wants it replaced.
 */
export function shouldKeepSession({
  phase,
  ptyId,
  replaceOwned,
}: KeepSessionInput): boolean {
  if (replaceOwned) {
    return false;
  }
  // Truthiness, not `!== null`. The caller uses `""` as a "no id" sentinel when
  // probing ownership, so an empty string is a value this module really does see.
  // Treating it as a live session would strand the panel with nothing to connect to.
  return phase === "ready" && Boolean(ptyId);
}

export function planPtyLifecycle({
  ptys,
  ownedId,
  replaceOwned = false,
}: PtyLifecycleInput): PtyLifecyclePlan {
  const pruneIds: string[] = [];
  const seen = new Set<string>();

  for (const pty of ptys) {
    if (!seen.has(pty.id)) {
      seen.add(pty.id);
      if (isPrunable(pty)) {
        pruneIds.push(pty.id);
      }
    }
  }

  const running = ptys.find((pty) => pty.status === "running");
  const ownsRunning = Boolean(running && ownedId && running.id === ownedId);

  // Replacing an owned PTY is the only case where a *running* shell is removed:
  // the user asked for a different one, and this device started the wrong one.
  if (running && ownsRunning && replaceOwned) {
    if (!pruneIds.includes(running.id)) {
      pruneIds.push(running.id);
    }
    return { reuseId: null, pruneIds };
  }

  return { reuseId: running?.id ?? null, pruneIds };
}
