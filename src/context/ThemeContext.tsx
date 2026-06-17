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
import type { ThemeName } from "@/types/opencode";

const THEME_STORAGE_KEY = "@desk-escape/theme";

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentMuted: string;
  success: string;
  danger: string;
  warning: string;
  pillBackground: string;
  inputBackground: string;
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

export interface ThemeTypography {
  title: number;
  subtitle: number;
  body: number;
  caption: number;
  mono: number;
}

export interface ThemeDefinition {
  name: ThemeName;
  label: string;
  statusBar: "light" | "dark";
  colors: ThemeColors;
  spacing: ThemeSpacing;
  typography: ThemeTypography;
}

const sharedSpacing: ThemeSpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

const sharedTypography: ThemeTypography = {
  title: 20,
  subtitle: 16,
  body: 14,
  caption: 12,
  mono: 13,
};

export const themeDefinitions: Record<ThemeName, ThemeDefinition> = {
  "oled-black": {
    name: "oled-black",
    label: "OLED Black",
    statusBar: "light",
    spacing: sharedSpacing,
    typography: sharedTypography,
    colors: {
      background: "#000000",
      surface: "#0A0A0A",
      surfaceElevated: "#141414",
      border: "#262626",
      text: "#F5F5F5",
      textMuted: "#9CA3AF",
      accent: "#22D3EE",
      accentMuted: "#155E75",
      success: "#34D399",
      danger: "#F87171",
      warning: "#FBBF24",
      pillBackground: "rgba(10, 10, 10, 0.88)",
      inputBackground: "#111111",
    },
  },
  "dev-dark": {
    name: "dev-dark",
    label: "Dev Dark",
    statusBar: "light",
    spacing: sharedSpacing,
    typography: sharedTypography,
    colors: {
      background: "#0D1117",
      surface: "#161B22",
      surfaceElevated: "#1C2128",
      border: "#30363D",
      text: "#E6EDF3",
      textMuted: "#8B949E",
      accent: "#58A6FF",
      accentMuted: "#1F3A5F",
      success: "#3FB950",
      danger: "#F85149",
      warning: "#D29922",
      pillBackground: "rgba(22, 27, 34, 0.92)",
      inputBackground: "#0D1117",
    },
  },
  "dev-light": {
    name: "dev-light",
    label: "Dev Light",
    statusBar: "dark",
    spacing: sharedSpacing,
    typography: sharedTypography,
    colors: {
      background: "#F6F8FA",
      surface: "#FFFFFF",
      surfaceElevated: "#FFFFFF",
      border: "#D0D7DE",
      text: "#1F2328",
      textMuted: "#656D76",
      accent: "#0969DA",
      accentMuted: "#DDF4FF",
      success: "#1A7F37",
      danger: "#CF222E",
      warning: "#9A6700",
      pillBackground: "rgba(255, 255, 255, 0.94)",
      inputBackground: "#FFFFFF",
    },
  },
};

interface ThemeContextValue {
  themeName: ThemeName;
  theme: ThemeDefinition;
  setThemeName: (name: ThemeName) => void;
  colors: ThemeColors;
  spacing: ThemeSpacing;
  typography: ThemeTypography;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState<ThemeName>("oled-black");

  useEffect(() => {
    void (async () => {
      const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (
        stored === "oled-black" ||
        stored === "dev-dark" ||
        stored === "dev-light"
      ) {
        setThemeNameState(stored);
      }
    })();
  }, []);

  const setThemeName = useCallback((name: ThemeName) => {
    setThemeNameState(name);
    void AsyncStorage.setItem(THEME_STORAGE_KEY, name);
  }, []);

  const theme = themeDefinitions[themeName];

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.colors.background);
  }, [theme.colors.background]);

  const value = useMemo(
    () => ({
      themeName,
      theme,
      setThemeName,
      colors: theme.colors,
      spacing: theme.spacing,
      typography: theme.typography,
    }),
    [theme, themeName, setThemeName],
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
