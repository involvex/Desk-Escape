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
