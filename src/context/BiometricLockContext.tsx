import React, { createContext, useContext } from "react";
import { useBiometricLock } from "@/hooks/useBiometricLock";
import type { BiometricLockState } from "@/types/opencode";

interface BiometricLockContextValue {
  lockState: BiometricLockState;
  authenticate: () => Promise<boolean>;
  setBiometricLockEnabled: (enabled: boolean) => Promise<void>;
  initialized: boolean;
  /** False while the app is backgrounded or inactive. */
  appActive: boolean;
  /**
   * Whether this device can authenticate the user at all.
   *
   * Part of the context rather than probed by each consumer, because `PermissionProvider`
   * needs it to decide whether to hold a reply taken from a notification, and two
   * independent probes are two answers. See `isLockGated` for why the lock being
   * "enabled" is not the same question.
   */
  biometricAvailable: boolean;
}

export const BiometricLockContext =
  createContext<BiometricLockContextValue | null>(null);

export function BiometricLockProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    state,
    authenticate,
    setEnabled,
    initialized,
    appActive,
    biometricAvailable,
  } = useBiometricLock();

  return (
    <BiometricLockContext.Provider
      value={{
        lockState: state,
        authenticate,
        setBiometricLockEnabled: setEnabled,
        initialized,
        appActive,
        biometricAvailable,
      }}
    >
      {children}
    </BiometricLockContext.Provider>
  );
}

export function useBiometricLockContext(): BiometricLockContextValue {
  const context = useContext(BiometricLockContext);
  if (!context) {
    throw new Error(
      "useBiometricLockContext must be used within a BiometricLockProvider",
    );
  }
  return context;
}
