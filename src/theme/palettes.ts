import type { FontType, ThemeName } from "@/types/opencode";

/**
 * Theme palettes.
 *
 * Deliberately free of React and React Native imports so the palettes can be
 * asserted in `__tests__` and measured at build time. They used to live inside
 * `ThemeContext.tsx`, which made them untestable — `bun test` cannot load
 * `react-native`, so anything importing the context transitively pulled in the
 * whole runtime and died on `index.js.flow`. A data table with no behaviour does
 * not belong behind a hook.
 */

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  /**
   * Foreground for anything drawn on top of `accent` — button labels, icons,
   * spinners.
   *
   * This token did not exist. Thirteen call sites hardcoded `#04111A` instead,
   * which is correct for the seven dark palettes (their accents are light and
   * saturated) and wrong for `dev-light`, whose accent is a dark blue. That is
   * not a hypothetical: `syncTheme` auto-selects `dev-light` on a device in
   * light mode, and every accent button loses its label. Accent colour and the
   * colour on accent are one decision, so they belong in the same palette.
   */
  onAccent: string;
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
  fontFamily: string;
}

export interface ThemeDefinition {
  name: ThemeName;
  label: string;
  statusBar: "light" | "dark";
  colors: ThemeColors;
  spacing: ThemeSpacing;
  typography: ThemeTypography;
}

export const sharedSpacing: ThemeSpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const baseTypography: ThemeTypography = {
  title: 20,
  subtitle: 16,
  body: 14,
  caption: 12,
  mono: 13,
  fontFamily: "System",
};

export function scaleTypography(
  scale: number,
  fontType: FontType,
): ThemeTypography {
  return {
    title: Math.round(baseTypography.title * scale),
    subtitle: Math.round(baseTypography.subtitle * scale),
    body: Math.round(baseTypography.body * scale),
    caption: Math.round(baseTypography.caption * scale),
    mono: Math.round(baseTypography.mono * scale),
    fontFamily: fontType === "mono" ? "monospace" : "System",
  };
}

export const themeNames: ThemeName[] = [
  "oled-black",
  "dev-dark",
  "dev-light",
  "midnight-purple",
  "solarized-dark",
  "nord",
  "high-contrast",
  "hacker",
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
      onAccent: "#04111A",
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
      onAccent: "#04111A",
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
      // The only palette whose accent is dark enough to need a light foreground.
      // Every other theme gets the near-black that `#04111A` hardcoding produced.
      onAccent: "#FFFFFF",
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
      onAccent: "#04111A",
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
      // Solarized's own base1 (#93A1A1) reads fine on the dark surfaces but only
      // manages 4.00:1 on `surfaceElevated` (#0A4452), which is where the pickers
      // and modals now paint. Lightened to clear 4.5:1; still recognisably base1.
      textMuted: "#B5C2C2",
      accent: "#2AA198",
      onAccent: "#04111A",
      accentMuted: "#134E4A",
      // Solarized's own green/yellow fail 4.5:1 on `surfaceElevated` (3.34:1),
      // and its red manages only 2.31:1 there — unreadable for an error message,
      // which is what `danger` is painted as in 22 of its 29 call sites. Lightened
      // along their own hue to clear the bar; see §5.4b.
      success: "#9DB332",
      danger: "#FF8679",
      warning: "#CEA33B",
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
      onAccent: "#04111A",
      accentMuted: "#2E4A59",
      success: "#A9C591",
      danger: "#F7A7AC",
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
      onAccent: "#04111A",
      accentMuted: "#3D3D00",
      success: "#00FF66",
      danger: "#FF4444",
      warning: "#FFAA00",
      pillBackground: "rgba(0, 0, 0, 0.95)",
      inputBackground: "#000000",
    },
  },
  hacker: {
    name: "hacker",
    label: "Hacker",
    statusBar: "light",
    spacing: sharedSpacing,
    typography: baseTypography,
    colors: {
      background: "#0A0A0A",
      surface: "#0F1A0F",
      surfaceElevated: "#142014",
      border: "#00FF00",
      text: "#00FF00",
      textMuted: "#00CC00",
      accent: "#00FF00",
      onAccent: "#04111A",
      accentMuted: "#003300",
      success: "#00FF00",
      // Pure #FF0000 is 4.21:1 on `surfaceElevated` (#142014). Nudged just enough
      // to clear 4.5:1; still reads as the flat primary red this theme wants.
      danger: "#FE3124",
      warning: "#FFFF00",
      pillBackground: "rgba(10, 26, 10, 0.92)",
      inputBackground: "#0A0A0A",
    },
  },
};
