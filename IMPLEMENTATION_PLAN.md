# Desk Escape — Implementation Plan

## Phase 1: Quick Wins (Week 1-2)

### 1.1 Fix ESLint Unused Variable Warnings (30 minutes)

**Files to fix:**

- `src/api/hooks.ts:208` — Remove unused `sessionResult` in `useCurrentAgent`
- `src/components/AgentPicker.tsx:3` — Remove unused `FlatList` import
- `src/components/AgentPicker.tsx:31` — Remove unused `spacing`, `typography` destructuring
- `src/components/ModelPicker.tsx:65` — Remove unused `spacing`, `typography` destructuring
- `src/components/WorkspaceToolbar.tsx:3` — Remove unused `Bot` import
- `src/context/ConnectionContext.tsx:7-8` — Remove unused `Agent`, `Model` imports

**Verification:** Run `bun run lint` — should pass with no warnings.

---

### 1.2 Implement `getItemLayout` on Message FlatList (1 day)

**File:** `src/components/AgentChat.tsx`

**Current state:** `onScrollToIndexFailed` uses fallback estimation (~200px/message).

**Implementation:**

```typescript
// Add to AgentChat component
const getItemLayout = useCallback((_data: unknown, index: number) => ({
  length: 200, // Estimated height - can be improved with measurement
  offset: 200 * index,
  index,
}), []);

// Pass to FlatList
<FlatList
  ...
  getItemLayout={getItemLayout}
  ...
/>
```

**Better approach:** Use `onContentSizeChange` and `onLayout` to build a dynamic layout map for variable-height messages.

**Acceptance criteria:**

- `scrollToIndex` works instantly for search results
- No more `onScrollToIndexFailed` fallback warnings
- Smooth scrolling to arbitrary message indices

---

### 1.3 Add Haptic Feedback (1 day)

**New dependency:** `expo-haptics` (already in Expo SDK)

**Files to modify:**

- `src/context/PreferencesContext.tsx` — Add `hapticsEnabled` preference
- `src/screens/SettingsScreen.tsx` — Add toggle in "Agent chat" or new "Feedback" section
- `src/components/AgentChat.tsx` — Trigger on send
- `src/components/WorkspaceToolbar.tsx` — Trigger on panel switch
- `src/context/ConnectionContext.tsx` — Trigger on connect/error/reconnect

**Implementation:**

```typescript
import * as Haptics from "expo-haptics";

// In relevant handlers
const triggerHaptic = (
  type: "light" | "medium" | "heavy" | "success" | "warning" | "error",
) => {
  if (!hapticsEnabled) return;
  switch (type) {
    case "light":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case "medium":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case "heavy":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      break;
    case "success":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case "warning":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case "error":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
  }
};
```

**Events to add haptics:**

| Event                       | Style   |
| --------------------------- | ------- |
| Message sent                | Light   |
| Permission request received | Medium  |
| Connection established      | Success |
| Connection failed           | Error   |
| Reconnection started        | Warning |
| Agent starts/stops          | Light   |

**Acceptance criteria:**

- All haptic triggers fire correctly
- Settings toggle enables/disables all haptics
- No haptics on devices without haptic engine (graceful)

---

### 1.4 Notification Actions for Permission Requests (2 days)

**Files to modify:**

- `src/services/notifications.ts` — Add actions to notification content
- `src/components/PermissionBanner.tsx` — Handle action responses
- `src/context/ConnectionContext.tsx` — Export `respondToPermission` for notification handler

**Implementation:**

```typescript
// In notifications.ts - when creating permission notification
const notificationContent = {
  title: "Permission Request",
  body: `${toolName} wants to ${action}`,
  data: { permissionId, sessionId },
  categoryId: "permission-request",
};

// Register category with actions
await Notifications.setNotificationCategoryAsync("permission-request", [
  {
    identifier: "allow",
    buttonTitle: "Allow",
    options: { isAuthenticationRequired: false },
  },
  {
    identifier: "reject",
    buttonTitle: "Reject",
    options: { isDestructive: true },
  },
  {
    identifier: "always-allow",
    buttonTitle: "Always Allow",
    options: { isAuthenticationRequired: false },
  },
]);

// In notification response handler
const handleNotificationResponse = (
  response: Notifications.NotificationResponse,
) => {
  const { permissionId, sessionId } =
    response.notification.request.content.data;
  const action = response.actionIdentifier; // 'allow', 'reject', 'always-allow'

  // Call respondToPermission via ConnectionContext or direct API
  respondToPermission(sessionId, permissionId, action);
};
```

**Acceptance criteria:**

- Permission notifications show Allow/Reject/Always Allow buttons
- Tapping action responds without opening app
- Notification updates to show result after action
- Works on both iOS and Android

---

### 1.5 Clipboard Integration Enhancements (1 day)

**Files to modify:**

- `src/components/chat/ChatMessageBubble.tsx` — Add copy button to tool outputs
- `src/components/AgentChat.tsx` — Add paste-to-attach handler
- `src/components/chat/MarkdownRenderer.tsx` — Already has copy on code blocks

