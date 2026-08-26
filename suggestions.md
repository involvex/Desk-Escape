# Desk Escape — Feature Suggestions

A curated list of features and improvements that could enhance the Desk Escape mobile client for OpenCode.

---

## ✅ COMPLETED FEATURES

### ✅ #3 — Markdown & Code Block Rendering

**Status: DONE** — Full markdown rendering with `react-native-markdown-display`, syntax-highlighted code blocks, copy button, collapsible blocks, and "Run in terminal" action.

### ✅ #2 — Inline Code Execution & Shell Command Sharing

**Status: DONE** — Code blocks have "Run" button that pipes command to active PTY session via `onRunCommand`.

### ✅ #4 — Offline Queue for Prompts

**Status: DONE** — `useOfflineQueue` hook with AsyncStorage persistence, `OfflineQueueIndicator` component, auto-flush on reconnect.

### ✅ #5 — Biometric App Lock

**Status: DONE** — `expo-local-authentication` integration, configurable in Settings, graceful fallback to device passcode.

### ✅ #7 — Session History & Comparison

**Status: PARTIAL** — Session listing, selection, and read-only view via `SessionPicker`. Side-by-side diff and pinning not yet implemented.

### ✅ #12 — Multi-Server Connection Profiles

**Status: DONE** — Recent hosts stored in AsyncStorage, quick-switch on ConnectionScreen, remembers last session per directory.

### ✅ #15 — Dark Mode System Sync

**Status: DONE** — `syncTheme` option follows `Appearance.getColorScheme()`, auto-switches between light/dark variants.

### ✅ #19 — Error Recovery & Reconnection Logic

**Status: DONE** — `useReconnect` hook with exponential backoff, visual "reconnecting..." indicator, background reconnection on foreground.

### ✅ #1 — Message Search & Filtering

**Status: DONE** — `MessageSearchBar` with full-text search, role filtering, highlighted snippets, next/prev navigation, jump-to-message.

### ✅ #23 — Performance Optimizations (Partial)

**Status: PARTIAL** — FlatList with scroll optimization, `ChatScrollBar`, virtualized diff view. `getItemLayout` NOT implemented (fallback in `onScrollToIndexFailed`).

---

## HIGH PRIORITY — Quick Wins (1-2 days each)

### 🔧 Fix Unused Variable Warnings (30 min)

**Priority: Critical** — Clean up ESLint warnings before any new work:

- `src/api/hooks.ts:208` — `sessionResult` assigned but never used in `useCurrentAgent`
- `src/components/AgentPicker.tsx:3` — `FlatList` imported but unused (using `ScrollView`)
- `src/components/AgentPicker.tsx:31` — `spacing`, `typography` destructured but unused
- `src/components/ModelPicker.tsx:65` — `spacing`, `typography` destructured but unused
- `src/components/WorkspaceToolbar.tsx:3` — `Bot` icon imported but unused
- `src/context/ConnectionContext.tsx:7-8` — `Agent`, `Model` types imported but unused

### 🔧 Implement `getItemLayout` on Message FlatList (1 day)

**Priority: High** — Eliminate `onScrollToIndexFailed` fallback, enable instant `scrollToIndex` for search results and jump-to-message. Messages have variable height but can estimate ~200px average.

### 🔧 Add Haptic Feedback (1 day)

**Priority: High** — #9 from original list. Use `expo-haptics` for:

- Light tap on message send
- Medium tap on permission request
- Success on connection
- Error on connection failure
- Optional toggle in Settings

### 🔧 Notification Actions for Permission Requests (2 days)

**Priority: High** — #6 from original list. Add "Allow"/"Reject" actions to push notifications using Expo's `notification.actions`. Handle response in notification listener to call `respondToPermission` directly.

### 🔧 Clipboard Integration Enhancements (1 day)

**Priority: Medium** — #14 partial. Add:

- "Copy" button on every tool output in chat (not just code blocks)
- Long-press on assistant message to copy entire response
- Paste-to-attach: paste code from clipboard → auto-create context attachment

---

