## Task 5: Wire fontFamily into ThemeTypography based on fontType

### What I Implemented

Extended `ThemeTypography` to carry a `fontFamily` string and wired it through the scaling pipeline:

1. **`ThemeTypography` interface** — added `fontFamily: string` field
2. **`baseTypography`** — added `fontFamily: "System"` default
3. **`scaleTypography()`** — now accepts `fontType: FontType` param and returns `fontFamily: "monospace"` when `fontType === "mono"`, otherwise `"System"`
4. **`scaledTypography` useMemo** — passes `fontType` to `scaleTypography` and includes `fontType` in deps

### Files Changed

- `src/context/ThemeContext.tsx` — 4 edits (interface, base object, function signature, useMemo call)

### Test Results

- `bun run typecheck` — PASS (tsc --noEmit, zero errors)

### Self-Review Findings

- No issues. Implementation exactly matches the task brief spec.
