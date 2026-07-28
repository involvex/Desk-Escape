import { useCallback, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const BIOMETRIC_KEY = "@desk-escape/biometric-enabled";

async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_KEY, String(enabled));
}

export function useBiometricLock() {
  const [state, setState] = useState<"locked" | "unlocking" | "unlocked">(
    "locked",
  );

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

  return { state, authenticate, setEnabled };
}
