# Biometric App Lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Face ID / fingerprint authentication before revealing the workspace, with a toggle in Settings.

**Architecture:** A `useBiometricLock` hook handles biometric authentication using `expo-local-authentication`. The lock preference (enabled/disabled) is stored in `SecureStore`. On app launch, the `ConnectionProvider` checks if biometrics are enabled and a biometric gate is shown before the Workspace screen.

**Tech Stack:** React Native, Expo SDK 57, `expo-local-authentication`, `expo-secure-store`, TypeScript ~6.0.3

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/context/BiometricLockContext.tsx` | Create | Provider that manages biometric lock state |
| `src/hooks/useBiometricLock.ts` | Create | Hook wrapping `expo-local-authentication` API |
| `src/navigation/RootNavigator.tsx` | Modify | Show biometric gate before Workspace |
| `src/screens/SettingsScreen.tsx` | Modify | Add biometric lock toggle |
| `src/types/opencode.ts` | Modify | Add BiometricLockState type |

---

## Global Constraints

- Expo SDK 57 (`~57.0.8`), React Native 0.86.0, TypeScript ~6.0.3
- Use `bun` for installs/scripts; run `bun run typecheck` and `bun run lint` after changes
- `expo-local-authentication` version `~57.0.2` (installed)
- `expo-secure-store` is already a dependency
- AsyncStorage key prefix: `@desk-escape/`
- Do not git commit unless explicitly requested

---

### Task 1: Define `BiometricLockState` type

**Files:**
- Modify: `src/types/opencode.ts`

**Interfaces:**
- Produces: `BiometricLockState` type used by the lock context

- [ ] **Step 1: Add `BiometricLockState` to `src/types/opencode.ts`**

Append at end of file:

```typescript
export type BiometricLockState = "locked" | "unlocking" | "unlocked";
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 2: Create `useBiometricLock` hook

**Files:**
- Create: `src/hooks/useBiometricLock.ts`

**Interfaces:**
- Consumes: `expo-local-authentication`, `expo-secure-store`
- Produces: `useBiometricLock` hook returning `{ state, authenticate, setEnabled }`

- [ ] **Step 1: Create `src/hooks/useBiometricLock.ts`**

```typescript
import { useCallback, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const BIOMETRIC_KEY = "@desk-escape/biometric-enabled";

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
  const [state, setState] = useState<"locked" | "unlocking" | "unlocked">("locked");

  const authenticate = useCallback(async (): Promise<boolean> => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;

    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return false;

    setState("unlocking");

    try {
      const result = await LocalAuthentication.authenticateAsync({
        prompt: "Authenticate to unlock Desk Escape",
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

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      await setBiometricEnabled(enabled);
      if (!enabled) {
        setState("unlocked");
      } else {
        setState("locked");
      }
    },
    [],
  );

  return { state, authenticate, setEnabled };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Verify lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useBiometricLock.ts src/types/opencode.ts
git commit -m "feat: add useBiometricLock hook with SecureStore persistence"
```

---

### Task 3: Create `BiometricLockProvider` and integrate into app

**Files:**
- Create: `src/context/BiometricLockContext.tsx`
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `useBiometricLock` from Task 2, `BiometricLockState` type from Task 1
- Produces: `BiometricLockProvider` wrapping the app shell; biolock state exposed via context

- [ ] **Step 1: Create `src/context/BiometricLockContext.tsx`**

```typescript
import React, { createContext, useContext } from "react";
import { useBiometricLock } from "@/hooks/useBiometricLock";
import type { BiometricLockState } from "@/types/opencode";

interface BiometricLockContextValue {
  lockState: BiometricLockState;
  authenticate: () => Promise<boolean>;
  setBiometricLockEnabled: (enabled: boolean) => Promise<void>;
}

export const BiometricLockContext = createContext<BiometricLockContextValue | null>(null);

export function BiometricLockProvider({ children }: { children: React.ReactNode }) {
  const { state, authenticate, setEnabled } = useBiometricLock();

  return (
    <BiometricLockContext.Provider value={{ lockState: state, authenticate, setBiometricLockEnabled: setEnabled }}>
      {children}
    </BiometricLockContext.Provider>
  );
}

export function useBiometricLockContext(): BiometricLockContextValue {
  const context = useContext(BiometricLockContext);
  if (!context) {
    throw new Error("useBiometricLockContext must be used within a BiometricLockProvider");
  }
  return context;
}
```

- [ ] **Step 2: Wrap app shell with `BiometricLockProvider` in `App.tsx`**

In `App.tsx`, add `BiometricLockProvider` above `ThemeProvider` (or below, in the provider stack order — after `ConnectionProvider` so the lock gates the workspace):

