# Architecture Guide

Technical deep-dive into Desk Escape's internal design.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                    App.tsx (Root)                        │
│  GestureHandlerRootView > KeyboardProvider > SafeArea    │
│  > QueryClientProvider > ThemeProvider > Preferences     │
│  > OrientationProvider > ConnectionProvider              │
│  > BiometricLockProvider > PermissionProvider            │
│  > AppShell (NavigationContainer + RootNavigator)        │
└─────────────────────────────────────────────────────────┘
                            │
                ┌───────────┼───────────┐
                ▼           ▼           ▼
        ConnectionScreen  WorkspaceScreen  SettingsScreen
                            │
               ┌────────────┼────────────┐
               ▼            ▼            ▼
          AgentChat    TerminalPanel   FileDrawer
               │            │            │
               ▼            ▼            ▼
          (React Query)  (xterm.js)  (OpenCode API)
               │            │            │
               └────────────┼────────────┘
                            ▼
                    @opencode-ai/sdk/client
                            │
                            ▼
                   OpenCode Server (HTTP/SSE)
```

## Navigation

Desk Escape uses **React Navigation native stack** (not Expo Router). The navigation tree is defined in `src/navigation/RootNavigator.tsx`.

```
RootStack (NativeStackNavigator)
├── Connection    — initial route, server address input
├── Workspace     — main workspace (agent chat, terminal, files)
├── Settings      — app preferences
└── Plugins       — plugin manager
```

All screens use `headerShown: false` with a custom header in `WorkspaceScreen`. The `Connection` screen uses `navigation.replace()` to transition to `Workspace` without back navigation.

## Context Provider Hierarchy

The provider tree in `App.tsx` is ordered by dependency — outer providers don't depend on inner ones:

| Provider                | File                                   | Responsibility                                                                                                          |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ThemeProvider`         | `src/context/ThemeContext.tsx`         | 7 color themes, font scaling, system dark mode sync. Persists to AsyncStorage.                                          |
| `PreferencesProvider`   | `src/context/PreferencesContext.tsx`   | User preferences: auto-approve permissions, prompt presets, tool/thinking block collapse behavior.                      |
| `OrientationProvider`   | `src/context/OrientationContext.tsx`   | Screen orientation lock (portrait/landscape/auto). Uses `expo-screen-orientation`.                                      |
| `ConnectionProvider`    | `src/context/ConnectionContext.tsx`    | **Core state**: OpenCode client, session, project, connection status, reconnection, offline queue, context attachments. |
| `BiometricLockProvider` | `src/context/BiometricLockContext.tsx` | Face ID / fingerprint lock gate. Wraps `useBiometricLock` hook.                                                         |
| `PermissionProvider`    | `src/context/PermissionContext.tsx`    | Listens for agent permission requests via event bus, shows in-app banner or notification, responds on user action.      |

### ConnectionContext (the central hub)

This is the most complex context. It manages:

- **Client lifecycle**: Creates/caches `OpencodeClient` instances via `createOpencodeClient()` with optional Basic Auth.
- **Session management**: `ensureSession()` finds or creates a session. `selectSession()` switches. `deleteSession()` removes and picks the next available.
- **Project switching**: `selectProject()` changes the active directory/worktree, fetches the project, and loads the first session for that project.
- **Status machine**: `disconnected` → `connecting` → `connected` → `error` / `reconnecting`.
- **Persistence**: Stores connection config, recent hosts (up to 5), passwords (via `expo-secure-store`), last session ID, and last directory in AsyncStorage/SecureStore.
- **Offline queue**: Buffers prompts when disconnected, flushes on reconnection.
- **Context attachments**: File paths attached to the next prompt for file-level context.

## API Layer (`src/api/`)

### client.ts

Wraps `@opencode-ai/sdk/client`. Key functions:

- `createAuthenticatedClient(config, password?)` — Creates or retrieves a cached SDK client. Adds Basic Auth header if `useAuth` is true.
- `parseTarget(input)` — Parses a user-entered URL/host string into `{ baseUrl, host, port }`. Defaults to port 4096.
- `testConnection(config, password?)` — Calls `client.config.get()` to verify server health.
- `ensureSession(client, preferredSessionId?, directory?)` — Finds an existing session or creates one.
- `clearClientCache(config?)` — Evicts cached clients on disconnect.

### hooks.ts

React Query hooks that bridge the SDK to the UI:

| Hook                                 | Purpose                                                                |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `useSessions()`                      | Lists sessions for the active directory                                |
| `useSessionMessages(sessionId)`      | Fetches messages for a session (staleTime: Infinity, refetch on mount) |
| `useProjects()`                      | Lists all projects                                                     |
| `useCurrentProject()`                | Gets the current project for the active directory                      |
| `useCommands()`                      | Lists available slash commands                                         |
| `useOpenCodeConfig()`                | Gets server config                                                     |
| `useSendPrompt(sessionId)`           | Sends a text prompt with context attachments                           |
| `useExecuteCommand(sessionId)`       | Executes a slash command                                               |
| `useSessionMessageStream(sessionId)` | Subscribes to SSE events and incrementally updates the message list    |
| `useFileList(path)`                  | Lists files at a path                                                  |
| `useFileStatus()`                    | Gets git status of files (modified/added/deleted)                      |
| `useFilePatch(path)`                 | Reads a file's diff patch                                              |

### event-bus.ts

A lightweight SSE subscription manager. Uses `client.event.subscribe()` to receive a stream of events from the server. Registered listeners receive raw events. The bus is started on connection and stopped on disconnect.

### message-stream.ts

Processes SSE events into incremental message state updates:

- `message.updated` — Upserts a message's info
- `message.removed` — Removes a message
- `message.part.updated` — Upserts a part (text delta appending, tool state changes)
- `message.part.removed` — Removes a part
- `session.status` / `session.idle` — Agent busy/idle state
- `session.compacted` / `session.diff` / `command.executed` — Triggers full message refetch

### directory.ts

Utility: wraps an optional `directory` string into `{ query: { directory } }` for API calls. This scopes all OpenCode API calls to a specific project worktree.

### use-pty-session.ts

Manages a PTY terminal session:

1. Calls `client.pty.list({ directory })` to find an existing running PTY
2. If none found, calls `client.pty.create({ directory, cwd, title })` to create one
3. Returns `{ ptyId, status, error, retry }` for the terminal panel

### use-reconnect.ts

Auto-reconnection with exponential backoff:

- Health ping every 30 seconds while connected
- On failure, attempts reconnection with backoff (1s base, 60s max, 20 attempts max)
- Jitter added to prevent thundering herd
- Background/foreground detection: re-checks health when app returns to foreground

### use-offline-queue.ts

Buffers prompts in AsyncStorage when disconnected:

- `enqueue(text, attachments)` — Adds to queue
- `flushQueue()` — Sends all queued messages sequentially
- `clearQueue()` — Empties the queue
- Auto-flushes when connection status changes to `connected`

## Terminal Implementation

The terminal is a full-screen PTY powered by xterm.js running inside a React Native WebView.

### Build Pipeline

`scripts/build-terminal-shell.mjs` runs at `postinstall`:

1. Reads `@xterm/xterm` JS, `@xterm/addon-fit` JS, and `@xterm/xterm` CSS from `node_modules`
2. Bundles them with inline WebSocket + terminal initialization logic
3. Outputs `src/assets/terminal-shell-html.ts` as a static HTML string export

### Runtime Flow

1. `TerminalPanel` component renders a `<WebView>` with the bundled HTML
2. Passes `wsUrl` (WebSocket URL with auth token) via `window.__TERMINAL__` injection
3. xterm.js initializes, connects to the PTY WebSocket
4. Terminal data flows bidirectionally: user input → WebSocket → server PTY → WebSocket → xterm display
5. Resize events are sent back to the server via PTY resize messages
6. WebView posts messages back to React Native for connection state and resize reporting

### PTY WebSocket URL

Built with `buildTerminalWebSocketUrl()` using the server base URL, PTY session ID, and Basic Auth token for iOS/Android WebView authentication.

## File Operations

### File Drawer (`FileDrawer`)

- Lists files via `useFileList(path)` (starts at workspace root)
- Navigates into directories by updating the path
- Shows git status badges (modified, added, deleted) via `useFileStatus()`
- Long-press a file to add it as a context attachment

### Unified Diff (`UnifiedDiff`)

- Shows modified files from `useFileStatus()`
- Reads patch data via `useFilePatch(path)`
- Renders added/removed/context lines with syntax highlighting
- Accessible via swipe gesture or panel tab

### Landscape File Rail (`LandscapeFileRail`)

- Compact file list shown alongside agent chat in landscape mode
- Limited to 320px width (35% of screen)
- Only visible when `activePanel === "agent"` and in landscape

## Themes

7 built-in themes defined in `ThemeContext.tsx`:

| Name              | Style                                |
| ----------------- | ------------------------------------ |
| `oled-black`      | Pure black background, cyan accent   |
| `dev-dark`        | GitHub-like dark, blue accent        |
| `dev-light`       | GitHub-like light, blue accent       |
| `midnight-purple` | Deep purple, violet accent           |
| `solarized-dark`  | Solarized palette, teal accent       |
| `nord`            | Nord palette, ice blue accent        |
| `high-contrast`   | Black/white/yellow, maximum contrast |

Each theme defines: `colors` (14 semantic tokens), `spacing` (5 scale values), `typography` (5 font sizes).

Font scaling supports 4 levels: 0.85, 1.0, 1.15, 1.3. All typography sizes are multiplied by the scale factor.

System theme sync: When enabled, follows `Appearance.getColorScheme()` and toggles between `dev-dark` / `dev-light`.

## Permission System

The agent can request permissions (e.g., to run shell commands). The flow:

1. SSE event bus receives a permission event
2. `PermissionContext` parses it into a `PendingPermission`
3. If auto-approve is enabled in preferences, responds immediately with `"always"`
4. Otherwise, shows a `PermissionBanner` in the workspace
5. If the app is backgrounded, sends a local notification via `expo-notifications`
6. User responds (Allow / Reject / Always Allow), which calls `respondToPermission()`

## Expo Config Plugins

### with-cleartext-network

Custom plugin (`plugins/with-cleartext-network.js`) that:

1. Sets `android:usesCleartextTraffic="true"` in AndroidManifest
2. Adds a `network_security_config.xml` allowing all cleartext traffic
3. Required because OpenCode servers typically run over HTTP on LAN/Tailscale

## Tech Stack

| Layer      | Technology                                         |
| ---------- | -------------------------------------------------- |
| Framework  | React Native 0.86 + Expo SDK 57                    |
| Navigation | React Navigation 7 (native stack)                  |
| State      | React Query 5 (server state) + Context (app state) |
| Styling    | `StyleSheet.create()` with theme tokens            |
| Terminal   | xterm.js 6 + FitAddon in WebView                   |
| SDK        | `@opencode-ai/sdk/client` v1                       |
| Animations | react-native-reanimated 4.5                        |
| Gestures   | react-native-gesture-handler 2.32                  |
| Storage    | AsyncStorage (general) + SecureStore (credentials) |
| Build      | Bun, TypeScript 6, ESLint 10                       |
