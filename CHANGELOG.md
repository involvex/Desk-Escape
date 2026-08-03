# Changelog

All notable changes to **Desk Escape** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-08-0X

### Added

- Companion plugin integration — the app now recommends
  `@involvex/opencode-autoweb-plugin` for automatic `opencode web` startup.
  See `docs/PLUGINS.md` for setup instructions.
- GitHub Sponsors badge and support reference in the README.
- CI workflow (`ci.yml`) — lint, typecheck, and debug APK build on every PR.
- Release workflow (`release.yml`) — automatically builds a signed APK and
  publishes a GitHub Release when a `v*` tag is pushed.
- `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates, and pull-request
  template to improve the contributor experience.
- `CHANGELOG.md` to track user-facing changes.
- `docs/PLUGINS.md` documenting companion tools.

### Changed

- Release builds now read signing configuration from `gradle.properties`
  (`RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`,
  `RELEASE_KEY_PASSWORD`); falls back to the debug keystore when release
  credentials are not present.

### Fixed

- `use-pty-session.ts` retry now resets session status and error state, and
  `retryKey` is included in the effect dependency array so a retry actually
  triggers a PTY re-fetch.
- `TerminalPanel.tsx` WebSocket URL + auth-error handling consolidated into a
  single `useMemo`, eliminating the React `setState`-in-effect lint warning.
- `use-offline-queue.ts` `flushQueue` now properly clears the queue after
  sending messages instead of re-reading stale state from AsyncStorage.

---

## [1.0.2] - 2026-0X-XX

### Fixed

- Terminal panel WebSocket URL construction error handling.
- PTY session retry reliability.
- Offline message queue flush logic.

---

## [1.0.1] - 2026-0X-XX

### Fixed

- Terminal panel authentication error display when WebSocket URL construction
  fails (e.g., missing credentials).

### Added

- Auth error UI panel with guidance for credential configuration.

---

## [1.0.0] - 2026-0X-XX

### Added — Initial public release

- **Agent Chat** — Send prompts, receive responses in real-time via SSE streaming. Supports slash commands, context attachments, and offline queuing.
- **Terminal** — Full-screen PTY terminal powered by xterm.js in a WebView. Connects to the server's shell over WebSocket.
- **File Browser** — Browse the remote workspace, view file status (modified/added/deleted), and open unified diffs.
- **Session & Project Management** — Switch between sessions and projects. Create, delete, and navigate across workspaces.
- **7 Themes** — OLED Black, Dev Dark, Dev Light, Midnight Purple, Solarized Dark, Nord, and High Contrast. Sync with system dark/light mode.
- **Biometric Lock** — Optional Face ID / fingerprint authentication before revealing workspace content.
- **Offline Queue** — Prompts are buffered when disconnected and sent automatically on reconnection.
- **Auto-Reconnect** — Exponential backoff reconnection with visual status indicators.
- **Landscape Split-View** — On tablets in landscape, a file rail appears alongside the agent chat.
- **Command Palette** — Quick access to sessions, projects, slash commands, and app actions.
- **Message Search** — Full-text search across the current session's chat history.
- **Multi-Server Profiles** — Save and switch between multiple OpenCode server connections.

[1.1.0]: https://github.com/involvex/Desk-Escape/releases/tag/v1.1.0
[1.0.2]: https://github.com/involvex/Desk-Escape/releases/tag/v1.0.2
[1.0.1]: https://github.com/involvex/Desk-Escape/releases/tag/v1.0.1
[1.0.0]: https://github.com/involvex/Desk-Escape/releases/tag/v1.0.0