```tsx
<GestureHandlerRootView style={styles.container}>
  <KeyboardProvider>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <PreferencesProvider>
            <OrientationProvider>
              <ConnectionProvider>
                <BiometricLockProvider>
                  <PermissionProvider>
                    <AppShell />
                  </PermissionProvider>
                </BiometricLockProvider>
              </ConnectionProvider>
            </OrientationProvider>
          </PreferencesProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  </KeyboardProvider>
</GestureHandlerRootView>
```

Add import: `import { BiometricLockProvider } from "@/context/BiometricLockContext";`

- [ ] **Step 3: Handle biometric gate in RootNavigator**

Modify `src/navigation/RootNavigator.tsx` to show a biometric gate before the Workspace screen.

The simplest approach: add a `BiometricGate` component that checks `lockState` and calls `authenticate` if locked. When `unlocked`, render the normal navigation stack. When `locked`, show a gate screen (or the biometrics prompt is triggered on the Workspace screen itself).

Simpler approach — handle it in `WorkspaceScreen.tsx`: check `lockState === "locked"` at mount, call `authenticate()`, and if authentication fails, go back to ConnectionScreen. If it succeeds, proceed normally.

**Revised approach — handle in WorkspaceScreen:**

In `WorkspaceScreen.tsx`, add at the top of the component:

```typescript
const { lockState, authenticate } = useBiometricLockContext();
const navigation = useNavigation();

useEffect(() => {
  if (lockState === "locked") {
    void authenticate().then((success) => {
      if (!success) {
        navigation.navigate("Connection");
      }
    });
  }
}, [lockState, authenticate, navigation]);
```

Wait — this approach creates an infinite loop if auth keeps happening. Let me think again.

Better approach: The `BiometricLockProvider` wraps everything, and the lock state is initialized as "locked" if biometrics are enabled. When the Workspace screen mounts, it checks the lock state and triggers authentication. The result is stored in the lock state which determines whether the workspace content is visible.

Actually, the simplest and most robust approach:

1. `BiometricLockProvider` renders its children normally.
2. `WorkspaceScreen` checks `lockState` on mount.
3. If locked, it triggers `authenticate()` and shows a loading/locked overlay.
4. If auth succeeds, the overlay dismisses and normal workspace is shown.
5. If auth fails, navigate back to ConnectionScreen.
6. The biometric lock status persists in SecureStore.

Let me revise the implementation. The `WorkspaceScreen` should show a biometric prompt overlay when locked.

[ ] **Step 3 revised**: Modify `WorkspaceScreen.tsx`

Add a biometric gate overlay that appears when `lockState === "locked"`, triggers `authenticate()`, and handles the result:

```tsx
// At the top of WorkspaceScreen component
const { lockState, authenticate } = useBiometricLockContext();
const navigation = useNavigation();
const [authRequired, setAuthRequired] = useState(false);

useEffect(() => {
  if (lockState === "locked") {
    setAuthRequired(true);
  }
}, [lockState]);

useEffect(() => {
  if (!authRequired) return;

  void authenticate().then((success) => {
    setAuthRequired(false);
    if (!success) {
      navigation.reset({ index: 0, routes: [{ name: "Connection" }] });
    }
  });
}, [authRequired, authenticate, navigation]);
```

And conditionally render a gate overlay:

```tsx
if (lockState === "locked" && authRequired) {
  return (
    <View style={styles.gateOverlay}>
      <Text>Authenticate to access workspace</Text>
      <ActivityIndicator />
    </View>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Verify lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/context/BiometricLockContext.tsx src/screens/WorkspaceScreen.tsx src/App.tsx
git commit -m "feat: add biometric lock provider and workspace gate"
```

---

### Task 4: Add biometric toggle to SettingsScreen

**Files:**
- Modify: `src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `useBiometricLockContext` from `BiometricLockContext`
- Produces: A toggle row in Settings for "Biometric Lock"

- [ ] **Step 1: Read `SettingsScreen.tsx`** to find where the settings rows are rendered

- [ ] **Step 2: Add biometric lock toggle**

Find the `useConnection()` usage or similar to add `useBiometricLockContext`. Add a new settings row:

```tsx
<SettingRow
  title="Biometric Lock"
  value={biometricEnabled ? "On" : "Off"}
  onPress={() => void setBiometricLockEnabled(!biometricEnabled)}
  accessory="switch"
/>
```

Or use a `Switch` component from `react-native` or a custom toggle.

- [ ] **Step 3: Handle biometric capability check** — if biometrics are not available on the device, the toggle should show a message or be disabled

- [ ] **Step 4: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Verify lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/screens/SettingsScreen.tsx
git commit -m "feat: add biometric lock toggle to Settings"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run full lint**

Run: `bun run lint`
Expected: PASS (only pre-existing `UnifiedDiff.tsx:221` warning)

- [ ] **Step 3: Run format**

Run: `bun run format`
Expected: All files unchanged or reformatted consistently

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A && git commit -m "chore: format after biometric lock implementation"
```
