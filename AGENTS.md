# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

## Learned User Preferences

- Do not edit implementation plan files when executing a plan — implement from the attached plan as reference only.
- Do not recreate plan to-dos; mark existing ones in_progress and complete them.
- Scaffold the Expo app in the Desk-Escape workspace root, not an `opencode-mobile` subdirectory.
- Ship on Expo SDK 56 stable; defer Expo 57 canary and RN 0.86 / gesture-handler 3 until Windows native build path limits are resolved.
- Terminal UX must be full-screen and usable — not a partial bottom-sheet overlay showing the OpenCode web UI sidebar.
- Use native PTY (OpenCode SDK `/pty` API + xterm WebView), not loading the OpenCode host web UI root URL for terminal.
- Use Bun for installs and scripts (`bun install`, `bun run`, `bunx`).
- Do not git commit or push unless explicitly requested.
- Prefer `client.event.subscribe()` for live agent chat streaming instead of polling.
- Do not adopt Expo Router or `expo-router/unstable-split-view`; use React Navigation with custom landscape split (`LandscapeFileRail`).
- Default agent chat tool/thinking blocks to collapsed; Settings may offer expand-by-default toggle.

## Learned Workspace Facts

- Mobile-first OpenCode client: connects remotely via `@opencode-ai/sdk/client` v1 `createOpencodeClient({ baseUrl })` — no local Nitro proxy.
- SDK patterns reference: sibling `opencode-portal` `apps/web` (`createOpencodeClient`, session/file APIs).
- Stable native stack: Expo `~56.0.12`, `react-native` `0.85.3`, `reanimated` `4.3.1`, `worklets` `0.8.3`, `async-storage` `2.2.0`.
- Pin `react-native-gesture-handler` to exact `2.31.1` (no `^` or `~`); `2.31.2` regresses APIs; `3.x` fails Windows MAX_PATH at the current repo path.
- RN 0.86 + gesture-handler 3 hits Windows 260-char path limit under `D:\repos\opencode-plugins\Desk-Escape` — need a shorter clone path or a future SDK.
- `TerminalPanel`: `usePtySession` → `client.pty.list`/`create`; WebSocket via `buildTerminalWebSocketUrl` with `auth_token` for iOS/Android WebView auth.
- `android:clean` uses `cmd /c "cd android && gradlew.bat clean"` for Windows PowerShell compatibility.
- `android.enableLongPaths=true` in `gradle.properties`.
- Dev tooling: ESLint 10, TypeScript 6, `eslint-config-expo` flat config (`eslint.config.mjs`).
- Before native dependency bumps run `bunx expo install --check`; do not re-add `expo.install.exclude` overrides without intentional testing.
- Navigation: React Navigation native stack (`RootNavigator`), not Expo Router.
- No SDK `project.switch`; multi-project context via optional `directory` query on API calls or client recreation.
