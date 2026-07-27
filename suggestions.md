# Desk Escape — Feature Suggestions

A curated list of features and improvements that could enhance the Desk Escape mobile client for OpenCode.

---

## 1. Message Search & Filtering

**Priority: High**

Add the ability to search within the current session's chat history. The message list can grow long during extended coding sessions, and scrolling to find a specific response or tool output is tedious.

- Full-text search across all messages in the active session
- Filter by role (user, assistant), tool type, or time range
- Highlight matching text in results
- Jump-to-message on tap from search results

---

## 2. Inline Code Execution & Shell Command Sharing

**Priority: High**

When the agent runs a bash command via the tool system, provide a way to view and re-execute that command directly from the chat bubble — without switching to the terminal tab.

- Tap-to-copy on bash command output in the chat
- "Run in terminal" action that pipes the command into the active PTY session
- Syntax-highlighted code blocks in message rendering

---

## 3. Markdown & Code Block Rendering

**Priority: High**

Assistant responses contain markdown with fenced code blocks, inline code, lists, and links. Currently these render as raw text. Proper rendering would significantly improve readability.

- Render markdown in assistant messages (headings, bold, italic, lists)
- Syntax-highlighted code blocks with language labels
- Tappable links that open via `expo-web-browser`
- Copy button on code blocks
- Collapsible large code blocks (default collapsed)

---

## 4. Offline Queue for Prompts

**Priority: Medium**

When the network connection drops temporarily (common on mobile — switching between Wi-Fi and cellular), user prompts are lost. An offline queue would buffer prompts and send them once connectivity is restored.

- Queue prompts in AsyncStorage when the client is disconnected
- Show a "queued" indicator on buffered messages
- Auto-send on reconnection with a visible countdown/confirmation
- Configurable retry limit and timeout

---

## 5. Biometric App Lock

**Priority: Medium**

Desk Escape stores server credentials via `expo-secure-store`. Adding biometric authentication (Face ID / fingerprint) before the app reveals its content adds a meaningful security layer for a tool that has shell access to remote machines.

- Use `expo-local-authentication` for biometric gate
- Configurable: always on, on app foreground after 30s idle, or off
- Graceful fallback to device passcode
- Store lock preference in SecureStore

---

## 6. Notification Actions for Permission Requests

**Priority: Medium**

The notification system currently sends alerts for permission requests but the user must open the app to respond. Expo notifications support interactive actions natively.

- Add "Allow" and "Reject" as notification actions on the permission notification
- Handle the response in the notification handler and call `respondToPermission` directly
- Support "Always allow" as a third action for power users
- Show updated notification after the action is taken

---

## 7. Session History & Comparison

**Priority: Medium**

Allow users to view past sessions (which the API already supports listing) and compare them — useful for seeing how the agent approached the same problem differently.

- Browse a list of all past sessions with title, timestamp, and message count
- Read-only view of any past session's messages
- Side-by-side diff view between two sessions (or two messages)
- Pin/bookmark favorite sessions for quick access

---

## 8. Custom Theme Builder

**Priority: Low**

The 7 built-in themes cover a wide range, but allowing users to define their own theme would unlock personalization for users with specific accessibility needs or aesthetic preferences.

- A "Custom" theme slot with a color picker for each semantic color token
- Import/export theme as JSON
- Share themes via a deep link or QR code
- Preview theme changes live before saving

---

## 9. Haptic Feedback & Sound Design

**Priority: Low**

Small sensory touches make a mobile app feel polished. The current app is silent and vibration-free.

- Light haptic on message send
- Medium haptic on permission request received
- Success haptic on connection established
- Error haptic on connection failure
- Optional sound toggle in settings

---

## 10. Drag-and-Drop File Context Attachment

**Priority: Low**

The current file attachment flow requires navigating into the file drawer and long-pressing a file. On iPad (and future Android tablet support), drag-and-drop from a floating file list onto the chat input would feel natural.

- Floating draggable file chips that can be dropped onto the composer
- Drag from the file drawer directly into the chat area
- Visual drop zone indicator when a file is being dragged over the composer

---

## 11. Agent Activity Timeline

**Priority: Medium**

When the agent is actively working on a complex task, the user has limited visibility into what's happening beyond the latest message. A timeline view shows the full sequence of actions at a glance.

- Horizontal timeline bar below the header showing agent steps
- Each step shows icon (read, edit, bash, think) with status color
- Tap a step to jump to the corresponding message in the chat
- Animated pulsing indicator on the currently executing step

---

## 12. Multi-Server Connection Profiles

**Priority: Medium**

Users who manage multiple OpenCode servers (e.g., one for work, one for personal projects) currently need to re-enter credentials each time they switch. Saved connection profiles with one-tap switching would streamline this.

- Named connection profiles stored in AsyncStorage
- Quick-switch dropdown on the connection screen
- Remember the last-used profile per server
- Import/export profiles (encrypted if auth is enabled)

---

## 13. Split-View Terminal + Chat on Tablets

**Priority: Medium**