**Implementation:**

1. **Copy tool output:** In `CollapsiblePartGroup.tsx`, add copy button next to label
2. **Copy full message:** Long-press on assistant bubble → "Copy response"
3. **Paste-to-attach:** In composer, detect paste of code/text → offer "Attach as context"

```typescript
// In AgentChat composer
const handlePaste = useCallback(() => {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.readText().then((text) => {
      if (text && text.length > 50) {
        // Heuristic: looks like code
        // Show toast: "Paste as context attachment?"
        // On confirm: addContextAttachment(text)
      }
    });
  }
}, [addContextAttachment]);
```

**Acceptance criteria:**

- Copy button on every tool output (bash, edit, read, etc.)
- Long-press assistant message → "Copy response" action
- Paste code in composer → prompt to attach as context file
- All copied content includes relevant metadata

---

## Phase 2: High Impact Features (Week 3-6)

### 2.1 Split-View Terminal + Chat on Tablets (1-2 weeks)

**Files to create/modify:**

- `src/components/SplitViewTerminalChat.tsx` — New component
- `src/screens/WorkspaceScreen.tsx` — Integrate split view
- `src/context/PreferencesContext.tsx` — Add split ratio preference

**Design:**

```
┌─────────────────────────────────────┐
│ Header (worktree, status, actions)  │
├─────────────┬───────────────────────┤
│             │                       │
│  Terminal   │     Agent Chat        │
│  (PTY)      │                       │
│             │                       │
├─────────────┼───────────────────────┤
│             │  Composer / Input     │
└─────────────┴───────────────────────┘
```

**Key features:**

- Draggable vertical divider (PanGestureHandler)
- Configurable ratios: 50/50, 60/40, 70/30 (saved in Preferences)
- Sync: When agent runs bash command, highlight in terminal AND scroll chat to that message
- Persist split preference per device orientation

**Acceptance criteria:**

- Works on tablets (width >= 600dp) in landscape
- Smooth divider drag with live resize
- Sync scrolling between panes
- Preference persists across app restarts
- Falls back to tabs on phone/portrait

---

### 2.2 PTY Session Persistence & Restore (1-2 weeks)

**Files to modify:**

- `src/components/TerminalPanel.tsx`
- `src/api/use-pty-session.ts`
- `src/context/ConnectionContext.tsx`

**Current issue:** New PTY session created on each connect; scrollback, cwd, env lost.

**Implementation:**

1. Track PTY session ID in ConnectionContext
2. On disconnect: store session ID + scrollback (last N lines)
3. On reconnect: attempt to resume same PTY session via `client.pty.connect(sessionId)`
4. If resume fails: create new, restore scrollback buffer

**API flow:**

```typescript
// On disconnect
const ptySessionId = await client.pty.create({ ... });
await savePtySession(ptySessionId, scrollbackBuffer);

// On reconnect
try {
  await client.pty.connect({ sessionId: savedPtySessionId });
  // Restore scrollback
} catch {
  // Create new, restore scrollback
}
```

**Acceptance criteria:**

- Terminal scrollback survives app background/foreground
- Working directory preserved across reconnects
- Environment variables preserved
- Graceful fallback if session expired on server

---

### 2.3 Export & Share Session Transcript (1 week)

**Files to create:**

- `src/utils/export-session.ts`
- `src/components/ExportSessionModal.tsx`
- Integration in `WorkspaceToolbar` or `SessionPicker`

**Export formats:**

1. **Markdown** — Human readable, includes tool outputs, thinking blocks
2. **JSON** — Full fidelity for programmatic use
3. **PDF** — Via `expo-print` + `expo-sharing`

**Markdown structure:**

```markdown
# Session: {title}

**Date:** {created}
**Agent:** {agentName}
**Model:** {provider}/{model}

---

## User

{message}

## Assistant

{markdown content with code blocks}

### Tool: bash

\`\`\`bash
$ command
output
\`\`\`

### Thinking

<thinking>...</thinking>
```

**Acceptance criteria:**

- Export current session from toolbar/menu
- Choose format (MD/JSON/PDF)
- Include/exclude thinking blocks option
- Native share sheet (iOS Files, Android Share)
- Save to device files/downloads

---

### 2.4 Per-Session Agent/Model Persistence (1 week)

**Files to modify:**

- `src/context/ConnectionContext.tsx` — Store per-session selection
- `src/api/hooks.ts` — Fetch session metadata including agent/model
- `src/screens/WorkspaceScreen.tsx` — Restore on session switch

**Data model:**

```typescript
interface SessionMetadata {
  sessionId: string;
  agentKey: string | null;
  model: { providerId: string; modelId: string } | null;
}
```

**Storage:** AsyncStorage keyed by `sessionId` + `baseUrl`

**Behavior:**

- When switching sessions: restore agent/model from metadata
- When changing agent/model in session: persist immediately
- Default to global default if no session metadata

