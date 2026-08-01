### Task 2: Add fontType state/persistence to ThemeContext

**Files:**

- Modify: `src/context/ThemeContext.tsx`

**Note:** The hacker theme definition was already added in Task 1. This task only adds the fontType state management.

**Interfaces:**

- Consumes: `FontType` type from Task 1
- Produces: `fontType` + `setFontType` in ThemeContext

- [ ] **Step 1: Update imports to include FontType**

```typescript
// src/context/ThemeContext.tsx — line 13
import type { FontScale, FontType, ThemeName } from "@/types/opencode";
```

- [ ] **Step 2: Add STORAGE_KEY for font type**

```typescript
// src/context/ThemeContext.tsx — after line 16 (after SYNC_THEME_KEY)
const FONT_TYPE_KEY = "@desk-escape/font-type";
```

- [ ] **Step 3: Add FontType to ThemeContextValue interface**

```typescript
// src/context/ThemeContext.tsx — ThemeContextValue interface
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

- [ ] **Step 4: Add fontType state in ThemeProvider**

In the `ThemeProvider` function, add state initialization after the existing useState calls:

```typescript
const [fontType, setFontTypeState] = useState<FontType>("system");
```

- [ ] **Step 5: Load fontType from AsyncStorage**

Update the useEffect that loads stored values. Add `FONT_TYPE_KEY` to the `Promise.all` and handle the result:

```typescript
const [storedTheme, storedScale, storedSync, storedFontType] =
  await Promise.all([
    AsyncStorage.getItem(THEME_STORAGE_KEY),
    AsyncStorage.getItem(FONT_SCALE_KEY),
    AsyncStorage.getItem(SYNC_THEME_KEY),
    AsyncStorage.getItem(FONT_TYPE_KEY),
  ]);

// ... existing theme/scale/sync handling ...

if (storedFontType === "system" || storedFontType === "mono") {
  setFontTypeState(storedFontType as FontType);
}
```

- [ ] **Step 6: Add setFontType callback**

After the `setFontScale` callback:

```typescript
const setFontType = useCallback((type: FontType) => {
  setFontTypeState(type);
  void AsyncStorage.setItem(FONT_TYPE_KEY, type);
}, []);
```

- [ ] **Step 7: Add fontType to context value**

Add `fontType` and `setFontType` to the `value` useMemo, and add them to the dependency array:

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
