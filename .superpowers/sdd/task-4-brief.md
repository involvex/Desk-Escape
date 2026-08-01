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