**Acceptance criteria:**

- Switch session → agent/model chips update to session's values
- Change agent in session A → switch to session B → back to A → agent preserved
- Works across app restarts

---

## Phase 3: Polish & Differentiation (Week 7-10)

### 3.1 Custom Theme Builder (1 week)

**Files to create:**

- `src/screens/ThemeBuilderScreen.tsx`
- `src/context/ThemeContext.tsx` — Add custom theme support

**Features:**

- Color picker for each semantic token (background, surface, accent, text, border, etc.)
- Live preview in modal
- Import/export JSON
- "Save as Custom" slot in theme picker
- Reset to preset button

**Theme JSON schema:**

```json
{
  "name": "my-custom-theme",
  "label": "My Theme",
  "colors": {
    "background": "#0D1117",
    "surface": "#161B22",
    "accent": "#58A6FF",
    ...
  },
  "spacing": { "xs": 4, "sm": 8, ... },
  "typography": { "body": 14, "mono": 13, ... }
}
```

**Acceptance criteria:**

- 8 preset themes + 1 custom slot
- Full color customization with live preview
- Export/import works
- Custom theme persists

---

### 3.2 Agent Activity Timeline (1-2 weeks)

**Files to create:**

- `src/components/AgentActivityTimeline.tsx`
- Integration in `WorkspaceScreen.tsx` header area

**Data source:** Stream events from `eventBus` (already available in ConnectionContext)

**Visual design:**

```
┌─────────────────────────────────────────────────┐
│ 🔍 read  ✏️ edit  ⚡ bash  💭 think  ✅ done     │
│ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└─────────────────────────────────────────────────┘
```

**Features:**

- Horizontal scrollable timeline
- Icons per tool type (read, edit, bash, task, grep, etc.)
- Status colors: pending (gray), running (blue pulse), success (green), error (red)
- Tap step → scroll chat to corresponding message
- Pulsing animation on currently executing step
- Collapse/expand toggle

**Acceptance criteria:**

- Timeline updates in real-time during agent execution
- Tap navigation works
- Visual feedback on current step
- Doesn't clutter UI on small screens (hide on phone portrait)

---

### 3.3 Token Usage Display (1 week)

**Files to create:**

- `src/components/TokenUsageDisplay.tsx`
- `src/screens/UsageStatsScreen.tsx` (or integrate in Settings)

**Data source:** Check if SDK exposes token counts in message info. If not, estimate via `tiktoken` or similar.

**Features:**

- Per-session token count (input/output/total)
- Cost estimation based on model pricing
- 7-day / 30-day usage charts
- Per-model breakdown
- Export usage report

**Acceptance criteria:**

- Shows tokens for current session in toolbar/session info
- Settings screen has usage dashboard
- Cost estimates match provider pricing
- Data persists locally

---

## Technical Implementation Notes

### Code Style & Conventions

- Use `bun` for all package management and scripts
- TypeScript strict mode (enable incrementally)
- React Native StyleSheet for styles (no styled-components)
- lucide-react-native for icons
- Expo SDK 56 stable — no canary/beta

### Testing Strategy

- Unit tests for hooks: `use-offline-queue`, `use-reconnect`, `use-pty-session`
- Component tests for: `MarkdownRenderer`, `MessageSearchBar`, `CodeBlock`
- Integration test: offline queue flush on reconnect
- Run with `bun test`

### Git Workflow

- Feature branches from `main`
- No direct commits to `main` without PR
- Conventional commit messages
- Squash merge

### Performance Budgets

- App cold start < 3s
- Message list 60fps scroll with 1000+ messages
- Search results < 100ms
- Terminal PTY latency < 50ms local

---

## Dependencies to Add

| Package                                  | Purpose            | Phase  |
| ---------------------------------------- | ------------------ | ------ |
| `expo-haptics`                           | Haptic feedback    | 1.3    |
| `expo-print` + `expo-sharing`            | PDF export         | 2.3    |
| `react-native-gesture-handler` (already) | Split view divider | 2.1    |
| `expo-speech` (optional)                 | Voice input        | Future |

---

## Risk Mitigation

| Risk                                              | Mitigation                                                    |
| ------------------------------------------------- | ------------------------------------------------------------- |
| Expo SDK 57 / RN 0.86 path limit                  | Stay on SDK 56 until resolved; monitor `expo install --check` |
| PTY session resume not supported by server        | Graceful fallback to new session + scrollback restore         |
| Notification actions require specific Expo config | Test on both platforms early; document setup                  |
| Tablet split view layout complexity               | Start with fixed ratios, add drag later                       |
| Token counting not in SDK                         | Implement client-side estimation with `gpt-tokenizer`         |

---

## Success Metrics

- Zero ESLint warnings
- 95%+ crash-free sessions
- < 100ms search latency
- 60fps scroll at 1000 messages
- User retention: 7-day > 40%, 30-day > 20%
- App store rating > 4.5

---

_Plan created: 2026-08-26_
_Next review: After Phase 1 completion_
