# Settings Menu on Home Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings gear icon to the ProviderPickerScreen (home screen), enhance the existing SettingsScreen with a "Hacker" theme, font type option, app version display, and repo link.

**Architecture:** Extend the existing ThemeContext with a new "hacker" theme definition and a font type preference (system default vs monospace). Add a settings gear icon to ProviderPickerScreen that navigates to the existing SettingsScreen. Enhance SettingsScreen with a new "Font type" section, an "About" section showing app version and repo link.

**Tech Stack:** React Native, Expo SDK 57, React Navigation, AsyncStorage, lucide-react-native icons

## Global Constraints

- Expo SDK 57, React Native 0.86.2, React 19.2.3
- Use `@/*` path alias mapping to `./src/*`
- All screens use `headerShown: false`, manual headers with lucide icons
- Theme colors via `useTheme()` hook, styles via `useMemo(() => StyleSheet.create({...}), [colors, spacing, typography])`
- AsyncStorage for persistence
- Pin `react-native-gesture-handler` to exact `2.31.1` (no changes needed here)

---

## File Structure

| File                                   | Action | Purpose                                                        |
| -------------------------------------- | ------ | -------------------------------------------------------------- |
| `src/types/opencode.ts`                | Modify | Add `"hacker"` to `ThemeName` union, add `FontType` type       |
| `src/context/ThemeContext.tsx`         | Modify | Add hacker theme definition, add font type state + persistence |
| `src/screens/ProviderPickerScreen.tsx` | Modify | Add settings gear icon button                                  |
| `src/screens/SettingsScreen.tsx`       | Modify | Add Font type section, About section (version + repo)          |

---

### Task 1: Add "hacker" theme and FontType to types

**Files:**

- Modify: `src/types/opencode.ts:20-29`

**Interfaces:**

- Produces: `"hacker"` added to `ThemeName` union, `FontType` type (`"system" | "mono"`)

- [ ] **Step 1: Add "hacker" to ThemeName union**

```typescript
// src/types/opencode.ts — lines 20-27
export type ThemeName =
  | "oled-black"
  | "dev-dark"
  | "dev-light"
  | "midnight-purple"
  | "solarized-dark"
  | "nord"
  | "high-contrast"
  | "hacker";
```

- [ ] **Step 2: Add FontType type after FontScale**

```typescript
// src/types/opencode.ts — after line 29
export type FontType = "system" | "mono";
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no errors — existing code doesn't reference the new values yet)

---

### Task 2: Add hacker theme definition and font type to ThemeContext

**Files:**

- Modify: `src/context/ThemeContext.tsx:13,85-93,95-250,252-263,267-299,314-327,329-366`

**Interfaces:**

- Consumes: `"hacker"` ThemeName from Task 1, `FontType` from Task 1
- Produces: `fontType` + `setFontType` in ThemeContext, hacker theme colors applied

- [ ] **Step 1: Update imports to include FontType**

```typescript
// src/context/ThemeContext.tsx — line 13
import type { FontScale, FontType, ThemeName } from "@/types/opencode";
```

- [ ] **Step 2: Add STORAGE_KEY for font type**

```typescript
// src/context/ThemeContext.tsx — after line 16
const FONT_TYPE_KEY = "@desk-escape/font-type";
```

- [ ] **Step 3: Add "hacker" to themeNames array**

```typescript
// src/context/ThemeContext.tsx — lines 85-93
const themeNames: ThemeName[] = [
  "oled-black",
  "dev-dark",
  "dev-light",
  "midnight-purple",
  "solarized-dark",
  "nord",
  "high-contrast",
  "hacker",
];
```

- [ ] **Step 4: Add hacker theme definition to themeDefinitions**

Add after the `"high-contrast"` entry (before the closing `};` of themeDefinitions):

```typescript
  "hacker": {
    name: "hacker",
    label: "Hacker",
    statusBar: "light",
    spacing: sharedSpacing,
    typography: baseTypography,
    colors: {
      background: "#0A0A0A",
      surface: "#111111",
      surfaceElevated: "#1A1A1A",
      border: "#00FF41",
      text: "#00FF41",
      textMuted: "#00CC33",
      accent: "#00FF41",
      accentMuted: "#003300",
      success: "#00FF41",
      danger: "#FF0000",
      warning: "#FFD700",
      pillBackground: "rgba(10, 10, 10, 0.95)",
      inputBackground: "#0D0D0D",
    },
  },
