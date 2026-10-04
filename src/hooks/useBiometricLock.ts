import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

import {
  nextLockState,
  type AppPhase,
  type BiometricLockState,
} from "./biometric-lock-state";

const BIOMETRIC_KEY = "desk-escape.biometric-enabled";

async function getBiometricEnabled(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(BIOMETRIC_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_KEY, String(enabled));
}

/** AppState reports a few extra values; collapse them to the phases we act on. */
function toPhase(status: AppStateStatus): AppPhase {
  if (status === "active") return "active";
  if (status === "inactive") return "inactive";
  return "background";
}

export function useBiometricLock() {
  const [state, setState] = useState<BiometricLockState>("unlocked");
  const [initialized, setInitialized] = useState(false);
  // Exposed so the screen can hold off prompting until the app is actually
  // foregrounded. Re-locking on background means `state` becomes "locked" while
  // nothing is visible, and firing a biometric prompt then fails on iOS and looks
  // like a failed unlock - which used to route the user back to Connection.
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );

  // Mirrors of state that the AppState listener needs. A listener registered once
  // on mount would otherwise close over the initial values and never re-lock,
  // which is exactly the bug this hook previously had.
  const stateRef = useRef<BiometricLockState>("unlocked");
  const enabledRef = useRef(false);

  const applyState = useCallback((next: BiometricLockState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Load the stored preference.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const enabled = await getBiometricEnabled();
      if (cancelled) return;
      enabledRef.current = enabled;
      applyState(enabled ? "locked" : "unlocked");
      setInitialized(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyState]);

  // Re-lock when the app leaves the foreground.
  //
  // Without this the lock is effectively one-shot: the flag is read once at mount,
  // so a single successful unlock left the app open until the process died. Any
  // interruption that could hand the unlocked app to someone else - a notification,
  // a task switcher, a lock screen - now re-arms it.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      const phase = toPhase(status);
      setAppActive(phase === "active");

      const next = nextLockState(stateRef.current, enabledRef.current, phase);
      if (next !== stateRef.current) {
        applyState(next);
      }
    });

    return () => subscription.remove();
  }, [applyState]);

  const authenticate = useCallback(async (): Promise<boolean> => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;

    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return false;

    applyState("unlocking");

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authenticate to unlock Desk Escape",
        disableDeviceFallback: true,
      });

      if (result.success) {
        applyState("unlocked");
        return true;
      }

      applyState("locked");
      return false;
    } catch {
      applyState("locked");
      return false;
    }
  }, [applyState]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      await setBiometricEnabled(enabled);
      enabledRef.current = enabled;
      applyState(enabled ? "locked" : "unlocked");
    },
    [applyState],
  );

  return { state, authenticate, setEnabled, initialized, appActive };
}
