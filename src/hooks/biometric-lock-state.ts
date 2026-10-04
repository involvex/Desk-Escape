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
