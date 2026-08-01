## Task 4: Add Font type section and About section to SettingsScreen

### What was implemented

1. **Font type section** — Chip selector with "System" / "Monospace" options, placed immediately after the Font size section. Consumes `fontType` and `setFontType` from `useTheme()`.

2. **About section** — At the bottom of the ScrollView, showing:
   - Version row displaying "1.0.1"
   - "View on GitHub" button with `ExternalLink` icon, opens `https://github.com/involvex/Desk-Escape` via `expo-web-browser` (dynamic import)

3. **Supporting changes:**
   - Added `ExternalLink` to lucide-react-native imports
   - Added `FontType` to the type imports
   - Added `fontTypeOptions` constant
   - Destructured `fontType` / `setFontType` from `useTheme()`
   - Added `aboutRow`, `aboutLabel`, `aboutValue`, `repoLink`, `repoLinkText` styles

### Tests / Verification

- `bun run typecheck` — **PASS** (tsc --noEmit, zero errors)

### Files changed

- `src/screens/SettingsScreen.tsx` — 88 insertions, 1 deletion

### Self-review findings

- No issues found. All styles follow existing patterns (chip rows, surface cards with borders). The dynamic import for `expo-web-browser` avoids adding a top-level import for a module only used in an onPress handler, keeping bundle impact minimal.
