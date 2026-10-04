import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SystemUI from "expo-system-ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import type { FontScale, FontType, ThemeName } from "@/types/opencode";
import {
  scaleTypography,
  themeDefinitions,
  themeNames,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeSpacing,
  type ThemeTypography,
} from "@/theme/palettes";

// Re-exported so existing `import { … } from "@/context/ThemeContext"` call
// sites keep working. The declarations themselves live in `@/theme/palettes`,
// which has no React Native dependency and is therefore unit-testable.
export type {
  ThemeColors,
  ThemeDefinition,
  ThemeSpacing,
  ThemeTypography,
} from "@/theme/palettes";

const THEME_STORAGE_KEY = "@desk-escape/theme";
const SYNC_THEME_KEY = "@desk-escape/sync-theme";
const FONT_TYPE_KEY = "@desk-escape/font-type";

interface ThemeContextValue {
  themeName: ThemeName;
  theme: ThemeDefinition;
  setThemeName: (name: ThemeName) => void;
  colors: ThemeColors;
  spacing: ThemeSpacing;
  typography: ThemeTypography;
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  fontType: FontType;
  setFontType: (type: FontType) => void;
  syncTheme: boolean;
  setSyncTheme: (enabled: boolean) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const FONT_SCALE_KEY = "@desk-escape/font-scale";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState<ThemeName>("oled-black");
  const [fontScale, setFontScaleState] = useState<FontScale>(1);
  const [fontType, setFontTypeState] = useState<FontType>("system");
  const [syncTheme, setSyncThemeState] = useState(false);

  useEffect(() => {
    void (async () => {
      const [storedTheme, storedScale, storedSync, storedFontType] =
        await Promise.all([
          AsyncStorage.getItem(THEME_STORAGE_KEY),
          AsyncStorage.getItem(FONT_SCALE_KEY),
          AsyncStorage.getItem(SYNC_THEME_KEY),
          AsyncStorage.getItem(FONT_TYPE_KEY),
        ]);

      if (storedTheme && themeNames.includes(storedTheme as ThemeName)) {
        setThemeNameState(storedTheme as ThemeName);
      }

      if (
        storedScale === "0.85" ||
        storedScale === "1" ||
        storedScale === "1.15" ||
        storedScale === "1.3"
      ) {
        setFontScaleState(Number(storedScale) as FontScale);
      }

      if (storedSync !== null) {
        setSyncThemeState(storedSync === "true");
      }

      if (storedFontType === "system" || storedFontType === "mono") {
        setFontTypeState(storedFontType as FontType);
      }
    })();
  }, []);

  const colorScheme = useColorScheme();

  useEffect(() => {
    if (syncTheme && colorScheme) {
      const target = colorScheme === "dark" ? "dev-dark" : "dev-light";
      if (themeName !== target) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setThemeNameState(target);
        void AsyncStorage.setItem(THEME_STORAGE_KEY, target);
      }
    }
  }, [syncTheme, colorScheme, themeName]);

  const setThemeName = useCallback(
    (name: ThemeName) => {
      setThemeNameState(name);
      void AsyncStorage.setItem(THEME_STORAGE_KEY, name);
      if (syncTheme) {
        setSyncThemeState(false);
        void AsyncStorage.setItem(SYNC_THEME_KEY, "false");
      }
    },
    [syncTheme],
  );

  const setFontScale = useCallback((scale: FontScale) => {
    setFontScaleState(scale);
    void AsyncStorage.setItem(FONT_SCALE_KEY, String(scale));
  }, []);

  const setFontType = useCallback((type: FontType) => {
    setFontTypeState(type);
    void AsyncStorage.setItem(FONT_TYPE_KEY, type);
  }, []);

  const setSyncTheme = useCallback(async (enabled: boolean) => {
    setSyncThemeState(enabled);
    void AsyncStorage.setItem(SYNC_THEME_KEY, String(enabled));
  }, []);

  const theme = themeDefinitions[themeName];
  const scaledTypography = useMemo(
    () => scaleTypography(fontScale, fontType),
    [fontScale, fontType],
  );

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.colors.background);
  }, [theme.colors.background]);

  const value = useMemo(
    () => ({
      themeName,
      theme: { ...theme, typography: scaledTypography },
      setThemeName,
      colors: theme.colors,
      spacing: theme.spacing,
      typography: scaledTypography,
      fontScale,
      setFontScale,
      fontType,
      setFontType,
      syncTheme,
      setSyncTheme,
    }),
    [
      fontScale,
      scaledTypography,
      setFontScale,
      fontType,
      setFontType,
      setThemeName,
      setSyncTheme,
      syncTheme,
      theme,
      themeName,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider.");
  }
  return context;
}
