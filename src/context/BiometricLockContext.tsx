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
}

export const BiometricLockContext =
  createContext<BiometricLockContextValue | null>(null);

export function BiometricLockProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { state, authenticate, setEnabled, initialized, appActive } =
    useBiometricLock();

  return (
    <BiometricLockContext.Provider
      value={{
        lockState: state,
        authenticate,
        setBiometricLockEnabled: setEnabled,
        initialized,
        appActive,
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