## HIGH PRIORITY — Substantial Features (1-2 weeks each)

### 🔧 Split-View Terminal + Chat on Tablets (1-2 weeks)

**Priority: High** — #13 from original list. Current landscape only shows file rail. Need:

- Configurable split ratio (50/50, 60/40, 70/30)
- Draggable divider to resize panes
- Sync scroll: when agent outputs terminal command, highlight in both panes
- Persist split preference

### 🔧 Export & Share Session Transcript (1 week)

**Priority: High** — #21 from original list. Export session as Markdown/PDF, native share sheet, include tool outputs and thinking blocks optionally.

### 🔧 Custom Theme Builder (1 week)

**Priority: Medium** — #8 from original list. "Custom" theme slot with color pickers for each semantic token, import/export JSON, live preview.

### 🔧 Agent Activity Timeline (1-2 weeks)

**Priority: Medium** — #11 from original list. Horizontal timeline below header showing agent steps (read/edit/bash/think) with status colors, tap to jump to message, animated pulsing on current step.

### 🔧 Rate Limit & Token Usage Display (1 week)

**Priority: Medium** — #16 from original list. Display estimated token count per session (if SDK exposes), session picker integration, cost estimation, 7/30 day usage graph.

---

## MEDIUM PRIORITY — Nice to Have (2-4 weeks each)

### 🔧 Drag-and-Drop File Context Attachment (2 weeks)

**Priority: Medium** — #10 from original list. Floating draggable file chips, drag from file drawer to composer, visual drop zone indicator. Requires `react-native-drag-and-drop` or similar.

### 🔧 App Shortcuts & Deep Links (2 weeks)

**Priority: Low** — #20 from original list. iOS Shortcuts/Android App Shortcuts for "New Session", "Last Session", "Run Preset". Deep link scheme: `desk-escape://connect?host=...`. Siri/Google Assistant integration.

### 🔧 Widget for Quick Prompt (3-4 weeks)

**Priority: Low** — #17 from original list. Home screen widget: small (status + preset), medium (text input). Uses last connected server. Notification on response.

### 🔧 Collaborative Sessions / Multi-User (Long-term)

**Priority: Low** — #22 from original list. Requires OpenCode server support. Live presence, view/send permissions, shared annotations, @mentions.

### 🔧 Keyboard Shortcuts (External Keyboard) (1-2 weeks)

**Priority: Low** — #24 from original list. `Cmd+K` palette, `Cmd+N` new session, `Cmd+T` terminal, arrow navigation, `Tab` panel cycling. iPad/Bluetooth keyboard focus.

### 🔧 Onboarding & First-Run Experience (1-2 weeks)

**Priority: Medium** — #25 from original list. Guided walkthrough, explain OpenCode/server setup, animated workspace illustrations, "Quick start" to localhost:4096, tips carousel.

---

## NEW SUGGESTIONS (Not in original list)

### 🆕 PTY Session Persistence & Restore

**Priority: High** — When app backgrounds or reconnects, restore PTY session state (scrollback, cwd, env). Currently TerminalPanel creates new session on each connect.

### 🆕 Agent/Model Selection Persistence Per Session

**Priority: High** — Currently `currentAgentKey`/`currentModel` are global. Should persist per-session and restore when switching sessions.

### 🆕 Session Title Auto-Generation

**Priority: Medium** — Auto-generate session title from first user prompt or first assistant response (first 50 chars), editable via long-press.

### 🆕 Message Branching / Fork Conversation

**Priority: Medium** — Long-press a message → "Fork from here" to create new session with context up to that point. Useful for exploring alternatives.

### 🆕 Tool Output Diff View Improvements

**Priority: Medium** — UnifiedDiff exists but could add: inline vs side-by-side toggle, syntax highlighting in diff, "Apply" button for patches, ignore whitespace option.

### 🆕 Voice Input for Prompts

**Priority: Low** — Add microphone button in composer, use `expo-speech` or native speech-to-text for hands-free prompting.

### 🆕 Scheduled/Auto Prompts

