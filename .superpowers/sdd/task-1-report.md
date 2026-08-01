# Task 1: Add "hacker" theme and FontType to types

## What was implemented

- Added `"hacker"` to the `ThemeName` union type in `src/types/opencode.ts`
- Added `FontType = "system" | "mono"` type in `src/types/opencode.ts`
- Added hacker theme definition (green-on-black hacker aesthetic) to `themeDefinitions` in `src/context/ThemeContext.tsx`
- Added `"hacker"` to the `themeNames` array in `src/context/ThemeContext.tsx`

## Files changed

- `src/types/opencode.ts` — added `"hacker"` to ThemeName union, added FontType type
- `src/context/ThemeContext.tsx` — added hacker theme definition and to themeNames array

## Testing

- `bun run typecheck`: **PASS** — no TypeScript errors

## Self-review

- The `ThemeContext.tsx` had a `Record<ThemeName, ThemeDefinition>` constraint, which meant adding `"hacker"` to the type required also adding it to the record. This is a necessary companion change that wasn't in the original task brief but was discovered during typecheck.
- The hacker theme colors are consistent with the classic green-on-black terminal aesthetic.
- No lint issues introduced.
