# Architecture Guide

Technical deep-dive into Desk Escape's internal design.

Every claim in this document was checked against the source tree or a running
server while writing it. Where a claim would need a live server to confirm, it
says so rather than asserting it.

## High-Level Overview

```
┌──────────────────────────────────────────────────────────────┐
│                          App.tsx                             │
│  GestureHandlerRootView                                      │
│    > KeyboardProvider                                        │
│      > SafeAreaProvider                                      │
│        > QueryClientProvider                                 │
│          > ThemeProvider                                     │
│            > PreferencesProvider                             │
│              > SessionMetaProvider                           │
│                > OrientationProvider                         │
│                  > ConnectionProvider      ← owns the client  │
│                    > BiometricLockProvider                   │
│                      > PermissionProvider                     │
│                        > QuestionProvider                    │
│                          > RootNavigator                      │
└──────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
  ConnectionScreen      CursorConnectionScreen     ProviderPickerScreen
                                ▼
                        CursorSessionScreen
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
    WorkspaceScreen          SettingsScreen          StatsScreen
        │                    SavedPermissionsScreen  PluginManagerScreen
        │
   ┌────┴─────┬──────────┬───────────┐
   ▼          ▼          ▼           ▼
 AgentChat TerminalPanel FileDrawer UnifiedDiff
   │          │          │           │
   ▼          ▼          ▼           ▼
 React      PTY over    file /     diff
 Query      WebSocket   status
   │          │          │           │
   └──────────┴──────────┴───────────┘
                │
                ▼
      @opencode/client  2.0.22   (OpenCode **V2** HTTP + SSE)
                │
                ▼
        OpenCode server
```

Two things about this diagram are worth stating outright, because the previous
version of this document got both wrong.