**Priority: Low** — "Run every 5 min", "Run on file change" presets. Useful for monitoring tasks.

### 🆕 Search Across All Sessions

**Priority: Medium** — Global search across all session messages (not just current), with session filter.

### 🆕 Plugin/Extension UI in Settings

**Priority: Low** — PluginManagerScreen exists but could show: plugin status, enable/disable toggle, config UI for each plugin, install from registry.

---

## TECHNICAL DEBT / MAINTENANCE

### 🔧 TypeScript Strict Mode Cleanup

**Priority: Medium** — Enable `strict: true` in tsconfig, fix any resulting errors. Currently has some `any` and loose types.

### 🔧 Test Coverage

**Priority: Medium** — Add unit tests for hooks (`use-offline-queue`, `use-reconnect`), components (`MarkdownRenderer`, `MessageSearchBar`), and utilities. Use Bun test runner.

### 🔧 ESLint Flat Config Migration

**Priority: Low** — Already on ESLint 10 flat config (`eslint.config.mjs`). Ensure all rules are intentional.

### 🔧 Expo SDK 57 / RN 0.86 Migration (When Ready)

**Priority: Low** — Blocked on Windows MAX_PATH with gesture-handler 3.x. Monitor `expo install --check` and upstream fixes.

### 🔧 Accessibility Audit (WCAG 2.1 AA)

**Priority: Medium** — #18 partial. Full audit: VoiceOver/TalkBack walkthrough, reduce motion, dynamic type beyond 4 steps, color-blind themes (high-contrast exists).

---

## PRIORITY MATRIX

| Feature                   | Effort  | Impact              | Priority | Status  |
| ------------------------- | ------- | ------------------- | -------- | ------- |
| Fix ESLint warnings       | 30 min  | Code quality        | Critical | 🔴 TODO |
| getItemLayout on FlatList | 1 day   | Performance         | High     | 🔴 TODO |
| Haptic Feedback           | 1 day   | Polish/UX           | High     | 🔴 TODO |
| Notification Actions      | 2 days  | Mobile UX           | High     | 🔴 TODO |
| Clipboard Enhancements    | 1 day   | Dev productivity    | Medium   | 🔴 TODO |
| Split-View Terminal+Chat  | 1-2 wks | Tablet productivity | High     | 🔴 TODO |
| Export/Share Session      | 1 week  | Sharing/Archive     | High     | 🔴 TODO |
| Custom Theme Builder      | 1 week  | Personalization     | Medium   | 🔴 TODO |
| Agent Activity Timeline   | 1-2 wks | Visibility          | Medium   | 🔴 TODO |
| Token Usage Display       | 1 week  | Cost awareness      | Medium   | 🔴 TODO |
| PTY Session Restore       | 1-2 wks | Reliability         | High     | 🔴 NEW  |
| Per-Session Agent/Model   | 1 week  | Workflow            | High     | 🔴 NEW  |
| Session Title Auto-Gen    | 3 days  | UX                  | Medium   | 🔴 NEW  |
| Message Branching         | 1-2 wks | Exploration         | Medium   | 🔴 NEW  |
| Global Search             | 1 week  | Discovery           | Medium   | 🔴 NEW  |

---

## RECOMMENDED EXECUTION ORDER

**Week 1 (Quick Wins):**

1. Fix all ESLint unused variable warnings
2. Implement `getItemLayout` on message FlatList
3. Add haptic feedback with Settings toggle

**Week 2:** 4. Notification actions for permissions 5. Clipboard enhancements (copy tool outputs, paste-to-attach)

**Week 3-4 (High Impact):** 6. Split-view Terminal + Chat on tablets 7. PTY session persistence & restore

**Week 5-6:** 8. Export & Share session transcript 9. Per-session agent/model persistence

**Week 7-8:** 10. Custom Theme Builder 11. Agent Activity Timeline

**Ongoing:**

- Accessibility audit
- Test coverage
- Technical debt reduction

---

_Last updated: 2026-08-26_
_Total original suggestions: 25 | Completed: 9 | Partial: 2 | Remaining: 14 | New additions: 9_
