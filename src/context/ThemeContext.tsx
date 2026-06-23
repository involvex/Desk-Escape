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
import type { FontScale, ThemeName } from "@/types/opencode";

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

const baseTypography: ThemeTypography = {
  title: 20,
  subtitle: 16,
  body: 14,
  caption: 12,
  mono: 13,
};

function scaleTypography(scale: number): ThemeTypography {
  return {
    title: Math.round(baseTypography.title * scale),
    subtitle: Math.round(baseTypography.subtitle * scale),
    body: Math.round(baseTypography.body * scale),
    caption: Math.round(baseTypography.caption * scale),
    mono: Math.round(baseTypography.mono * scale),
  };
}

const themeNames: ThemeName[] = [
  "oled-black",
  "dev-dark",
  "dev-light",
  "midnight-purple",
  "solarized-dark",
  "nord",
  "high-contrast",
];

export const themeDefinitions: Record<ThemeName, ThemeDefinition> = {
  "oled-black": {
    name: "oled-black",
    label: "OLED Black",
    statusBar: "light",
    spacing: sharedSpacing,
    typography: baseTypography,
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
    typography: baseTypography,
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
    typography: baseTypography,
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
  "midnight-purple": {
    name: "midnight-purple",
    label: "Midnight Purple",
    statusBar: "light",
    spacing: sharedSpacing,
    typography: baseTypography,
    colors: {
      background: "#0B0614",
      surface: "#140A22",
      surfaceElevated: "#1C1030",
      border: "#3B2A5C",
      text: "#F3E8FF",
      textMuted: "#C4B5FD",
      accent: "#A78BFA",
      accentMuted: "#4C1D95",
      success: "#34D399",
      danger: "#FB7185",
      warning: "#FBBF24",
      pillBackground: "rgba(20, 10, 34, 0.92)",
      inputBackground: "#12081F",
    },
  },
  "solarized-dark": {
    name: "solarized-dark",
    label: "Solarized Dark",
    statusBar: "light",
    spacing: sharedSpacing,
    typography: baseTypography,
    colors: {
      background: "#002B36",
      surface: "#073642",
      surfaceElevated: "#0A4452",
      border: "#586E75",
      text: "#EEE8D5",
      textMuted: "#93A1A1",
      accent: "#2AA198",
      accentMuted: "#134E4A",
      success: "#859900",
      danger: "#DC322F",
      warning: "#B58900",
      pillBackground: "rgba(7, 54, 66, 0.92)",
      inputBackground: "#002B36",
    },
  },
  nord: {
    name: "nord",
    label: "Nord",
    statusBar: "light",
    spacing: sharedSpacing,
    typography: baseTypography,
    colors: {
      background: "#2E3440",
      surface: "#3B4252",
      surfaceElevated: "#434C5E",
      border: "#4C566A",
      text: "#ECEFF4",
      textMuted: "#D8DEE9",
      accent: "#88C0D0",
      accentMuted: "#2E4A59",
      success: "#A3BE8C",
      danger: "#BF616A",
      warning: "#EBCB8B",
      pillBackground: "rgba(59, 66, 82, 0.92)",
      inputBackground: "#2E3440",
    },
  },
  "high-contrast": {
    name: "high-contrast",
    label: "High Contrast",
    statusBar: "light",
    spacing: sharedSpacing,
    typography: baseTypography,
    colors: {
      background: "#000000",
      surface: "#111111",
      surfaceElevated: "#1A1A1A",
      border: "#FFFFFF",
      text: "#FFFFFF",
      textMuted: "#D4D4D4",
      accent: "#FFFF00",
      accentMuted: "#3D3D00",
      success: "#00FF66",
      danger: "#FF4444",
      warning: "#FFAA00",
      pillBackground: "rgba(0, 0, 0, 0.95)",
      inputBackground: "#000000",
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
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const FONT_SCALE_KEY = "@desk-escape/font-scale";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState<ThemeName>("oled-black");
  const [fontScale, setFontScaleState] = useState<FontScale>(1);

  useEffect(() => {
    void (async () => {
      const [storedTheme, storedScale] = await Promise.all([
        AsyncStorage.getItem(THEME_STORAGE_KEY),
        AsyncStorage.getItem(FONT_SCALE_KEY),
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
    })();
  }, []);

  const setThemeName = useCallback((name: ThemeName) => {
    setThemeNameState(name);
    void AsyncStorage.setItem(THEME_STORAGE_KEY, name);
  }, []);

  const setFontScale = useCallback((scale: FontScale) => {
    setFontScaleState(scale);
    void AsyncStorage.setItem(FONT_SCALE_KEY, String(scale));
  }, []);

  const theme = themeDefinitions[themeName];
  const scaledTypography = useMemo(
    () => scaleTypography(fontScale),
    [fontScale],
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
    }),
    [fontScale, scaledTypography, setFontScale, setThemeName, theme, themeName],
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