On tablets and larger screens (especially in landscape), showing the terminal and chat side-by-side would dramatically improve productivity. The current landscape layout only shows the file rail alongside the agent chat.

- Configurable split ratio (50/50, 60/40, 70/30)
- Draggable divider to resize panes
- Sync scroll position: when the agent outputs a terminal command, highlight it in both panes
- Persist split preference across sessions

---

## 14. Clipboard Integration

**Priority: Low**

Mobile development workflows heavily involve copying snippets. Tighter clipboard integration would reduce friction.

- "Copy" button on every tool output in the chat
- Long-press on assistant message to copy entire response
- Paste-to-attach: paste code from clipboard and automatically create a context attachment
- Clipboard history panel showing recent copies from the session

---

## 15. Dark Mode System Sync

**Priority: Low**

The app has 7 themes but none of them follow the device's system-wide dark/light mode preference.

- Add a "System" theme option that follows `Appearance.getColorScheme()`
- Automatically switch between the light and dark variant of the current theme
- Respect the user's system setting without requiring manual toggle

---

## 16. Rate Limit & Token Usage Display

**Priority: Low**

For users who pay per token on their OpenCode provider, understanding usage per session is valuable.

- Display estimated token count per session (if the SDK exposes it)
- Show token usage in the session picker / session info
- Cost estimation based on configured provider pricing
- Usage graph over the last 7/30 days

---

## 17. Widget for Quick Prompt (iOS/Android)

**Priority: Low**

A home screen widget that lets users fire off a quick prompt without opening the full app.

- Small widget: shows last agent status + one-tap "Run test suite" style preset
- Medium widget: text input to type a quick prompt
- Uses the last connected server config
- Displays a notification when the agent responds

---

## 18. Accessibility Audit & Improvements

**Priority: Medium**

For an app used by developers (who spend long hours staring at screens), accessibility is important.

- Ensure all interactive elements have proper `accessibilityLabel` and `accessibilityRole`
- VoiceOver/TalkBack navigation walkthrough
- Reduce Motion support: respect `prefers-reduced-motion` for animations
- Dynamic Type support beyond the current 4-step font scale
- Color-blind friendly theme option (already partially covered by "High Contrast")

---

## 19. Error Recovery & Reconnection Logic

**Priority: High**

The app currently handles disconnections but lacks sophisticated recovery.

- Auto-reconnect on WebSocket/PTY disconnection with exponential backoff
- Visual "reconnecting..." indicator with countdown
- Queue pending prompts during brief disconnections
- Background reconnection: if the app is backgrounded and the server restarts, reconnect on foreground
- Connection health ping every 30 seconds

---

## 20. App Shortcuts & Deep Links

**Priority: Low**

Power users benefit from shortcuts that bypass navigation.

- iOS Shortcuts / Android App Shortcuts for: "New Session", "Last Session", "Run Preset"
- Deep link scheme: `desk-escape://connect?host=...` to pre-fill connection screen
- Siri / Google Assistant integration for "Open Desk Escape and run tests"

---

## 21. Export & Share Session Transcript

**Priority: Medium**

Users may want to share an agent conversation with a colleague or archive it locally.

- Export session as Markdown or PDF
- Share via the native share sheet
- Include tool outputs and thinking blocks (optionally)
- Save to Files app (iOS) or Downloads (Android)

---

## 22. Collaborative Sessions (Multi-User)

**Priority: Low (Long-term)**

If OpenCode supports multi-user sessions, Desk Escape could allow multiple mobile users to view and interact with the same session.

- Live presence indicators (who's watching)
- Permission to send prompts or only view
- Shared annotation/highlighting on messages
- @mention to delegate tasks to another connected user

---

## 23. Performance Optimizations

**Priority: High**

As sessions grow, the FlatList of messages can become sluggish. Proactive performance work is warranted.

- Implement `getItemLayout` on the message FlatList for fixed-height optimization
- Use `React.memo` with careful comparison on `ChatMessageBubble` and sub-components
- Lazy-load thinking/tool parts that are collapsed (only render when expanded)
- Virtualize the diff view for large patches
- Profile and reduce re-renders in `WorkspaceScreen` (currently re-creates styles on every state change)

---

## 24. Keyboard Shortcuts (External Keyboard)

**Priority: Low**

On iPad with a keyboard, or Android with a Bluetooth keyboard, keyboard shortcuts would speed up navigation.

- `Cmd+K` / `Ctrl+K` to open command palette
- `Cmd+N` / `Ctrl+N` to create new session
- `Cmd+T` / `Ctrl+T` to switch to terminal panel
- Arrow key navigation in the message list
- `Tab` to cycle between panels

---

## 25. Onboarding & First-Run Experience

**Priority: Medium**

The current app drops users onto the connection screen with minimal guidance. A guided onboarding flow would reduce friction for new users.

- Step-by-step walkthrough on first launch
- Explain what OpenCode is and how to set up a server
- Animated illustrations showing the workspace layout
- "Quick start" option that auto-connects to `localhost:4096`
- Tips carousel after first successful connection