```

- [ ] **Step 5: Add FontType to ThemeContextValue interface**

```typescript
// src/context/ThemeContext.tsx — lines 252-263
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
```

- [ ] **Step 6: Add fontType state + persistence in ThemeProvider**

In the `ThemeProvider` function, add state initialization after the existing useState calls (around line 271):

```typescript
const [fontType, setFontTypeState] = useState<FontType>("system");
```

Add to the useEffect that loads stored values (around line 276-298), inside the `Promise.all`:

```typescript
// Add FONT_TYPE_KEY to the Promise.all
const [storedTheme, storedScale, storedSync, storedFontType] =
  await Promise.all([
    AsyncStorage.getItem(THEME_STORAGE_KEY),
    AsyncStorage.getItem(FONT_SCALE_KEY),
    AsyncStorage.getItem(SYNC_THEME_KEY),
    AsyncStorage.getItem(FONT_TYPE_KEY),
  ]);

// Add after the syncTheme block (around line 296)
if (storedFontType === "system" || storedFontType === "mono") {
  setFontTypeState(storedFontType as FontType);
}
```

Add the setter callback after `setFontScale` (around line 322):

```typescript
const setFontType = useCallback((type: FontType) => {
  setFontTypeState(type);
  void AsyncStorage.setItem(FONT_TYPE_KEY, type);
}, []);
```

- [ ] **Step 7: Add fontType to the context value**

Add `fontType` and `setFontType` to the `value` useMemo (around line 339-362):

```typescript
const value = useMemo(
  () => ({
    // ... existing fields
    fontType,
    setFontType,
    // ... rest
  }),
  [
    // ... existing deps
    fontType,
    setFontType,
  ],
);
```

- [ ] **Step 8: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 3: Add settings gear icon to ProviderPickerScreen

**Files:**

- Modify: `src/screens/ProviderPickerScreen.tsx:1-6,25-81,83-110`

**Interfaces:**

- Consumes: `navigation.navigate("Settings")` from RootNavigator (already defined)
- Produces: Settings gear icon in top-right corner of ProviderPickerScreen

- [ ] **Step 1: Add Settings icon import and navigation type**

```typescript
// src/screens/ProviderPickerScreen.tsx — update imports
import { Settings } from "lucide-react-native";
```

Update the Navigation type to include "Settings":

```typescript
type Navigation = NativeStackNavigationProp<
  RootStackParamList,
  "ProviderPicker"
>;
```

(Navigation type already works since RootStackParamList includes Settings)

- [ ] **Step 2: Add settings button styles**

Add to the StyleSheet (inside the `useMemo`):

```typescript
header: {
  flexDirection: "row",
  justifyContent: "flex-end",
  marginBottom: spacing.md,
},
settingsButton: {
  padding: spacing.sm,
},
```

- [ ] **Step 3: Add settings button to the JSX**

Wrap the existing content and add a settings button at the top:

```typescript
return (
  <View style={styles.container}>
    <View style={styles.header}>
      <Pressable
        onPress={() => navigation.navigate("Settings")}
        style={styles.settingsButton}
        hitSlop={8}
      >
        <Settings color={colors.textMuted} size={22} />
      </Pressable>
    </View>

    <Text style={styles.title}>Desk Escape</Text>
    <Text style={styles.subtitle}>Choose your agent backend</Text>

    {/* ... existing Pressable cards unchanged ... */}
  </View>
);
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 4: Add Font type section and About section to SettingsScreen

**Files:**

- Modify: `src/screens/SettingsScreen.tsx:16,27-31,53-64,114-265,340-387,612-616`

**Interfaces:**

- Consumes: `fontType`, `setFontType` from ThemeContext (Task 2)
- Produces: Font type chip selector, About section with version + repo link

- [ ] **Step 1: Add imports**

```typescript
// src/screens/SettingsScreen.tsx — add to lucide imports (line 16)
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Trash2,
} from "lucide-react-native";
```

Add FontType to the type imports:

```typescript
// src/screens/SettingsScreen.tsx — lines 27-31
import type {
  FontScale,
  FontType,
  OrientationMode,
  PromptPreset,
} from "@/types/opencode";
```

- [ ] **Step 2: Add fontTypeOptions constant**

After the `fontScaleOptions` constant (around line 51):

```typescript
const fontTypeOptions: { id: FontType; label: string }[] = [
  { id: "system", label: "System" },
  { id: "mono", label: "Monospace" },
];
```

- [ ] **Step 3: Destructure fontType and setFontType from useTheme**

Update the useTheme destructuring (around line 54-64):

