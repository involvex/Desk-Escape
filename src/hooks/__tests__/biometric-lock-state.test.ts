import { describe, expect, test } from "bun:test";

import {
  isLockGated,
  nextLockState,
  type AppPhase,
  type BiometricLockState,
} from "@/hooks/biometric-lock-state";

/**
 * Tests for the app-lock re-arm rules.
 *
 * The behaviour under test is small but security-relevant, and both failure modes
 * are invisible in manual testing: a lock that never re-arms looks fine right up
 * until someone else picks up the phone, and a lock that fires during the
 * biometric prompt makes the app permanently unusable.
 */

const LOCKED: BiometricLockState = "locked";
const UNLOCKED: BiometricLockState = "unlocked";
const UNLOCKING: BiometricLockState = "unlocking";

// ---------------------------------------------------------------------------
// Is the lock actually in the way?
// ---------------------------------------------------------------------------

describe("isLockGated", () => {
  const gated = (over: Partial<Parameters<typeof isLockGated>[0]> = {}) =>
    isLockGated({
      lockState: LOCKED,
      biometricAvailable: true,
      initialized: true,
      ...over,
    });

  test("a locked app with working biometrics is gated", () => {
    expect(gated()).toBe(true);
  });

  test("an unlocked app is not", () => {
    // The ordinary case, and the one that must not change: holding a reply here would
    // wedge the app for every user who does not use the lock.
    expect(gated({ lockState: UNLOCKED })).toBe(false);
  });

  test("a prompt on screen counts as gated", () => {
    // `"unlocking"` is the moment the user has *not* been authenticated yet, so it is
    // the worst moment to send an approval. Note this is deliberately wider than the
    // workspace overlay's `=== "locked"`, which must stay narrow so it does not cover
    // the prompt it triggers.
    expect(gated({ lockState: UNLOCKING })).toBe(true);
  });

  test("a device that cannot authenticate is not gated, and does not hang", () => {
    // The trap. The stored preference is a boolean the user set once, and biometrics
    // can be unenrolled in system settings afterwards. `authenticate()` then returns
    // false without ever leaving `"locked"`, so gating on the lock state alone would
    // hold every permission reply forever with no way to release them — the agent
    // blocked, the user with no button that helps.
    //
    // This is why the predicate takes `biometricAvailable` and why the workspace
    // overlay has always required it too.
    expect(gated({ biometricAvailable: false })).toBe(false);
    expect(gated({ biometricAvailable: false, lockState: UNLOCKING })).toBe(
      false,
    );
  });

  test("nothing is gated before the preference has loaded", () => {
    // `lockState` defaults to `"unlocked"` pre-load, so this matches the screen's
    // condition rather than adding a rule. Asserted so the two cannot diverge.
    expect(gated({ initialized: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Re-arming on background
// ---------------------------------------------------------------------------

describe("leaving the foreground", () => {
  test("an unlocked app locks again on background", () => {
    // The regression this whole file exists for: the lock used to be read once at
    // mount and never re-applied, so one unlock was permanent.
    expect(nextLockState(UNLOCKED, true, "background")).toBe(LOCKED);
  });

  test("an unlocked app locks again when merely inactive", () => {
    // iOS reports `inactive` for the app switcher and for a system sheet, which is
    // enough to hand the unlocked UI to someone else.
    expect(nextLockState(UNLOCKED, true, "inactive")).toBe(LOCKED);
  });

  test("an already-locked app stays locked", () => {
    expect(nextLockState(LOCKED, true, "background")).toBe(LOCKED);
  });

  test("re-locks on every trip to the background", () => {
    // Not a one-shot: unlock, background, unlock, background again.
    let state: BiometricLockState = LOCKED;
    state = nextLockState(state, true, "active"); // still locked, screen prompts
    state = UNLOCKED; // user authenticates
    state = nextLockState(state, true, "background");
    expect(state).toBe(LOCKED);
    state = UNLOCKED; // user authenticates again
    state = nextLockState(state, true, "background");
    expect(state).toBe(LOCKED);
  });
});

// ---------------------------------------------------------------------------
// The unlock guard
// ---------------------------------------------------------------------------

describe("the unlock guard", () => {
  test("does not lock while the biometric prompt is showing", () => {
    // `authenticateAsync` backgrounds the app on Android and presents a system
    // overlay on iOS. Re-locking here would make the prompt unreachable and the
    // app impossible to unlock.
    expect(nextLockState(UNLOCKING, true, "background")).toBe(UNLOCKING);
    expect(nextLockState(UNLOCKING, true, "inactive")).toBe(UNLOCKING);
  });

  test("a failed prompt leaves the app locked rather than stuck unlocking", () => {
    // The hook writes `locked` on failure; the guard must not undo that.
    const afterFailure: BiometricLockState = nextLockState(
      LOCKED,
      true,
      "background",
    );
    expect(afterFailure).toBe(LOCKED);
  });
});

// ---------------------------------------------------------------------------
// Disabled lock
// ---------------------------------------------------------------------------

describe("lock disabled", () => {
  for (const phase of ["active", "inactive", "background"] as AppPhase[]) {
    test(`never locks on ${phase}`, () => {
      expect(nextLockState(LOCKED, false, phase)).toBe(UNLOCKED);
    });
  }

  test("turning the lock off unlocks immediately", () => {
    // Settings calls this after persisting the preference; the app must not sit
    // locked behind a feature the user just turned off.
    expect(nextLockState(LOCKED, false, "active")).toBe(UNLOCKED);
  });
});

// ---------------------------------------------------------------------------
// Resuming
// ---------------------------------------------------------------------------

describe("returning to the foreground", () => {
  test("returning to active never unlocks on its own", () => {
    // Unlocking is the screen's decision (it owns the prompt), not a side effect
    // of resuming. If this returned `unlocked`, the lock would be decorative.
    expect(nextLockState(LOCKED, true, "active")).toBe(LOCKED);
  });

  test("returning to active preserves an unlocked state", () => {
    expect(nextLockState(UNLOCKED, true, "active")).toBe(UNLOCKED);
  });

  test("returning to active preserves an in-flight prompt", () => {
    expect(nextLockState(UNLOCKING, true, "active")).toBe(UNLOCKING);
  });

  test("background then active leaves the app locked", () => {
    // The round trip is the real sequence: leave, come back, expect a prompt.
    const afterBackground = nextLockState(UNLOCKED, true, "background");
    const afterResume = nextLockState(afterBackground, true, "active");
    expect(afterResume).toBe(LOCKED);
  });
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------

describe("idempotence", () => {
  test("repeated background events do not change a stable state", () => {
    // AppState can deliver `inactive` then `background` for one trip away, so the
    // rule has to be safe to apply more than once.
    const once = nextLockState(UNLOCKED, true, "background");
    const twice = nextLockState(once, true, "background");
    const thrice = nextLockState(twice, true, "inactive");
    expect(thrice).toBe(LOCKED);
  });

  test("the function is pure: same inputs, same output", () => {
    for (const phase of ["active", "inactive", "background"] as AppPhase[]) {
      for (const start of [
        LOCKED,
        UNLOCKING,
        UNLOCKED,
      ] as BiometricLockState[]) {
        expect(nextLockState(start, true, phase)).toBe(
          nextLockState(start, true, phase),
        );
      }
    }
  });
});
