import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ScreenOrientation from "expo-screen-orientation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useWindowDimensions } from "react-native";
import type { OrientationMode } from "@/types/opencode";

const ORIENTATION_STORAGE_KEY = "@desk-escape/orientation";

interface OrientationContextValue {
  mode: OrientationMode;
  setMode: (mode: OrientationMode) => void;
  isLandscape: boolean;
}

const OrientationContext = createContext<OrientationContextValue | undefined>(
  undefined,
);

async function applyOrientationMode(mode: OrientationMode): Promise<void> {
  switch (mode) {
    case "portrait":
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
      break;
    case "landscape":
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE,
      );
      break;
    case "auto":
      await ScreenOrientation.unlockAsync();
      break;
  }
}

export function OrientationProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<OrientationMode>("auto");
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  useEffect(() => {
    void (async () => {
      const stored = await AsyncStorage.getItem(ORIENTATION_STORAGE_KEY);
      if (
        stored === "portrait" ||
        stored === "landscape" ||
        stored === "auto"
      ) {
        setModeState(stored);
        await applyOrientationMode(stored);
      } else {
        await applyOrientationMode("auto");
      }
    })();
  }, []);

  const setMode = useCallback((next: OrientationMode) => {
    setModeState(next);
    void AsyncStorage.setItem(ORIENTATION_STORAGE_KEY, next);
    void applyOrientationMode(next);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      isLandscape,
    }),
    [isLandscape, mode, setMode],
  );

  return (
    <OrientationContext.Provider value={value}>
      {children}
    </OrientationContext.Provider>
  );
}

export function useOrientation(): OrientationContextValue {
  const context = useContext(OrientationContext);
  if (!context) {
    throw new Error("useOrientation must be used within OrientationProvider.");
  }
  return context;
}
