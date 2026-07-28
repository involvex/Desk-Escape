# Progress: Dark Mode System Sync + Collapsible Code Blocks

## Status: DONE

### Completed (2026-07-28)

- **Dark Mode System Sync**: `ThemeContext.tsx` uses `useColorScheme()` hook from `react-native` to detect system appearance changes in real-time. When `syncTheme` is enabled, the app theme auto-switches between `dev-dark` and `dev-light`. System theme is read on mount and on every appearance change. User is prompted with a `SyncTheme` AsyncStorage key (`@desk-escape/sync-theme`, default `true`).
- **Collapsible Code Blocks**: `MarkdownRenderer.tsx` accepts `defaultCollapsed` prop (default `true`). Code blocks now have a toggle button (ChevronDown/ChevronRight) in the header row. Content is conditionally rendered based on `collapsed` state. `ChatMessageBubble.tsx` passes `defaultCollapsed` to each `MarkdownRenderer` instance.
- **SettingsScreen**: Added "Follow system dark/light mode" switch toggle in Appearance section, bound to `syncTheme`/`setSyncTheme`.

### Files Modified

- `src/context/ThemeContext.tsx` — `useColorScheme()` hook, `syncTheme` state, system theme sync effect
- `src/screens/SettingsScreen.tsx` — sync toggle UI
- `src/components/chat/MarkdownRenderer.tsx` — `defaultCollapsed` prop, collapsible code block with chevron toggle
- `src/components/chat/ChatMessageBubble.tsx` — passes `defaultCollapsed` to `MarkdownRenderer`
