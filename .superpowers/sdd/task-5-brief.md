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
