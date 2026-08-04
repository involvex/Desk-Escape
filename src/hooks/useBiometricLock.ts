import { useCallback, useEffect, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

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

export function useBiometricLock() {
  const [state, setState] = useState<"locked" | "unlocking" | "unlocked">(
    "unlocked",
  );
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    void (async () => {
      const enabled = await getBiometricEnabled();
      setState(enabled ? "locked" : "unlocked");
      setInitialized(true);
    })();
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;

    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return false;

    setState("unlocking");

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authenticate to unlock Desk Escape",
        disableDeviceFallback: true,
      });

      if (result.success) {
        setState("unlocked");
        return true;
      }

      setState("locked");
      return false;
    } catch {
      setState("locked");
      return false;
    }
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    await setBiometricEnabled(enabled);
    if (!enabled) {
      setState("unlocked");
    } else {
      setState("locked");
    }
  }, []);

  return { state, authenticate, setEnabled, initialized };
}