```typescript
const {
  colors,
  spacing,
  typography,
  themeName,
  setThemeName,
  fontScale,
  setFontScale,
  fontType,
  setFontType,
  syncTheme,
  setSyncTheme,
} = useTheme();
```

- [ ] **Step 4: Add fontType styles**

Add to the StyleSheet:

```typescript
aboutRow: {
  alignItems: "center",
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: 12,
  borderWidth: 1,
  flexDirection: "row",
  justifyContent: "space-between",
  marginBottom: spacing.sm,
  padding: spacing.md,
},
aboutLabel: {
  color: colors.textMuted,
  fontSize: typography.body,
},
aboutValue: {
  color: colors.text,
  fontSize: typography.body,
  fontWeight: "600",
},
repoLink: {
  alignItems: "center",
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: 12,
  borderWidth: 1,
  flexDirection: "row",
  gap: spacing.sm,
  justifyContent: "center",
  marginTop: spacing.sm,
  padding: spacing.md,
},
repoLinkText: {
  color: colors.accent,
  fontSize: typography.body,
  fontWeight: "600",
},
```

- [ ] **Step 5: Add Font type section after Font size section**

Insert after the Font size section (around line 387):

```tsx
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Font type</Text>
  <View style={styles.chipRow}>
    {fontTypeOptions.map((option) => (
      <Pressable
        key={option.id}
        onPress={() => setFontType(option.id)}
        style={[styles.chip, fontType === option.id ? styles.chipActive : null]}
      >
        <Text style={styles.chipText}>{option.label}</Text>
      </Pressable>
    ))}
  </View>
</View>
```

- [ ] **Step 6: Add About section at the bottom of ScrollView**

Add before the closing `</ScrollView>` (around line 613), after the advanced config section:

```tsx
<View style={styles.section}>
  <Text style={styles.sectionTitle}>About</Text>
  <View style={styles.aboutRow}>
    <Text style={styles.aboutLabel}>Version</Text>
    <Text style={styles.aboutValue}>1.0.1</Text>
  </View>
  <Pressable
    onPress={() => {
      import("expo-web-browser").then(({ openBrowserAsync }) => {
        openBrowserAsync("https://github.com/involvex/Desk-Escape");
      });
    }}
    style={styles.repoLink}
  >
    <ExternalLink color={colors.accent} size={16} />
    <Text style={styles.repoLinkText}>View on GitHub</Text>
  </Pressable>
</View>
```

- [ ] **Step 7: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 5: Apply fontFamily based on fontType in ThemeContext

**Files:**

- Modify: `src/context/ThemeContext.tsx:42-48,75-83,329-366`

**Interfaces:**

- Consumes: `fontType` state from Task 2
- Produces: Scaled typography with `fontFamily` applied based on fontType

- [ ] **Step 1: Extend ThemeTypography to include fontFamily**

```typescript
// src/context/ThemeContext.tsx — lines 42-48
export interface ThemeTypography {
  title: number;
  subtitle: number;
  body: number;
  caption: number;
  mono: number;
  fontFamily: string;
}
```

- [ ] **Step 2: Update scaleTypography to accept fontType**

```typescript
// src/context/ThemeContext.tsx — lines 75-83
function scaleTypography(scale: number, fontType: FontType): ThemeTypography {
  return {
    title: Math.round(baseTypography.title * scale),
    subtitle: Math.round(baseTypography.subtitle * scale),
    body: Math.round(baseTypography.body * scale),
    caption: Math.round(baseTypography.caption * scale),
    mono: Math.round(baseTypography.mono * scale),
    fontFamily: fontType === "mono" ? "monospace" : "System",
  };
}
```

- [ ] **Step 3: Update scaledTypography useMemo to pass fontType**

```typescript
// src/context/ThemeContext.tsx — around line 330-333
const scaledTypography = useMemo(
  () => scaleTypography(fontScale, fontType),
  [fontScale, fontType],
);
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 6: Verify and test

- [ ] **Step 1: Run typecheck on full project**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run linter**

Run: `bun run lint`
Expected: No errors

- [ ] **Step 3: Visual verification checklist**

- ProviderPickerScreen shows gear icon in top-right
- Tapping gear icon navigates to Settings screen
- Settings screen shows "Font type" section with System/Monospace chips
- Settings screen shows "About" section with version "1.0.1" and GitHub link (https://github.com/involvex/Desk-Escape)
- Selecting "Hacker" theme applies dark background (#0A0A0A) with green text (#00FF41)
- Selecting "Monospace" font type changes fontFamily to "monospace"
- Settings persist across app restarts (AsyncStorage)