**There is no `@opencode-ai/sdk` dependency.** The client package is
[`@opencode/client`](https://www.npmjs.com/package/@opencode/client) v2.0.22, and
it targets the V2 API. `@opencode-ai/sdk` was the V1 client and is not installed.

**The UI does not speak the server's shape.** `src/types/domain.ts` holds an
app-owned domain model, and its header states the rule: _nothing in that file may
import from `@opencode/client`_. Server-specific shape changes are absorbed by
`src/api/opencode/adapter.ts`, so both agent providers can satisfy one interface
and the component layer never learns a server field was renamed.

## Navigation

Desk Escape uses **React Navigation native stack**, not Expo Router. The tree is
in `src/navigation/RootNavigator.tsx` and has **nine** routes, not four.

| Route              | Screen                   | Purpose                                                                               |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| `ProviderPicker`   | `ProviderPickerScreen`   | Choose OpenCode or Cursor. Initial route when the `showCursorAgents` preference is on |
| `Connection`       | `ConnectionScreen`       | OpenCode server address, host, port, credentials                                      |
| `CursorConnection` | `CursorConnectionScreen` | Cursor API key, repo, branch, model                                                   |
| `CursorSessions`   | `CursorSessionScreen`    | Cursor session list                                                                   |
| `Workspace`        | `WorkspaceScreen`        | Main workspace: chat, terminal, files, diff                                           |
| `Settings`         | `SettingsScreen`         | Preferences, theme, lock, export                                                      |
| `SavedPermissions` | `SavedPermissionsScreen` | Stored allow/deny rules                                                               |
| `Stats`            | `StatsScreen`            | Token and cost totals per session                                                     |
| `Plugins`          | `PluginManagerScreen`    | Plugin install and configuration                                                      |

`headerShown: false` everywhere, with a custom header in `WorkspaceScreen`.
`RootNavigator` renders a bare `ActivityIndicator` until `preferencesReady`, so
the first route is not chosen before AsyncStorage has been read — picking a route
from a not-yet-loaded preference is how you get a flash of the wrong screen.
`initialRouteName` is conditional: `ProviderPicker` when Cursor agents are
enabled, `Connection` otherwise.

## Context Providers

Eight context providers are composed in `App.tsx`, ordered so that no outer
provider reads an inner one. Above them sit four non-context wrappers:
`GestureHandlerRootView`, `KeyboardProvider`, `SafeAreaProvider` and
`QueryClientProvider`.

| Provider                | File                                   | Responsibility                                                                          |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| `ThemeProvider`         | `src/context/ThemeContext.tsx`         | Theme, font scale, font family, system dark-mode sync. Persists to AsyncStorage.        |
| `PreferencesProvider`   | `src/context/PreferencesContext.tsx`   | Feature flags and user preferences, including `showCursorAgents` and `preferencesReady` |
| `SessionMetaProvider`   | `src/context/SessionMetaContext.tsx`   | Per-session display metadata that several panels read                                   |
| `OrientationProvider`   | `src/context/OrientationContext.tsx`   | Orientation lock via `expo-screen-orientation`; exposes `isLandscape`                   |
| `ConnectionProvider`    | `src/context/ConnectionContext.tsx`    | **Core state**: the client, active directory, session, project, status, attachments     |
| `BiometricLockProvider` | `src/context/BiometricLockContext.tsx` | Face ID / fingerprint gate. Wraps `useBiometricLock` and publishes `biometricAvailable` |
| `PermissionProvider`    | `src/context/permission-provider.tsx`  | Permission requests from SSE, replies, the deferred queue, notifications                |
| `QuestionProvider`      | `src/context/QuestionContext.tsx`      | V2 form requests: pending list, answer map, reply and cancel                            |

A ninth context, `TerminalBridgeContext`, is **not** in `App.tsx` — it is mounted
per-workspace inside `WorkspaceScreen.tsx`, because the bridge is meaningless
without a live PTY and should not survive leaving the workspace.

### ConnectionProvider

The central hub. It owns:

- **Client lifecycle** — builds and caches an `OpenCodeClient` via
  `createAuthenticatedClient`, keyed on `baseUrl + username + useAuth + password`.
- **Location** — the active directory (project worktree), threaded to every call
  that accepts one.
- **Session selection** — `ensureSession` finds or creates, `selectSession`
  switches, `deleteSession` removes and picks a successor.
- **Status machine** — `disconnected → connecting → connected → error / reconnecting`.
- **Persistence** — connection config, recent hosts, passwords in
  `expo-secure-store`, last session id, last directory.
- **Offline queue** — buffers prompts while disconnected and flushes on reconnect.
- **Context attachments** — file paths attached to the next prompt.

## The Agent Provider Abstraction

`src/api/providers/` is the layer that lets the app talk to two different agent
backends. It is the largest subsystem this document previously did not mention.

`types.ts` defines `AgentProvider`, the single interface both backends satisfy:

```
connect / disconnect / testConnection
listSessions / createSession / deleteSession / selectSession
getMessages / sendPrompt / interruptSession
subscribe(callback) -> unsubscribe
getCurrentProject / listProjects / selectProject
listCommands / executeCommand
```

Plus two capability flags, `supportsTerminal` and `supportsFileBrowser`, so the UI
can hide a panel the active backend cannot honour rather than offering it and
failing.

Two implementations:

| Directory                     | Backend                       | Notes                                                                |
| ----------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `src/api/providers/opencode/` | OpenCode server (V2 HTTP/SSE) | Full surface: terminal, file browser, commands, projects             |
| `src/api/providers/cursor/`   | Cursor                        | Chat-focused; `supportsTerminal` and `supportsFileBrowser` are false |

Each provides its own `client.ts`, `event-bus.ts`, `hooks.ts` and
`message-stream.ts`, so the two backends' very different event vocabularies stay
confined to their own directory.

## API Layer (`src/api/`)

### Location scoping — `opencode/location.ts`

V1 threaded a flat `?directory=<path>` query parameter through nearly every call.
V2 replaces it with a `location` object serialized as the deepObject parameter
`?location[directory]=<path>`, passed **per call** rather than baked into the
client.

Session endpoints are the exception. `session.get`, `session.prompt` and
`message.list` take no location at all: a session's scope is fixed at creation
(`SessionCreateInput.location`) and only changes via `session.move`. Passing a
location there is not merely ignored — it is a schema error.

There is **no `src/api/directory.ts`**, which the previous version of this
document described. `withLocation()` in `opencode/location.ts` replaced it.

### `opencode/` — the V2 boundary

| File              | Role                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter.ts`      | Server shapes → domain shapes. `toChatMessage`, `toSession`, `toFileEntry`, `parseUnifiedDiff`, `toFileDiffEntry`, `markUntracked`, `indexFileStatuses`, `isDisplayableMessage` |
| `transport.ts`    | `createAuthHeader` and `createV2Fetch` — Basic auth, plus pairing tokens                                                                                                        |
| `config.ts`       | Resolved server configuration; folds V2's list of source documents                                                                                                              |
| `errors.ts`       | `withOpenCodeErrors` and `toOpenCodeError`, so one failure shape everywhere                                                                                                     |
| `file-content.ts` | File reads with size limits                                                                                                                                                     |
| `location.ts`     | `withLocation`, `normalizeBaseUrl`                                                                                                                                              |
| `plugins.ts`      | Plugin listing and install                                                                                                                                                      |

### `client.ts`

- `parseTarget(input)` — user-entered URL or host into `{ baseUrl, host, port }`,
  defaulting to port 4096.
- `buildConnectionConfig` / `getClientCacheKey` — config and cache identity.
- `createAuthenticatedClient(config, password?)` — cached `OpenCode.make(...)`,
  with `createV2Fetch` supplying the auth header.
- `testConnection(config, password?)` — health probe via `client.config.get()`.
- `ensureSession(client, preferredSessionId?, directory?)` — find or create.
- `clearClientCache(config?)` — evict on disconnect.
- `getWorktreeName`, `configToTargetUrl` — display helpers.
- `PairingChallenge` / `PairingToken` — the pairing-code flow.

### `hooks.ts`

React Query hooks bridging the client to the UI:

| Hook                                                                | Purpose                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------- |
| `useSessions`                                                       | Sessions for the active location                      |
| `useProjects` / `useCurrentProject`                                 | Projects and the current one                          |
| `useCommands`                                                       | Slash commands                                        |
| `useAgents` / `useModels` / `useProviders`                          | Agent and model catalogue                             |
| `useCurrentAgent` / `useCurrentModel`                               | The active selections                                 |
| `useSwitchAgent` / `useSwitchModel`                                 | Changing either                                       |
| `useOpenCodeConfig` / `useUpdateShell`                              | Server config and shell settings                      |
| `useFileList` / `useFileStatus` / `useFileContent` / `useFilePatch` | File browsing and diffs                               |
| `useSessionMessages`                                                | Messages for a session                                |
| `useSendPrompt` / `useInterruptSession`                             | Sending, and Stop                                     |
| `useExecuteCommand`                                                 | Slash command execution                               |
| `useSessionMessageStream`                                           | Subscribes to SSE and folds events into message state |

### Event handling

`event-bus.ts` owns one server subscription and fans events out to registered
listeners, started on connect and stopped on disconnect. `message-stream.ts` turns
those events into incremental state updates.

V2 renamed the event vocabulary wholesale. The 34 event names the app branches on
are grouped here by family rather than listed flat:

| Family     | Events                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Text       | `session.text.started` / `.delta` / `.ended`                                                                          |
| Reasoning  | `session.reasoning.started` / `.delta` / `.ended`                                                                     |
| Tool       | `session.tool.called` / `.progress` / `.success` / `.failed`, plus `session.tool.input.started` / `.delta` / `.ended` |
| Steps      | `session.step.started` / `.ended` / `.failed`                                                                         |
| Execution  | `session.execution.started` / `.succeeded` / `.failed` / `.interrupted`                                               |
| Compaction | `session.compaction.started` / `.delta` / `.ended` / `.failed`                                                        |
| Revert     | `session.revert.staged` / `.committed` / `.cleared`                                                                   |
| Lifecycle  | `session.status`, `session.idle`                                                                                      |
| Permission | `permission.asked`, `permission.replied`                                                                              |
| Form       | `form.created`, `form.replied`, `form.cancelled`                                                                      |

### `use-reconnect.ts`

Exponential backoff with jitter:

- health ping every `HEALTH_PING_INTERVAL = 30_000` ms while connected
- backoff from `BASE_BACKOFF = 1_000` ms, doubling, capped at `MAX_BACKOFF = 60_000`
- `MAX_RECONNECT_ATTEMPTS = 20`
- jitter of 10% of the delay, so a fleet of clients does not retry in lockstep
- `AppState` transitions trigger an immediate health re-check

### `use-offline-queue.ts`

Buffers prompts in AsyncStorage while disconnected — `enqueue`, `flushQueue`,
`clearQueue` — and auto-flushes when status returns to `connected`.

### `use-pty-session.ts`

Finds or creates a PTY: `client.pty.list({...})`, then
`client.pty.create({...})` if none is running, returning
`{ ptyId, status, error, retry }`.

### Domain modules

Pure, dependency-free logic with its own unit tests: `diff-view.ts` (diff
flattening, filtering, collapsing, totals), `forms.ts` (the V2 form model),
`permissions.ts`, `permission-queue.ts`, `notification-replies.ts`,
`session-fork.ts`, `session-revert.ts`, `session-stats.ts`, `revert.ts`,
`fork.ts`, `saved-permissions.ts`, `pty-lifecycle.ts`.

## Terminal

A full-screen PTY: xterm.js 6 inside a React Native `WebView`, talking to the
server's PTY WebSocket.

**Build pipeline.** `scripts/build-terminal-shell.mjs` runs at `postinstall`. It
reads `@xterm/xterm`, `@xterm/addon-fit` and the xterm stylesheet out of
`node_modules`, bundles them with the WebSocket and terminal bootstrap logic, and
emits `src/assets/terminal-shell-html.ts` as a string constant. The HTML is
therefore a build artifact, not something to edit by hand.

**Runtime flow.**

1. `TerminalPanel` renders a `WebView` with that HTML.
2. `buildTerminalWebSocketUrl()` (`src/utils/terminal-websocket.ts`) builds the
   WebSocket URL, carrying the auth token — iOS and Android WebViews do not
   inherit the app's fetch headers, so the credential has to travel in the URL.
3. xterm connects to the PTY socket; input flows in, output renders.
4. Resizes are sent back to the server.
5. `TerminalBridgeContext` carries connection state and resize reports back into
   React Native.

## Files and Diffs

**`FileDrawer`** — browses via `useFileList(path)`, badges git status from
`useFileStatus`, long-press to attach a file as context.

**`LandscapeFileRail`** — the compact rail beside the chat. It is
`min(max(screenWidth × 0.28, 160), 200)`, so 160–200 px, **not** the 320 px / 35%
the previous version claimed. It renders only when
`isTablet && isLandscape && activePanel === "agent"`, so it yields the full width
to the terminal or diff.

**`UnifiedDiff`** — the diff panel. `useWorkspaceDiff(visible)` queries
`["workspace-diff", directory, sessionId]` with a **15 s** `refetchInterval`, and
gates the query on `visible` (`enabled: Boolean(client) && visible`) so a closed
panel costs nothing. It prefers the working-tree diff and falls back to the
session's diff when the tree is clean, deliberately _without_ the untracked
overlay, since subtracting the VCS status set from a session diff would subtract
the wrong set. It also lists untracked files, which git has no hunks for.

The panel is a virtualized `SectionList` with sections flattened alongside their
rows (`SectionListData<SectionT, ItemT> = SectionT & { data: ItemT[] }`).

Collapsing is honoured inside `toDiffSections`, before the rows are built, so a
folded file never allocates a `DiffRow` for any of its lines. Counts come from
the hunks rather than the unbuilt rows — otherwise a folded file would report
"+0 −0" and appear to be a change the agent undid.

## Chat Rendering

`src/components/chat/` is a subsystem in its own right, and `AgentChat` is mostly
composition over it.

| Component                              | Role                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ChatMessageBubble`                    | One message: alignment by role, header, body, footer                                                                                                         |
| `MarkdownRenderer`                     | `react-native-markdown-display`, themed, `memo`ised, with copy-to-clipboard and a runnable-language check that offers to send a fenced block to the terminal |
| `ThinkingPartGroup`                    | Collapsed-by-default reasoning parts                                                                                                                         |
| `CollapsiblePartGroup`                 | Generic collapsible wrapper for tool parts                                                                                                                   |
| `ChatScrollBar` / `ChatScrollControls` | Custom scrollbar and jump controls                                                                                                                           |
| `message-parts.ts`                     | Pure part classification and grouping                                                                                                                        |

Tool and thinking blocks default to collapsed; a Settings toggle can expand them
by default. The grouping lives in `message-parts.ts` rather than in the bubble so
it can be unit tested without rendering.

## Themes

**Eight** themes in `src/theme/palettes.ts`, not seven.

| Name              | Style                                |
| ----------------- | ------------------------------------ |
| `oled-black`      | Pure black, cyan accent              |
| `dev-dark`        | GitHub-like dark, blue accent        |
| `dev-light`       | GitHub-like light, blue accent       |
| `midnight-purple` | Deep purple, violet accent           |
| `solarized-dark`  | Solarized palette, teal accent       |
| `nord`            | Nord palette, ice blue accent        |
| `high-contrast`   | Black/white/yellow, maximum contrast |
| `hacker`          | Terminal green on black              |

Each theme supplies **14** semantic colour tokens — `background`, `surface`,
`surfaceElevated`, `border`, `text`, `textMuted`, `accent`, `onAccent`,
`accentMuted`, `success`, `danger`, `warning`, `pillBackground`,
`inputBackground` — plus **5** spacing values from a shared scale and **5** base
font sizes.

`FontScale` is `0.85 | 1 | 1.15 | 1.3`; `scaleTypography` multiplies every size
by it. `FontType` is `system | mono`.

System theme sync follows `Appearance.getColorScheme()` and toggles between
`dev-dark` and `dev-light`. `src/theme/color-contrast.ts` carries contrast tests
over the palettes.

## Permission System

1. The event bus receives `permission.asked`.
2. `permission-provider.tsx` parses it into a `PendingPermission` and enqueues it.
3. Auto-approve, if enabled, replies immediately.
4. Otherwise `PermissionBanner` renders it in the workspace; if the app is
   backgrounded, `expo-notifications` posts a local notification.
5. Tapping the notification is a first-class reply path — see
   `notification-replies.ts`.
6. `respond(response)` replies and removes it from the queue.

Three properties of this flow are load-bearing and easy to break:

**Never drop a tap.** A reply taken with no client available is _held_, not
discarded, and flushed when a client arrives. Dropping it would leave the agent
blocked on a prompt the user believes they answered.

**The lock gates replies, not just the UI.** While `isLockGated` is true — see
`src/hooks/biometric-lock-state.ts` — a reply is held rather than sent, so an
approval cannot be sent from a notification while the app is locked. Gating on
`lockState === "locked"` alone would hang forever, because a stale stored
preference plus unenrolled biometrics makes `authenticate()` return `false`
without ever leaving `"locked"`. The predicate therefore also takes
`biometricAvailable`, and treats `lockState !== "unlocked"` as gated so that
`"unlocking"` holds too.

**`respond()` resolves on failure.** It reports through `error` and does not
reject, because every caller is `void respond(...)`; a rejection with no observer
becomes an unhandled rejection and, on a release build, a crash report about a
permission that visibly failed.

## Forms (Agent Questions)

V1 had a bespoke `/question` subsystem with a rigid
`[{ question, options, multiple, custom }]` shape. **V2 deletes all of it** and
replaces it with a generic Form: an ordered, heterogeneous `fields` list where
each field carries its own type, constraints and visibility conditions.

The server exposes four form paths, five operations in all, and the app uses
every one of them:

| Route                                          | Method    | Client call                  |
| ---------------------------------------------- | --------- | ---------------------------- |
| `/api/form`                                    | GET       | `client.form.list`           |
| `/api/session/{sessionID}/form`                | GET, POST | `client.session.form.list`   |
| `/api/session/{sessionID}/form/{formID}`       | GET       | `client.session.form.get`    |
| `/api/session/{sessionID}/form/{formID}`       | DELETE    | `client.session.form.cancel` |
| `/api/session/{sessionID}/form/{formID}/reply` | POST      | `client.session.form.reply`  |

Note that `cancel` is a `DELETE` on the resource path, not a `POST .../cancel`.
There is no form-reject endpoint in V2; `question.reject` died with the rest of
`/question`. `reply` and `cancel` both answer `204 No Content`.

`src/api/forms.ts` holds the model: parsing `form.created` into a `PendingForm`,
closing a form on `form.replied` or `form.cancelled`, field visibility (`hidden`
wins; `when` clauses AND together; `external` fields always show), `default`
seeding, required-field and `minItems`/`maxItems` validation, and number
coercion. `QuestionContext` owns the pending list — including a cold-start
`listPendingForms` so a form raised while the app was closed still appears — and
`QuestionBanner` renders the fields — an `external` field as a link beside an
acknowledgement toggle, every other kind with its matching control.

The `external` case is the one that required a live server to pin down. The
server requires every `external` field to be acknowledged in the answer map —
omitting it, or sending anything other than `true`, fails the whole reply with
`FormInvalidAnswerError: External form field must be acknowledged: <key>`.
Only `true` is accepted; `false`, `"yes"` and `1` were all refused when probed.
The app now satisfies that as a unit rather than treating `external` as optional:

- `initialAnswer()` seeds every external field to `false`, so the key exists for
  a controlled toggle rather than being absent.
- `missingRequiredKeys()` treats external fields as required unconditionally —
  regardless of the author's `required` flag — and flags them until their value
  is exactly `true`. A boolean `false` is still a real answer for a boolean
  field, so the two are distinguished in `isUnanswered()` rather than both going
  through `isEmptyValue`.
- `QuestionBanner` renders a "I have read this" / "Not yet" toggle beside the
  link, marks the field required, and the payload builder no longer drops it.
  Submit is blocked server-side-equivalent: locally, before the request leaves.

## Expo Config Plugins

`plugins/with-cleartext-network.js` sets `android:usesCleartextTraffic="true"`
and adds a `network_security_config.xml` permitting cleartext. OpenCode servers
typically run over plain HTTP on a LAN or a Tailnet, so without this the app
cannot reach one.

## Testing

`bun test`, no Jest. `src/testing/` holds the harness:

- `setup.ts` — global mocks, including `expo-notifications`, which cannot be
  imported under `bun test` because it reaches `expo-modules-core` and reads
  Metro's `__DEV__`.
- `harness.tsx` — `render()` returning `act`, `press`, `flush` and `text`.
- `context-holds.ts` — the world-state slots, and `resetTestContext`, which
  **resets call logs but keeps handler registrations**.
- Stub modules for React Native, Reanimated, the event bus, the WebView and
  clipboard.

Two conventions worth knowing before writing a test here:

- External stimuli (SSE events, notification taps, `AppState` changes) must run
  **inside** `result.act(...)`, or the `setState` lands without flushing and the
  failure reads like a product bug.
- `flush()` needs two real `setTimeout(0)` turns. `act` flushes React
  synchronously, which hides production Scheduler interleavings — some races are
  only reachable by making an awaited call hang.

Live server contracts are checked separately by
`scripts/probe-server-contracts.mjs`, which is written to _disprove_ the app's
assumption first, so a probe that agrees is evidence rather than a tautology.

## Tech Stack

| Layer      | Technology                                         |
| ---------- | -------------------------------------------------- |
| Framework  | React Native 0.86.3 + Expo SDK 57 + React 19.2     |
| Navigation | React Navigation 7 (native stack)                  |
| State      | React Query 5 (server state) + Context (app state) |
| Styling    | `StyleSheet.create()` with theme tokens            |
| Terminal   | xterm.js 6 + FitAddon in a WebView                 |
| Server API | `@opencode/client` 2.0.22 (OpenCode **V2**)        |
| Animations | react-native-reanimated 4.5                        |
| Gestures   | react-native-gesture-handler 2.32                  |
| Storage    | AsyncStorage (general) + SecureStore (credentials) |
| Build      | Bun, TypeScript 6, ESLint 10, Prettier             |
