/**
 * Lock-state transitions for the biometric app lock.
 *
 * Kept separate from `useBiometricLock` so the rules can be tested without React
 * Native, `expo-local-authentication`, or `expo-secure-store` - none of which
 * resolve under `bun test`.
 */

export type BiometricLockState = "locked" | "unlocking" | "unlocked";

/** The AppState values that matter for locking. */
export type AppPhase = "active" | "inactive" | "background";

/**
 * Whether the app lock is actually standing between the user and the app right now.
 *
 * This is the single definition of "the lock is on", and both the workspace overlay
 * and the permission-reply hold ask it rather than reading `lockState` each. They
 * cannot drift, which matters because they were written apart and had already drifted
 * once: the screen gated on `lockState === "locked"`, the reply path gated on nothing
 * at all.
 *
 * The three conditions are all load-bearing, and the middle one is the trap.
 *
 * - **`initialized`** — before the stored preference is read, `lockState` is
 *   `"unlocked"` by default, so requiring it changes nothing and costs nothing. It is
 *   here to mirror the screen exactly rather than to do work.
 * - **`lockState !== "unlocked"`** — deliberately not `=== "locked"`. `"unlocking"`
 *   means a biometric prompt is on screen, and that is the *worst* moment to send a
 *   permission approval: the user has not been authenticated yet. The overlay's own
 *   condition is the narrower `=== "locked"`, because an overlay during the prompt
 *   would sit on top of it.
 * - **`biometricAvailable`** — the one that prevents a hang. The stored preference is
 *   a boolean the user set once, and biometrics can be unenrolled afterwards in system
 *   settings. Then `authenticate()` returns `false` without ever leaving `"locked"`,
 *   so gating replies on `lockState` alone would hold every approval forever with no
 *   way to release them. The screen already guards this; without the guard here, a
 *   stale preference would quietly break approvals rather than visibly fail.
 */
export function isLockGated(input: {
  lockState: BiometricLockState;
  biometricAvailable: boolean;
  initialized: boolean;
}): boolean {
  return (
    input.initialized &&
    input.biometricAvailable &&
    input.lockState !== "unlocked"
  );
}

/**
 * Decides the lock state after the app changes phase.
 *
 * Two rules are easy to get wrong and both have bitten real implementations:
 *
 * 1. **Never lock while unlocking.** `authenticateAsync` backgrounds the app on
 *    Android and presents a system overlay on iOS. Treating that as "the user
 *    left" re-locks mid-prompt, and the user can authenticate forever without
 *    ever reaching the unlocked state.
 * 2. **Never lock when the feature is off.** The stored flag is the only source
 *    of truth; without it, a device where the user disabled the lock would still
 *    demand biometrics after every app switch.
 *
 * Returning to `active` deliberately does not unlock. The screen that owns the
 * lock decides when to prompt, so unlocking stays a UI concern rather than a
 * side effect of resuming.
 */
export function nextLockState(
  current: BiometricLockState,
  enabled: boolean,
  phase: AppPhase,
): BiometricLockState {
  if (!enabled) {
    return "unlocked";
  }
  if (phase === "active") {
    return current;
  }
  if (current === "unlocking") {
    return current;
  }
  return "locked";
}
