# Desk Escape — Feature Suggestions

A grounded, verified inventory of features and fixes that could be implemented in the Desk Escape mobile client for OpenCode.

**Last updated:** 2026-10-03

**Verified against:** `main` @ `4075f6a` (`feat(api)!: migrate data layer to OpenCode V2 client`)

**Method:** every claim below was checked against source at the file:line given. Items marked✅

**BROKEN** were confirmed by direct inspection, not inferred.> This document replaces the 2026-08-26 version. Several of its items were already shipped or> were based on stale premises — see [Corrections](#1-corrections-to-the-previous-suggestions-doc)> before reusing any of the old list.---

## Current Baseline

|                  |                                                                                   |
| ---------------- | --------------------------------------------------------------------------------- |
| Expo SDK         | `~57.0.26`                                                                        |
| React Native     | `0.86.3`                                                                          |
| OpenCode client  | `@opencode/client` `2.0.22` (V2 API)                                              |
| Backends         | OpenCode (SSE + PTY) + Cursor Cloud Agents (REST)                                 |
| Native dirs      | **None committed** — pure CNG, `expo prebuild` in CI                              |
| Tests            | 102 tests / 3 files via `bun test`; `applyStreamEvent` covered                    |
| SDK methods used | **~29 of ~110**                                                                   |
| Code health      | 0 `TODO`/`FIXME`/`@ts-ignore`/`as any`; 7 `eslint-disable`, each justified inline | **Updated 2026-10-03.** The clipboard, Face ID, terminal theme, removable attachments, and CIgaps are fixed, and the test suite now exists. Everything else below still stands. The code is genuinely well-maintained. The real opportunity is **unused SDK surface** and**unverified behaviour**, not code rot.--- |

## 1. Corrections to the previous suggestions doc

. These were listed as `🔴 TODO` but are either shipped or were never accurate. Do not re-implement.| Old item | Status | Reality |
| --------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Haptic feedback (#9) | ✅ **Shipped** | `src/hooks/useHaptics.ts`, Settings toggle, 6 call sites |
| Notification actions (#6) | ✅ **Shipped** | `services/notifications.ts:20-38`, `PermissionContext.tsx:176-229` |
| Clipboard / paste-to-attach (#14) | ✅ **Shipped** | `AgentChat.tsx:552-589` — but the copy half is **broken**, see §2.1 |
| Export & share session (#21) | ✅ **Shipped (MD only)** | `utils/export-session.ts` — no JSON/PDF path |
| Fix ESLint unused vars (6 items) | ❌ **Stale** | All 6 files were fixed. Do not act on lines 53-62 of the old doc |
| Enable TypeScript `strict` | ❌ **Stale** | `tsconfig.json:4-5` already has `strict: true` **and** `noUncheckedIndexedAccess: true` |
| Migrate to Expo 57 / RN 0.86 | ❌ **Stale** | Already there. The MAX_PATH blocker described in `AGENTS.md` is resolved |
| `getItemLayout` on message list | ❌ **Stale premise** | There is no `onScrollToIndexFailed` in the codebase. The list is `inverted` (`AgentChat.tsx:465`) |
| "Virtualized diff view" | ❌ **Inaccurate** | `UnifiedDiff.tsx:247-280` is a plain `ScrollView` over all files × hunks × lines |
| "Run in terminal pipes to PTY" | ❌ **Inaccurate** | `AgentChat.tsx:418-424` sends code as an OpenCode slash-command name. It never reaches the PTY |
| "Biometric lock falls back to passcode" | ❌ **Inaccurate** | `useBiometricLock.ts:46` sets `disableDeviceFallback: true` |
| README "7 Themes" | ❌ **Stale** | 8 themes exist (`ThemeContext.tsx:95-97,211,255`). But `themeCycleOrder` in `CommandPalette.tsx:311-319` omits `hacker` |---

## 2. Verified Bugs — Fix First

These are confirmed defects, not enhancements. Each is small and self-contained.

### 2.1 ✅ FIXED — Clipboard did nothing (High)

_Fixed 2026-10-03._ Every copy path used `navigator.clipboard`, which **does not exist in React Native/Hermes**, and `expo-clipboard` was not a dependency. Worse, three call sites setthe "Copied" checkmark _outside_ the guard, so the UI reported success while copying nothing.| File | Line | Symptom (was) |
| ------------------------------------------ | ------- | ---------------------------------------------------------------- |
| `components/chat/MarkdownRenderer.tsx` | 46-51 | Copy button on code blocks — **showed "Copied", copied nothing** |
| `components/chat/CollapsiblePartGroup.tsx` | 175-180 | Same, for tool output — **false success state** |
| `components/chat/ThinkingPartGroup.tsx` | 179-186 | Same, for thinking blocks — **false success state** |
| `components/chat/ChatMessageBubble.tsx` | 114-117 | Long-press copy — silently no-ops |
| `components/AgentChat.tsx` | 553-555 | Paste-to-attach never read |**Resolution:** added `expo-clipboard` plus a single `src/utils/clipboard.ts` helper whose`copyToClipboard()` returns a boolean. All five sites now gate their success UI on thatreturn value, so a failed write shows no confirmation rather than a false one.`readFromClipboard()` replaces the paste path.

### 2.2 ✅ FIXED — Terminal theme injection was dead code (Medium)

_Fixed 2026-10-03._ The bundled shell reads `config.theme.background/foreground` from `window.__TERMINAL__` (`scripts/build-terminal-shell.mjs:30,55-57`), but `TerminalPanel.tsx:142-153` built that object as `{wsUrl, auth}` with **no `theme` key**. Itseparately injected `window.__TERMINAL_THEME__` — a global the shell never reads. The terminalwas therefore always `#0a0a0a`/`#f5f5f5`, and the two light themes rendered a dark terminal.

**Resolution:** `theme` is now part of the `__TERMINAL__` payload the shell actually reads, andthe dead `__TERMINAL_THEME__` global is gone. The shell also exposes `window.__TERMINAL_APPLY_THEME__`, which `TerminalPanel` calls via `injectJavaScript` when theapp theme changes. That fixes more than correctness: the old code swapped `source.html` ontheme change, which **reloaded the WebView and discarded the 5000-line scrollback buffer**.
Theme changes are now non-destructive. The shell body background moved to a `--terminal-bg`CSS variable so it stops painting black during load.

### 2.3 ✅ FIXED — Server-side PTY leak (Medium)

> **Correction to the original report.** There is no `client.pty.delete` / `.kill` / `.destroy`.> The SDK method is **`client.pty.remove({ ptyID, location })`** — verified against> `@opencode/client/dist/promise/generated/client.d.ts`. The report guessed at names that do not> exist, which is part of why this was never fixed: searching for them found nothing to call. The finding itself was correct: nothing in the codebase ever removed a PTY, so every shell everstarted stayed on the server. But "just delete it on unmount" is the wrong fix, and the reason isthe thing the original report missed.**Ownership.** `pty.list` returns whatever is running in a directory, which may include a shellstarted by _another_ client, or by the user on the desktop yesterday. Deleting a shell this devicedid not start destroys someone else's work — a running build, a `cd` deep in a tree, a half-typedcommand. Without an ownership record the only safe cleanup is none, which is precisely the statethe code was in. `use-pty-session.ts` now tracks the ids it created, per directory (a `Map`, soswitching worktrees does not orphan the previous one), and only ever auto-removes those.**Not on unmount.** `TerminalPanel` unmounts every time the user switches back to the chat, and theshell is per-_directory_, not per-panel. Deleting on unmount would throw away the user's shell onevery tab switch — a much worse failure than a lingering PTY. Cleanup is driven by explicit intentinstead:| Trigger | Deletes | Why it's safe |
> | ----------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
> | Shell preference changed | Only an **owned** running PTY | This device started the wrong shell; an adopted one is left alone |
> | "Kill shell" (tap-to-confirm in the panel status bar) | The current PTY, owned or not | Explicit user intent; the one path that can kill an adopted shell |
> | On mount, `pty.list` returns `status: "exited"` | Those records | Dead tombstones, nobody's session |
> | Unmount / tab switch | **Nothing** | Session continuity — the shell is per-directory |Exited records are pruned on sight because they accumulate forever: the list endpoint never dropsthem, so a long-lived server fills with tombstones and the one usable shell gets harder to find.**Two bugs found while writing this, both fixed.** (1) The `status === "ready" && ptyId`short-circuit sits _above_ the shell-change check, so §2.4 was still broken after the firstattempt to fix it — `shell` is a dependency of the effect that makes the decision, and the earlyreturn swallowed the change. The ordering is now explicit in `shouldKeepSession`. (2) If an attempt is cancelled after `pty.create` has already resolved server-side, the shell exists but is neverrecorded, so no cleanup path can ever reach it. Ownership is now recorded _before_ the cancellation guard. Deliberately still out of scope: a full PTY list/manage UI (§6.8) and`experimental.persistentPty.*`, which is the real answer to PTY persistence (`snapshot`, `handoff`,`shutdown`). The kill-shell action covers the case a list UI would have solved.

### 2.4 ✅ FIXED — Shell preference is inert after first creation (Medium)

`use-pty-session.ts` listed `shell` in its effect deps, but `ensurePty` early-returned on `status === "ready" && ptyId`, so changing the shell in Settings did nothing until the directorychanged or you reconnected.
Fixed as a consequence of §2.3: a shell-preference change now marks the current PTY as needing replacement, and `shouldKeepSession` refuses to short-circuit a ready session when that is true. An_owned_ PTY is removed and recreated with the new shell; an _adopted_ one is left running, becauseit is not this device's to recycle.
Note the ordering trap above — the obvious fix (drop the early return, or hoist the shell check)still leaves the bug in place unless the shell check wins over the `ready` check. Both orderings andthe empty-string id case are pinned in `src/api/__tests__/pty-lifecycle.test.ts` (27 tests, mutation-verified).

### 2.5 ✅ BROKEN — `activityScore` is permanently zero (Low)

`utils/session-ranking.ts:18` reads `session.summary?.additions`, but `toSession`(`api/opencode/adapter.ts:325-338`) never populates `summary`. 25% of the session-rankingcomposite is always 0, so ranking degrades to "most recent wins".

### 2.6 ✅ FIXED — Biometric lock does not re-lock on background (Medium)

_Fixed 2026-10-03._ `useBiometricLock` evaluated the stored flag once on mount and had no `AppState` listener, so the lock was effectively **one-shot**: a single successful unlock leftthe app open until the process died.
The rules now live in `hooks/biometric-lock-state.ts` as a pure function so they can be testedwithout React Native, and two failure modes are handled that are invisible in manual testing:-

**Never lock while unlocking.** `authenticateAsync` backgrounds the app on Android and presents a system overlay on iOS. Re-locking on that transition makes the prompt unreachable and the app permanently unusable. Guarded and mutation-verified.-

**Never prompt while backgrounded.** Re-locking means `lockState` becomes `"locked"` while nothing is on screen, and a prompt raised from the background fails on iOS — which reads as a _failed unlock_ and bounced the user to Connection. The hook now exposes `appActive` and the screen's auto-authenticate effect waits for it. Returning to `active` deliberately does **not** unlock; that stays the screen's decision, sounlocking is not a side effect of resuming.

### 2.7 ✅ FIXED — `ci.yml` silently swallowed two failures (Medium)

_Fixed 2026-10-03._ Both failures are now hard errors:- `ci.yml:39` — was `bun run check:install |
| true`. Dependency drift never failed CI. Now runs bare, so a version outside what Expo pins fails the build. Verified locally: "Dependencies are up to date".- `ci.yml:84` — APK upload was `if-no-files-found: warn`, so a build producing no APK still passed. Now `if-no-files-found: error`. Also added a `bun run test` step, so tests gate the Android build.

### 2.8 ✅ FIXED — `NSFaceIDUsageDescription` missing from iOS config (High on iOS)

_Fixed 2026-10-03._ `app.json:15-18` set only `NSAllowsArbitraryLoads`.`expo-local-authentication` is installed and Settings exposes Face ID, but iOS **crashes** on Face ID auth without the usage description. Added `NSFaceIDUsageDescription`, plus `ios.bundleIdentifier` (`app.deskescape.app`) since it was absent.
Note: iOS is still never built in CI, so this fix is unverified on a real iOS build.

### 2.9 ✅ FIXED — `release.ps1` force-pushed the working tree (High)

_Fixed 2026-10-03._ `scripts/release.ps1` ran `git add . && git commit && git push --tags` withno confirmation and no clean-tree check. Verified concretely: on this branch `git add --dry-run .`stages **30 paths** of unrelated in-progress work, all of which would land in a `chore(release): …` commit and be pushed. It also contradicted the `AGENTS.md` rule "Do not git commit or push unless explicitly requested". Investigating turned up **three** more defects, so the script was rewritten rather than patched:1.

**It could never have worked.** `bun run changelog` shells out to `conventional-changelog`, which is neither declared in `devDependencies` nor installed — the script died at step 2 of 5 and never reached the dangerous `git add .`. The `git add .` risk was latent, not firing.2. **`$(bun pm version)` in the commit message** expands as the command's _output_. Bare `bun pm version` prints its **help text**, so the release commit message was a multi-line dump of CLI usage.3. **`bun pm version` commits and tags on its own.** The script then committed again, so the "release commit" was whatever happened to be staged at that moment. What the rewrite does:- Refuses to start on a dirty tree, listing the paths. `bun pm version` also refuses, but only _after_ rewriting `package.json`, leaving a half-applied bump; checking first removes that.- Stages exactly `package.json`, `bun.lock`, `CHANGELOG.md`, then **verifies nothing else is staged** and aborts if so. This is the invariant that replaces `git add .`.- Bumps with `--no-git-tag-version` so the script owns the commit and the annotated tag.- Nothing is pushed without `-Push`. `-DryRun` previews and mutates nothing.- Requires the default branch, no unpushed commits, and no pre-existing tag.- On failure after the bump, prints the exact undo commands.

**Still open:** `release.yml` is not gated on CI (§11.2) — a tag push builds and publishesregardless of CI status. The changelog step is now best-effort with a warning; add the dependencyor delete the script to make it meaningful.

### 2.10 ✅ FIXED — Cursor provider's event listener leaked per send (Medium, Cursor mode)

`api/providers/cursor/provider.ts:165-178` registered a **new** event listener inside thesend loop and never removed it. Every prompt added another permanent listener, so after Nprompts a single `assistant` frame was folded into `_messages` N times — quadratic transcriptgrowth, not just a slow leak.

**Fixed:** the subscription is captured and released in a `finally`, so it is detached whetherthe stream ends cleanly or throws. Covered by four tests, including one that asserts the user-visible symptom (3 prompts × 1 frame ⇒ 3 messages, was 6).---

## 3. 🔴 Critical Missing Capability

### 3.1 ✅ FIXED — No way to stop a running agent

`session.interrupt` was available in the SDK and used nowhere, so a runaway agent could only bekilled by closing the app.

**Implemented:

**- `interruptSession(sessionId)` added to the `AgentProvider` interface, implemented by both backends — OpenCode via `client.session.interrupt`, Cursor via `cancelRun` plus teardown of its own SSE reader (`eventBus.stop()`).- `useInterruptSession` mutation in `hooks.ts`. Routes through the provider so Cursor can clean up after itself. On a successful interrupt it clears the busy flag and refreshes the cached message list so the transcript reflects the stopped turn immediately.- The composer's Send button is **replaced** by Stop while `agentActive` is true. `agentActive` comes from the event stream (`isAgentBusyEvent`), so it holds for the whole turn — unlike `isPending`, which only covers the HTTP call that queued the prompt. That distinction is what makes Stop meaningful rather than a flicker.

**Two subtleties worth keeping:

**- `resume` is deliberately **not** sent. `SessionInterruptInput` takes an optional `resume` flag that restarts the turn with the same input — the opposite of Stop, and it would re-run the agent's work. Guarded by a test asserting the key is absent, not merely falsy.- A `false` result is not an error: the turn may have finished between tap and request. Busy state is then left to the authoritative idle event rather than being forced.

### 3.2 ✅ FIXED — No file viewer

_Fixed 2026-10-03._ `file.read` was available and unused: the app could browse filenames butcould not open a file. Tapping a file did nothing; only long-press attached it to the prompt. Implemented:- `api/opencode/file-content.ts` — everything needed to present a file, derived from the bytes and the path because V2 returns a bare `Uint8Array` with no mime type, encoding, or size. Binary detection (decisive NUL byte plus a control-character ratio over the first 8 KB), a 512 KB cap enforced **before** decoding, markdown routing, and a language label for the header.- `useFileContent(path, enabled)` — reads on demand, keyed by path _and_ active directory so switching projects re-reads. `enabled` means a closed viewer holds no query.- `FileViewerSheet` — full-screen. Markdown formats go through `MarkdownRenderer`; everything else stays preformatted in a monospace scroll view. Binary, empty and oversized bodies each get an explanation rather than a screenful of replacement characters.- Tap now opens the file in both browsers (`FileDrawer`, `LandscapeFileRail`); long-press still attaches to the prompt.51 tests over the decoding rules. Two were worth the trouble: the first draft's binary fixtures allcontained a NUL, which short-circuits before the ratio is ever computed — so the 30% thresholdcould be **any** value and the suite still passed. Adding NUL-free fixtures made two thresholdmutations detectable. Writing the tests also found a real gap: `.md` files rendered as markdown but showed no language label.---

## 4. 🟠 High Value — One Endpoint Each

These are cheap because the SDK already implements them and the app already has thequery/transport layer.| # | Feature | SDK method | Effort | Note |
| -------- | ------------------------------ | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 | **Session rename** | `session.update` | 1 day | Ties into auto-title generation (4.2) |
| 4.2 | **Auto session titles** | `session.update` | 3 days | Derive from first user prompt; long-press to edit |
| 4.3 | **Fork / branch conversation** | `session.fork` | ? Done | `session.fork({sessionID, before?})`. Cut arithmetic and wording in pure `api/session-fork.ts`; transport in `api/fork.ts`; `useForkSession` returns the new `SessionInfo` so the caller can switch to it. Long press a message -> sheet with **Copy** / **Fork from here** / **Cancel**, replacing the long-press-copies-immediately behaviour that left nowhere for a second action. `before` is read as "excludes this message", on the parameter name plus the `session.forked` boundary vocabulary and with no server to probe - so the sheet _says which side each message lands on before the fork exists_, the same discipline as `session-revert.ts`. No fork from the first message (it would inherit nothing) or an id no longer in the list. Forks on success, alerts on failure |
| 4.4 | **Token & cost dashboard** | `session.stats`, `session.context` | ✅ Done | `StatsScreen` (workspace overflow → Usage & cost). 7/30/90/all ranges, headline tiles, per-day activity, five separate token figures, per-model spend share |
| 4.5 | **Undo / revert a turn** | `session.revert.stage/.clear/.commit` | ✅ Done | Two-phase: `stage` shows what the server says will change, `commit` applies it, `clear` abandons it. Workspace overflow → Undo last turn |
| 4.6 | **Manual compaction** | `session.compact` | 2 days | UI trigger for events already handled at `:559-562` |
| 4.7 | **Branch picker** | `vcs.branch.list`, `vcs.base` | 3 days | `vcs.diff` also supports `mode: "branch"` / `"committed"` — unused |
| 4.8 | **Deep linking** | — | 2-3 days | `NavigationContainer` has **no `linking` prop** despite `scheme: "desk-escape"` in `app.json:11`. No route takes params |
| 4.9 | **Permission queue** | `permission.request.list` | ✅ Done | Was: a **single** `pending` slot — a second request silently overwrote the first, and rehydration took only `requests[0]`. The agent blocks on requests in order, so a dropped one hung the turn with no visible cause. Now a FIFO queue keyed on request id (`api/permission-queue.ts`); `pending` is derived from the head, so the banner is unchanged apart from a "1 of N" count |
| ~~4.10~~ | ~~Review persisted grants~~ | ✅ **Fixed** | — | — |
| 4.11 | **Removable attachments** | - | ? Done | Extracted to `components/AttachmentChips.tsx` (was 40 lines of JSX and 7 styles inline in a 734-line `AgentChat`) and now render-tested. Remove reports the attachment **id** while the label is the path - only the id is unique, since `addContextAttachment` dedupes by path and two files can share a basename. "Clear all" only past one file: the chip's own cross already does that case, and a duplicate control is a mis-tap. `numberOfLines={1}` so a deep path ellipsises instead of running off the chip |
| 4.12 | **Server-derived shell list** | `config.shells` | 2 hours | `PreferencesContext.tsx:27-36` hardcodes 6 POSIX shells |---

## 5. 🟡 Substantial Features

### 5.1 Working "Run in Terminal" bridge (1 week)

—

**DONE (Batch 9)

**The Run button on code blocks used to call `session.command` with the code as a **command name**, which is why it never worked: `session.command` runs named slash commands, so a `bash` block askedthe server to find a command named `npm test`. It now writes to the active PTY over the existing WebSocket. Two things made this more than a one-line fix:- **`pty` has no `write` method** (`list`, `create`, `get`, `update`, `remove`, `connect.token` only). Writing happens _only_ over the WebSocket, and that socket is owned by the terminal WebView, which authenticates with a short-lived ticket in the URL. So the write is relayed through the WebView by `injectJavaScript`, exactly as `__TERMINAL_APPLY_THEME__` relays a theme change.-

**The panel unmounts on every tab switch**, so at the moment Run is tapped there is usually no socket. Writes are queued in `TerminalBridgeContext` (tagged with the directory they were asked for, drained destructively so a reconnect cannot re-run a command) and delivered when the shell connects. Run is offered on the shell family only — against a real shell, a JSON block would just print asyntax error. See the Batch 9 log for the framing rules and the mutation results.

### 5.2 Notifications for agent completion (1-2 weeks)

Today **only permission requests** are pushed (`services/notifications.ts`). Missing:agent-finished, agent-idle, agent-error, question/form requests, and step progress.

**Critical caveat:** there is **no `TaskManager` background task, no push token, and no `addNotificationReceivedListener` anywhere.** A permission raised while the app is _killed_produces no notification at all. And `PermissionContext.tsx:195-202` calls `replyToPermission`directly from the listener — when the JS runtime was cold-starting, `v2Client` is null and thereply is **silently dropped**, so the Allow button appears to work and does nothing. §4.9 raisesthe stakes here: the pending set is now a queue, so a killed app can have _N_ outstanding requestsand not one of them produces a notification.

**Phase 1 (3 days):** document permissions as foreground-only, and gate/disable thenotification actions when the client is not ready.

**Phase 2 (1-2 wks):** background task + server-side push so killed-app approvals work.

### 5.3 Diff view: mutations and scale (1-2 weeks)

`UnifiedDiff.tsx` is strictly read-only with one "Refresh diff" button (`:274-279`).-

**No apply / stage / revert / discard** — `session.revert.*` exists (see 4.5)-

**No side-by-side**, no syntax highlighting, no line numbers, no word-level diff-

**No virtualization** — one `ScrollView` renders every file × hunk × line. Large diffs will hang on mid-range Android-

**Untracked files invisible** — `indexFileStatuses`/`markUntracked` (`adapter.ts:449-484`) exist but are **never called**, despite `hooks.ts:476-483` documenting that consumers must backfill- No per-file +/- counts, no collapse, no filter, no auto-refresh (`useFileStatus` polls at `:499` but `UnifiedDiff` does not; `useFileStatus` / `useFilePatch` have **zero consumers**)

### 5.4 Custom theme builder (1 week)

8 hardcoded themes, no custom slot, no import/export. The bug underneath it is fixed — see 5.4a.

### 5.4a ✅ FIXED — Hardcoded light palettes in the pickers (High)

> **The original report was right about the defect and wrong about the mechanism.** It claimed the> pickers were "effectively unreadable in all 7 dark themes". They were not: `#FFFFFF` behind> `#04111A` is dark-on-light, which reads fine. The real failure runs the other way — the _themed_> children were stranded on the unthemed sheet. Measured, `textMuted` on the `#FFFFFF` modal is> **1.35:1 in Nord, 1.48:1 in High Contrast, 1.85:1 in Midnight Purple**; `accent` on white falls to> **1.07:1 in High Contrast**. 7 of 8 palettes fail the 4.5:1 bar for the chevron, the spinner and> the per-agent colour dots. Two distinct defects, both now fixed:**1 — the pickers ignored the theme entirely.** `AgentPicker` and `ModelPicker` each declared theirstyles in a module-level `StyleSheet.create`, which cannot see `useTheme()`. Both now build from `createStyles(colors)` memoised on `colors`, matching the pattern already used in `TerminalPanel`.45 hardcoded literals replaced. `ModelPicker`'s active filter chip was the worst case: `#04111A`with `#FFFFFF` text — correct on a white sheet, and once the sheet is themed, a hole in the surface.It is now `accent` + `onAccent`.**2 — the theme system had no `onAccent` token.** All **13** remaining `#04111A` call sites sit on`colors.accent` (verified individually: `AgentChat` send icon, `ConnectionScreen` /`CursorConnectionScreen` test buttons, `CursorSessionScreen` "New", `PluginManagerScreen` updateaction, `SettingsScreen` save). Hardcoding near-black as "the colour on accent" is right for 7palettes and wrong for one:| Theme | `#04111A` on accent | With `onAccent` |
> | ---------------------------------------------------------------------------------------- | ------------------- | --------------- |
> | oled-black / dev-dark / midnight-purple / solarized-dark / nord / high-contrast / hacker | 6.04–17.77 ✅ | unchanged |
> | **dev-light** | **3.68 ❌** | **5.19 ✅** |`syncTheme` auto-selects `dev-light` on a device in light mode, so on a light-mode phone every accent button — Send, Test Connection, Save, New, Update — lost its label. Added `onAccent` to all 8 palettes: `#FFFFFF` for `dev-light` only, `#04111A` for the other 7, so **nothing that already worked changed appearance**. **Verified by test, not by eye.** `src/theme/color-contrast.ts` implements WCAG 2.1 contrast, and `color-contrast.test.ts` (135 tests) asserts every palette pair the app renders. A new theme or a tweaked hex now fails `bun test`. Getting there required extracting the palette table out of`ThemeContext.tsx` into `src/theme/palettes.ts` — it is pure data with no behaviour, and it wasuntestable in place because importing the context transitively loads `react-native`, which `bun test` cannot parse. Deliberately **not** changed: `shadowColor: "#000"` (a drop shadow is black in every theme; tintingit to `background` would hide it), the `CollapsiblePartGroup` / `ThinkingPartGroup` accent hues(per-part-kind brand colours that must stay distinguishable), and `ModelPicker`'s`capabilityBadge` / `statusBadge` (self-contained light chips with dark labels — readable on anybackground).

### 5.4b ✅ FIXED — Status colours below the 4.5:1 bar (Medium)

**Decision: retune.** The earlier "leave them, they're canonical" reading was wrong on the evidence, and the deciding fact was a usage count that had not been taken: of 29 sites referencing`danger` / `success` / `warning`, **22 use them as a text colour** (error text, terminal errorlines, "Clear" labels, diff gutters) and only 7 as a graphic (borders, fills, dots). 4.5:1 istherefore the correct bar, and `danger` at 2.11:1 was not a brand-identity question — it was an unreadable error message. The replacements were **solved, not eyeballed**: hue held constant in OKLCH, minimum perceptual ΔEsubject to clearing 4.5:1 on every surface. Three attempts were discarded first — raising HSLlightness at constant saturation turned Solarized's red into pink (`#EC8F8D`); maximising chromaovershot into neon (`#DEFF00`); and the first OKLCH pass silently tested _grey_ rather than thecandidate, while a later one solved against unrounded floats and landed on 4.4997 — whichquantises below the bar. The working solver checks the rounded 8-bit value, with a small margin.| Theme | Token | Was | Now | Worst pair | Was | Now |
| -------------- | --------- | --------- | --------- | -------------------- | ---- | ---- |
| nord | `danger` | `#BF616A` | `#F7A7AC` | on `surfaceElevated` | 2.11 | 4.55 |
| solarized-dark | `danger` | `#DC322F` | `#FF8679` | on `surfaceElevated` | 2.31 | 4.56 |
| hacker | `danger` | `#FF0000` | `#FE3124` | on `surfaceElevated` | 4.21 | 4.56 |
| nord | `success` | `#A3BE8C` | `#A9C591` | on `surfaceElevated` | 4.23 | 4.55 |
| solarized-dark | `success` | `#859900` | `#9DB332` | on `surfaceElevated` | 3.34 | 4.55 |
| solarized-dark | `warning` | `#B58900` | `#CEA33B` | on `surfaceElevated` | 3.34 | 4.55 |Three of the six are near-imperceptible (Nord's green and Hacker's red move by ΔE < 0.03); the two Solarized/Nord reds move furthest, and unavoidably so — at their original lightness there is nocolour at that hue that clears the bar, so "canonical red" and "legible error text" could not bothhold. `KNOWN_STATUS_FLOORS` is **deleted**: there is no longer a shortfall to record, and arecording floor is exactly the sort of thing that quietly stops being read. All eight palettes nowassert `danger`/`success`/`warning` at 4.5:1 against all four surfaces (96 generated tests), andreverting Solarized's three values fails exactly the 8 pairs that were previously excused.

### 5.4c 🟡 OPEN — `basename` fallback on a trailing separator (Low, latent)

`adapter.ts` `basename()` returns `segments.at(-1) |
| path`, so a directory path with a trailingseparator (`src/api/`) yields the whole path as its display name instead of `api`. Pinned by testrather than fixed: it is **not established** that `file.list` emits trailing separators, andchanging the fallback would also alter the empty-path case.

### 5.5 Global search across all sessions (1 week)

Search is current-session only. `message.list` per session makes a cross-session indextractable.

### 5.6 Split-view terminal + chat on tablets (1-2 weeks)

Landscape today shows `LandscapeFileRail` + chat only (`WorkspaceScreen.tsx:362-363`). Add aconfigurable chat/terminal split with a draggable divider, persisted per orientation.

### 5.7 `@`-mention autocomplete (1 week)

No mention support at all. Attachments are added only by long-pressing a file(`FileDrawer.tsx:159-163`). A composer `@` trigger resolving files, agents, and commands is a large usability win and reuses `FileDrawer`'s data source.---

## 6. 🟢 Whole SDK Subsystems With Zero UI

Low effort each relative to value — the transport, auth, and query layers already exist.| # | Subsystem | SDK surface | Effort | Value |
| --- | ------------------------- | ------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | **MCP servers** | `mcp.list/add/remove/connect/disconnect/resource.catalog` | 1 wk | See servers and toggle them from the phone |
| 6.2 | **Skills** | `skill.list` | 3 days | `config.skills` is folded at `config.ts:237-239` and never surfaced |
| 6.3 | **Provider auth / OAuth** | `integration.*` (`oauth.connect/status/complete/cancel`, `wellknown.add`) | 1-2 wks | Add/refresh provider credentials without SSH-ing to the server |
| 6.4 | **Worktrees** | `worktree.list/create/remove/refresh` | 1 wk | Project switching is `location`-based only |
| 6.5 | **Credentials** | `credential.list/create/update/activate/remove` | 1 wk | API key lifecycle from the device |
| 6.6 | **Server pairing** | `server.pair` / `server.connect` | 1-2 days | `createPairingCode`/`redeemPairingCode` (`client.ts:137,149`) are **implemented with zero call sites** — a complete unreachable flow |
| 6.7 | **Shell management** | `shell.list/create/get/output/remove` | 3 days | Server-side shells instead of only PTY |
| 6.8 | **PTY lifecycle UI** | `pty.list/remove` + `experimental.persistentPty.*` | 1-2 wks | **Partly done in §2.3**: a tap-to-confirm "Kill shell" action and exited-record pruning. Still missing: browsing/listing PTYs across directories. `persistentPty` includes `snapshot`/`handoff`/`shutdown` — the real answer to PTY persistence |---

## 7. Chat Rendering Gaps

| Gap                                                                                                                   | Evidence                                  | Effort   |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------- |
| No syntax highlighting in code blocks — plain monospace `<Text>`                                                      | `MarkdownRenderer.tsx`                    | 2-3 days |
| Code blocks capped at `maxHeight: 300` with no expand                                                                 | `MarkdownRenderer.tsx:109`                | 1 hour   |
| File/image tool output renders as the literal string `[file]` — no image preview                                      | `domain.ts:110-117`                       | 3 days   |
| Agent/model/location switch messages are **dropped entirely**, so the transcript never records a mode change          | `adapter.ts:195-202`                      | 2 days   |
| `PartType` declares 10 variants but `ChatMessageBubble` always passes `"tool"` — 7 are unreachable                    | `CollapsiblePartGroup.tsx:6-16` vs `:164` | 1 day    |
| No per-message model / cost / tokens / duration / finish / error header, though all fields exist on `ChatMessageInfo` | `domain.ts:38-54`                         | 2-3 days |
| No retry / error / compaction visual treatment                                                                        | `kind`, `finish`, `error` unused          | 2 days   |
| No message actions — edit-and-resend, delete, branch, feedback                                                        | —                                         | 1 wk     |
| `edit`/`patch` tool output shows as raw text, never as a diff                                                         | —                                         | 3 days   |
| Streaming re-renders the whole list per SSE delta — no batching                                                       | `hooks.ts:641-665`                        | 1 wk     |
| `scrollToIndex` for search-jump has no `onScrollToIndexFailed` fallback on long sessions                              | `AgentChat.tsx:350-354`                   | 2 hours  |
| No "jump to latest" pill with unread count                                                                            | auto-scroll just stops                    | 2 days   |
| Binary WebSocket frames silently dropped in the terminal shell                                                        | `build-terminal-shell.mjs:82-89`          | 1 hour   | --- |

## 8. Terminal Gaps

Beyond §2.2 and §5.1 (all four are now fixed):-

**PTYs are not browsable across directories** — only the current one can be killed. See §6.8.-

**No automatic WebSocket reconnect** — `ws.onclose` posts `disconnected` and waits for a manual tap (`TerminalPanel.tsx:425-450`)-

**No `addon-search`, `addon-web-links`, or `addon-clipboard`** bundled (`scripts/build-terminal-shell.mjs` inlines only `xterm.js` + `addon-fit`)-

**No font-size control** — hardcoded `fontSize: 14`-

**No multiple PTY tabs / split panes / naming UI

**- `scrollback: 5000` lives only in the WebView DOM; any reload loses it, and `cursor: 0` is hardcoded (`TerminalPanel.tsx:130`) so replay always starts at byte 0- `resize` failures are swallowed (`TerminalPanel.tsx:191`)- No `KeyboardAvoidingView` — the keyboard does not shift the terminal---

## 9. Cross-Cutting UX

### 9.1 Accessibility (Medium)

Only **21** `accessibility*` attributes exist in `src/components`. Gaps:- No `accessibilityHint` anywhere- No reduce-motion support — the pulse in `CollapsiblePartGroup.tsx:61-77` runs unconditionally- Font scale caps at 1.3× across only 4 steps (`types/opencode.ts` `FontScale`)- No screen-reader verification pass (TalkBack / VoiceOver)

### 9.2 Onboarding / first run (1-2 weeks)

No first-run flow at all. A new user lands on a bare server-URL form with no explanation of OpenCode, Tailscale, or why a Basic-auth password is being stored.

### 9.3 Notification settings UI (2-3 days)

`SettingsScreen.tsx:706-714` has a one-shot "Enable permission notifications" row that justcalls `requestPermissionsAsync`. There is no per-category control, no Android 13`POST_NOTIFICATIONS` denial state, and no badge count (`shouldSetBadge: false`, `notifications.ts:18`).

### 9.4 External keyboard support (1 week)

No hardware-keyboard handling anywhere. `Cmd+K` palette, `Cmd+N` new session, `Esc` to closesheets, `↑` for prompt history — all absent on tablets/Bluetooth keyboards.

### 9.5 Settings gaps (2-3 days)

- Version string is **hardcoded `"1.0.1"`** at `SettingsScreen.tsx:931` while `app.json`/`package.json` are `1.1.0`- Default Agent / Default Model rows are **display-only** — no picker, only "Clear"- Session templates can be added and deleted but **not edited** (`updateTemplate` unused)- `expo-web-browser` is dynamically imported at `:935`, which is fragile under Metro/Hermes---

## 10. Dead Code — Delete or Wire Up

Roughly 900 lines and 20 API helpers that nothing calls. This inflates the mental model ofthe codebase and misleads future greps.

**Components (zero imports anywhere):

**- `WorkspaceToolbar.tsx` (214 L) — fully built agent/model/session chips + palette button, **never rendered**. `WorkspaceScreen` hand-rolls a header instead- `PanelTabs.tsx` (80 L) — superseded by `BottomNavigation`- `ActionPill.tsx` (89 L) — superseded by `BottomNavigation`

**API helpers:** `createPairingCode`, `redeemPairingCode` (`client.ts:137,149`) · `listSessionForms`, `getForm` (`forms.ts:277,288`) ·`listSessionPermissions` (`permissions.ts:198` — the §4.9 queue is location-wide, so theper-session list still has no consumer; §4.10 removed the other two from this list) · `markUntracked`, `indexFileStatuses`, `toFileEntries` (`adapter.ts:391,472,449`) ·`pluginStatusLabel` (`plugins.ts:193`) · `applyPinnedOrder` (`session-meta.ts`) ·7 unused `CursorApiClient` methods · `useCursorSendPrompt` / `useCursorGetMessages` / `useCursorDeleteSession`

**Dead props:** `AgentChat` `chromeInset` (`:44`) · `MessageSearchBar` `resultCount` (`:20`)

**Dead render bug:** `Snackbar.tsx:105` reads a Reanimated shared value (`opacity.value`) duringrender to decide unmounting. It will not re-render on change, so the exit animation is clipped.

**Other duplicates:** `FileDrawer.tsx` and `LandscapeFileRail.tsx` are near-identical(same `parentPath` helper copy-pasted at `:29-33` / `:19-23`). Extract a shared tree component.---

## 11. Engineering Infrastructure

### 11.1 ✅ Test coverage — logic and render (High)

_Partially fixed 2026-10-03._ The project had **zero** test files, no `test` script, and norunner. That is now stood up and the highest-value target is covered.

**Done:

**- `bunfig.toml` + `bun test` + `bun run test` / `test:watch`, `@types/bun` as a devDependency- `src/api/__tests__/message-stream.test.ts` — **75 tests** over `applyStreamEvent`, `isAgentBusyEvent`, `shouldRefetchMessages`: session scoping, lazy message creation, text and reasoning streaming, the reconnect paths that arrive without a `started` event, all tool lifecycle transitions, step events, and every no-op event type- `src/api/opencode/__tests__/adapter.test.ts` — 6 tests pinning `positionalPartId`'s format, since drifting that derivation silently duplicates parts on reconnect- `src/utils/__tests__/session-ranking.test.ts` — 21 tests over ranking, grouping, and the relative-time labels- `src/api/opencode/__tests__/config.test.ts` — 56 tests over the V2 config fold: last-present- wins scalars, `null` clearing `shell`, per-key record merging, ordered permission replacement keyed by `action`+`resource`, additive plugin unioning, and the read helpers. Also pins `configPluginNames` reading the V1 record form as **keys** — it used to return values, which are arbitrary objects, and React then crashed rendering an object as a child.- `src/api/providers/cursor/__tests__/message-stream.test.ts` — 37 tests over all 7 Cursor SSE types plus `isCursorAgentBusyEvent` / `shouldRefetchCursorMessages`. Documents a wart on purpose: `thinking` and `tool_call` resolve `messages.find(role === "assistant")`, i.e. the **first** match, so on a multi-turn run a thinking block attaches to the oldest assistant message. Pinned so changing it stays a deliberate decision.- `src/api/providers/opencode/__tests__/provider.test.ts` + the Cursor equivalent — 21 tests over the new Stop path. Two guards that matter: `resume` is never sent, and the listener is released whether the stream ends or throws.- `tsconfig.test.json` for test typechecking. Kept separate because Bun's `fetch` typings conflict with React Native's and break the app build if merged- `bun run test` added to `ci.yml`

**Coverage progression:** 102 after Day 1 → **222 across 7 files** at the end of Day 2 → **289 across 9** after Day 3 (`nextLockState` §2.6, `file.read` decoding §3.2) → **316 across 10** after Day 4 (`planPtyLifecycle` / `shouldKeepSession`, §2.3) → **640 across 12** after Day 5.

**Day 5 additions:

**- `src/api/opencode/__tests__/adapter.test.ts` — **105 tests**. This module invents the app's entire domain model from server payloads and nothing downstream re-checks it, so a mistranslated field does not throw, it renders as a wrong transcript or a wrong invoice. Covers `toSession` (the V2 `location.directory` wrapper), `toChatMessage` across all 8 message variants and all 4 tool states, `parseUnifiedDiff`, `indexFileStatuses` / `markUntracked`, the file-entry sort, and `toModel` / `toProvider`. Notable: the shell message treats a non-numeric exit sentinel (`"Infinity"`) as _not_ a number for `info.exit`, and a compaction that failed renders an empty summary rather than a stale one.- `src/api/__tests__/forms.test.ts` — **90 tests** over the V2 form subsystem: `when`-clause evaluation (eq/neq, AND across clauses, arrays never satisfying a scalar compare), conditional visibility, `initialAnswer` keeping falsy defaults, `missingRequiredKeys` treating `0`/`false` as answered and ignoring hidden fields, and the multiselect bounds.- `src/theme/__tests__/color-contrast.test.ts` — **135 tests** asserting WCAG contrast across every palette pair the app renders (§5.4a). Mutation-verified: reverting `dev-light`'s `onAccent`, or solarized's `textMuted`, or relaxing the 4.5:1 threshold each fails it.

**Bugs found while writing these three suites:

**- §5.4a — `forms.ts` `multiselectConstraintViolations` pushed a field's key **once per breached bound**, so a field with `minItems: 3` and `maxItems: 1` appeared twice in the error list. Fixed to push once per field.- §5.4a — the `coerceNumber` doc comment claimed the `"NaN"` sentinel needed "no special casing". It does: `Number("NaN")` is NaN, so the NaN branch returns the literal _string_. Behaviour left alone (a NaN number is not representable in a text input), comment corrected.- §5.4c — `basename()`'s trailing-separator fallback. Pinned, not fixed; see 5.4c.

**One deliberate non-fix, recorded because it looks like a coverage gap.** The `Array.isArray` / `undefined` guards in `conditionHolds` are unreachable: `FormWhen.value` is a scalar, so an arrayanswer already fails `===`, and `undefined === "prod"` is already false. Deleting the whole ternarypasses all 90 tests — it changes no behaviour. The guards are kept and now documented, because `FormValue` _does_ allow `Array<string>`, so only the `value` side keeps them safe; if a future SDKwidens `FormWhen.value` to accept arrays they become load-bearing. The corresponding test pins theobservable rule and says plainly that it does not guard that line.

**Still uncovered:**1. `context/ConnectionContext.tsx` — its provider reaches for AsyncStorage, secure storage and a live socket, and its context object is not exported. The harness substitutes `useConnection()` (see below), so the provider itself remains untested; what is covered is every consumer's reaction to the values it supplies.2. `src/components/*` — the pickers and the attachment chips are covered at the logic layer (`nextLockState`, `file-content.ts`, `pty-lifecycle.ts`, the palette assertions) but not rendered3. `api/use-pty-session.ts` and `api/hooks.ts` — the hooks themselves; only their extracted pure cores are covered

### 11.1b ✅ Component-test harness (Batch 10)

_The blocker for §11.1 was that nothing could render. `bun:test` runs the tests, but `react-native@0.86` ships

**Flow-typed source**, and reaching it outside Metro needs the whole of React Native's Jest preset: Flow stripping, Haste resolution, `.ios.js`/`.android.js` platformselection, `NativeModules` and `TurboModuleRegistry` stubs, and the `__DEV__` bridge globals. Thatsetup assumes Jest, which this project does not use. `@testing-library/react-native` also peers on `jest >= 29`. Bun's plugin API plus `@babel/plugin-transform-flow-strip-types` got partway in — it transformed `react-native/index.js` and then failed on Flow's `as` cast, after which Haste and the nativemodules were still waiting. Recorded because it was tried, not because it was hopeless.

**What ships instead** — a shim for the host layer and a real reconciler for everything above it:- `test-renderer@1.3.0`, a `react-reconciler`-based renderer that supports React 19 with **no Jest dependency**. (React Native's own new testing path uses it.) `react-test-renderer` is deprecated and would not do.- `src/testing/react-native-stub.ts` — the host components as plain host elements, `StyleSheet` returning its input so tests can read styles directly, `Alert` recording its calls, `FlatList` rendering every item.- `src/testing/setup.ts` — a `bunfig.toml` preload. `mock.module` has to run **before** the graph is linked: registering a module afterwards makes Bun re-resolve `react-native` against the real package, and the component then fails with `Export named 'TurboModuleRegistry' not found`. That cost an hour; the preload is the fix.- `src/testing/context-holds.ts` — mutable slots the preloaded context mocks read from. The real providers reach for storage and a socket, and neither context object is exported, so substituting `useTheme` / `useConnection` is the only seam that does not drag the app's startup into a unit test.- `src/testing/source-imports.ts` + `rn-stub-coverage.test.ts` — the drift guard, below.

**What these tests are worth, stated plainly:** they pin _our_ behaviour — how a screen maps datato states, how it wires contexts, what its buttons call. They do **not** pin React Native'srendering. A green `StatsScreen` test means the right text appears for a given query result, notthat React Native would lay the rows out identically. Anything layout- or gesture-specific stillneeds a device.

**The shim cannot drift silently.** The failure this prevents is specific: a component startsimporting `Switch`, the shim does not have it, the component renders nothing, and the test passeswhile asserting nothing. Three guards, because each covers a different way that happens:1. The module namespace is a `Proxy` that **throws** on any unimplemented member, naming it.2. `rn-stub-coverage.test.ts` re-scans `src/` on every run. Every `react-native` import must be either implemented or listed in `NOT_STUBBED` with the reason a fake would mislead (`Animated`, `PanResponder`, `Modal` …). A **new** import fails the suite.3. It also asserts the scan is non-vacuous, and that no gap entry is stale.
The lucide icon mock cannot be a `Proxy`: Bun resolves _named_ ESM imports statically, so a proxyanswering any property still fails with `Export named 'Undo2' not found`. The icon keys are readfrom the app's own imports instead, so a newly-used icon is covered without editing the file.

**Render tests added:** `RevertBanner` (11), `TerminalBridgeContext` (14), `TerminalPanel.bridge` (13), `StatsScreen` (12), `SavedPermissionsScreen` (12).
The last two close the two §5.1 gaps that were previously pinned by reasoning alone — the bridge'sdeliver-**or**-queue branch, and the panel's effect ordering. Both matter because each broke twiceduring the original wiring, invisibly to the type checker, to lint, and to every pure test:1. the sink effect's cleanup clearing the queue, so flipping `loading → connected` wiped it _before_ the drain could take it;2. the drain running inside the WebView message handler, against the sink still bound to `"loading"`, which refuses writes.**31 mutations across the three new harnesses, all caught.** Getting there found real gaps ratherthan confirming what was already true:- A whitespace-only `runInTerminal` to a **live** sink was sent. The blank-command test only covered the queue path, where `enqueueWrite` drops it itself.- `SavedPermissionsScreen` gated its spinner on `list.isPending` alone. A query with `enabled: false` stays pending forever, so with no client the screen spun indefinitely and could never reach the empty list. Found by rendering it; fixed to also check `fetchStatus !== "idle"`.- Three surviving mutations that were **not** bugs. One drained twice — redundant, same result. One dropped `projectId !== null` from `enabled` — the query's own guard throws first, so nothing observable changes. These were left out of the harness rather than papered over with a contrived assertion: a mutation that demands a failure on working code measures nothing.

**Two findings the harness raised but did not fix:

**- `listSavedPermissions(client, activeDirectory)` passes a filesystem path in a field the API names `projectID`. Whether the server accepts that is unverified — there is no server here to ask. A test pins that the screen sends the directory it holds, so the question stays visible.- `tsconfig.test.json` included only `**/__tests__/**/*.ts`, so all five `.tsx` component tests were running under `bun test` while **never being typechecked**. Fixed, along with excluding `src/testing` from the app build so Bun and Node types stay out of it.

**Note on test types:** Bun's ambient `fetch` carries members React Native's lacks (e.g.`preconnect`), so tagging a function literal as `typeof fetch` typechecks under one environmentand fails under the other. `transport.ts` now types its implementation against a local `FetchImpl`alias and widens once at the return, which keeps it valid in both and let the provider testsimport the real provider instead of a stub.

**Found while testing:** §13.1 — a duplicate-part-id path in `appendToStreamedPart`, now fixed.

### 11.2 🔶 CI hardening (1 day)

- ✅ Removed `|
| true` from `check:install` (`ci.yml:39`)- ✅ APK upload now `if-no-files-found: error` (`ci.yml:84`)- ✅ `bun run test` runs in the `typecheck-lint` job- ⬜ **Gate `release.yml` on CI** — a tag push still builds and publishes regardless of CI status- ⬜ Produce an **AAB** for Play, not just an APK- ⬜ No iOS job at all — iOS is completely untested, which is how §2.8 shipped

### 11.3 Release script (2 hours)

Fix or delete `scripts/release.ps1` (§2.9). A release tool that silently commits the workingtree and pushes is a data-loss risk.

### 11.4 WebView hardening (2-3 days)

`TerminalPanel.tsx:456-461` uses `originWhitelist={["*"]}` + `mixedContentMode="always"` +`javaScriptEnabled`, combined with `NSAllowsArbitraryLoads` and `usesCleartextTraffic` set**twice** (`app.json:56-63` _and_ `plugins/with-cleartext-network.js`). This is the expectedposture for "connect to your own server," but it means any server a user points at gets fullJS execution in the app process. Consider narrowing the origin whitelist to the active host and removing the redundant cleartext config.---

## 12. Documentation Refresh

Four documents contain materially false statements. This actively harms future work.

### `docs/ARCHITECTURE.md` — the most misleading

| Line     | Says                                              | Actually                                                          |
| -------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| 30, 248  | `@opencode-ai/sdk/client` **v1**                  | `@opencode/client` **2.0.22** (V2)                                |
| 83       | `testConnection` calls `config.get()`             | `server.info()` + `session.list({limit:1})` (`client.ts:178-180`) |
| 114-119  | Events `message.updated` / `message.part.updated` | V2 deltas: `session.text.delta`, `session.tool.*`, …              |
| 121-123  | `src/api/directory.ts`                            | **Does not exist** → `src/api/opencode/location.ts`               |
| 41-46    | Nav tree omits 3 routes                           | `ProviderPicker`, `CursorConnection`, `CursorSessions` all exist  |
| 54-61    | Provider table omits 2                            | `QuestionProvider`, `SessionMetaProvider`                         |
| 200-210  | 7 themes                                          | 8 — omits `hacker`                                                |
| 174, 166 | PTY auth is "Basic Auth token"                    | Per-reconnect **connect ticket**                                  |
| —        | Not mentioned                                     | The **entire** `src/api/providers/` dual-backend architecture     |

### `IMPLEMENTATION_PLAN.md`

Phase 1.1 (lint), 1.2 (`getItemLayout`), 1.3 (haptics), 1.4 (notification actions), and 1.5(clipboard) are **all shipped**. Its "run with `bun test`" strategy and "add `expo-haptics`"dependency list are also obsolete.

### `README.md`

`:148` lists `android/` as a committed directory.

**It does not exist** — pure CNG.`bun run android:clean` will fail on a fresh clone.

### `CHANGELOG.md`

Versions `1.0.0`–`1.1.0` carry placeholder dates (`2026-0X-XX`).---

## 13. 🆕 Found While Testing the Reducer

### 13.1 ✅ FIXED — Duplicate part id when a tool claims a streamed ordinal (Medium)

_Found 2026-10-03_ by the new `message-stream.test.ts` suite, then fixed.`appendToStreamedPart` (`message-stream.ts:102-127`) had a branch for when a part of a differentkind already occupied the ordinal:`tsconst existing = parts[index];if (!existing |
| (existing.type !== "text" && existing.type !== "reasoning")) {  // A part of a different kind already occupies this ordinal; the server's  // ordinal wins over whatever the previous occupant was.  return [...parts, part];}`The comment described a **replacement**. The code did an **append**. Consequences:- Two parts shared the id `<messageID>:<ordinal>`, so a React list key collided- A later lookup by that id resolved the stale first occupant- The delta was dropped — `part` was appended without applying it, so `text` stayed `""`- Every subsequent delta repeated the branch, because `findIndex` kept finding the stale tool at index 0, so fragments never coalesced**Severity was bounded:** text already streamed survived and the authoritative `*.ended` payloadstill arrived with the full text, so no user-visible content was lost in the realistic ordering. The defect was duplicate ids and fragmented parts, not silence.**Fixed** by replacing at `index` in both directions — `appendToStreamedPart` now overwrites thestale occupant (applying the delta so it is not lost), and `upsertToolPart` got the mirroredguard, which had the identical append bug. `finalizeStreamedPart` was already correct and served as the reference. The three tests that pinned the broken behaviour were replaced with eight that assert the fix. Verified by mutation: reverting both call sites to append fails all eight.---

## 14. Cursor Backend Gaps

The Cursor provider is a separate hand-rolled REST client (`api/providers/cursor/`), not the OpenCode SDK. It is functional but notably weaker:-

**Messages are in-memory only** (`_messages`), rebuilt from the stream and **lost on refresh**. No `getMessages` round-trip-

**No reconnect/backoff** — `useReconnect` only receives a config, which is `null` for Cursor (`ConnectionContext.tsx:697`), so Cursor has no reconnection at all- `getMessages` **ignores its `sessionId` argument** (`provider.ts:140`)- Event listener registered per send (§2.10)-

**Model is a free-text field** (`CursorConnectionScreen.tsx:233-242`) although `client.ts:124` has a `listModels()` endpoint- No delete/archive in the UI (`client.ts:67,71` implement both), no run history or status polling, no `updatedAt` formatting (`:231` prints a raw string)- No offline-queue integration, no terminal, no file browser---

## Priority Matrix

| #        | Item                                                     | Category     | Effort  | Impact |
| -------- | -------------------------------------------------------- | ------------ | ------- | ------ |
| ~~2.1~~  | ~~Clipboard silently broken (5 sites)~~                  | ✅ **Fixed** | —       | —      |
| ~~2.8~~  | ~~Missing `NSFaceIDUsageDescription`~~                   | ✅ **Fixed** | —       | —      |
| ~~3.1~~  | ~~No way to stop a running agent~~                       | ✅ **Fixed** | —       | —      |
| ~~2.9~~  | ~~`release.ps1` force-pushed working tree~~              | ✅ **Fixed** | —       | —      |
| ~~2.2~~  | ~~Terminal theme injection dead code~~                   | ✅ **Fixed** | —       | —      |
| ~~2.6~~  | ~~Biometric lock never re-locked~~                       | ✅ **Fixed** | —       | —      |
| ~~2.3~~  | ~~Server-side PTY leak~~                                 | ✅ **Fixed** | —       | —      |
| ~~3.2~~  | ~~File viewer (`file.read`)~~                            | ✅ **Fixed** | —       | —      |
| 11.1     | ~~Test coverage~~ 1046 tests; harness shipped (Batch 10) | Infra        | done    | High   |
| 5.2      | Notifications when app is killed                         | Feature      | 1-2 wks | High   |
| ~~4.11~~ | ~~Removable attachment chips~~                           | ✅ **Fixed** | —       | —      |
| ~~4.9~~  | ~~Permission request queue~~                             | ✅ **Fixed** | —       | —      |
| 5.4a     | Fix hardcoded light palettes in pickers                  | 🐛 Bug       | 3 h     | High   |
| ~~2.7~~  | ~~CI silently swallows 2 failures~~                      | ✅ **Fixed** | —       | —      |
| ~~2.4~~  | ~~Shell preference inert~~                               | ✅ **Fixed** | —       | —      |
| ~~5.4a~~ | ~~Hardcoded light palettes in pickers~~                  | ✅ **Fixed** | —       | —      |
| 5.3      | Diff: apply/revert + virtualization                      | Feature      | 1-2 wks | Medium |
| 4.3      | Fork conversation (`session.fork`)                       | Feature      | 1-2 wks | Medium |
| ~~4.4~~  | ~~Token & cost dashboard~~                               | ✅ **Fixed** | —       | —      |
| ~~4.5~~  | ~~Undo/revert a turn~~                                   | ✅ **Fixed** | —       | —      |
| 10       | Delete dead code (~900 L)                                | Cleanup      | 3 h     | Medium |
| 12       | Refresh 4 stale docs                                     | Docs         | 1 d     | Medium |
| ~~5.1~~  | ~~Working "Run in terminal"~~                            | ✅ **Fixed** | —       | —      |
| 5.7      | `@`-mention autocomplete                                 | Feature      | 1 wk    | Medium |
| 9.1      | Accessibility pass                                       | Feature      | 1 wk    | Medium |
| 6.6      | Server pairing UI                                        | Feature      | 1-2 d   | Medium |
| 2.5      | `activityScore` permanently zero                         | 🐛 Bug       | 1 h     | Low    |
| ~~13.1~~ | ~~Duplicate part id on ordinal collision~~               | ✅ **Fixed** | —       | —      |
| ~~2.10~~ | ~~Cursor listener leak per send~~                        | ✅ **Fixed** | —       | —      |
| 11.4     | WebView hardening                                        | Infra        | 2-3 d   | Low    | --- |

## Suggested Execution Order

**✅ Day 1 — correctness (complete).** §2.1 clipboard, §2.8 Face ID, §2.2 terminal theme,
§4.11 removable attachments, §2.7 CI hardening. Test infrastructure and 102 tests added.**✅ Day 2 — stop button, reducer fix, coverage (complete).** §3.1 stop/interrupt (bothproviders), §13.1 ordinal-collision fix in both directions, §2.10 Cursor listener leak. Coverageextended to 222 tests across 7 files: `resolveConfig`, the Cursor reducer, and both providers.**✅ Day 3 — data loss, re-lock, file viewer (complete).** §2.9 release script rewritten andverified against a real git remote, §2.6 biometric re-lock, §3.2 file viewer. Coverage now 289tests across 9 files, adding `nextLockState` and the `file.read` decoding rules.**✅ Day 4 — PTY lifecycle (complete).** §2.3 ownership-aware PTY cleanup, §2.4 shell preference nowtakes effect (fixed as a consequence — both were blocked by the same early return). Coverage now 316tests across 10 files, adding `planPtyLifecycle` and `shouldKeepSession`.**✅ Day 5 — theme contrast + adapter/forms coverage (complete).** §5.4a: the two pickers themed(45 literals), `onAccent` added to all 8 palettes, 13 accent-foreground call sites fixed. Palettesextracted to `src/theme/palettes.ts` so they are testable, and WCAG contrast is now asserted perpalette — 135 tests that fail on a tweaked hex. Coverage 316 → **640 across 12 files**, adding `adapter.ts` (105) and `forms.ts` (90). Three incidental bugs fixed or documented along the way;§5.4c (`basename` fallback) recorded as a new open item; §5.4b (status colours) was recorded then and settled the next day.**§4.9 — permission request queue (Batch 6).** The single `pending` slot is now a FIFO queue. Ordering is load-bearing (the agent blocks on the head), so every transition keys on request idrather than position — which is also what fixed a second bug: `respond` cleared "the slot" onsuccess, so a request that arrived while the reply was in flight was discarded and the agent waitedon a prompt nobody could see. Rehydration adopts every request instead of `requests[0]`; a replayed `permission.asked` is deduped by id, as is its push notification. `dismiss` still means "not now" —the request stays pending server-side and returns on the next rehydration. `pending` is derived fromthe head, so `PermissionBanner` is unchanged apart from a `1 of N` count (without it, answering oneprompt and seeing a different one appear reads as a glitch). Algebra extracted to `src/api/permission-queue.ts`; 42 tests, all seven functions mutation-verified. ESLint's `react-hooks/refs` rule rejected a render-phase ref write for the notification bookkeeping, so theref now holds announced _ids_ and is written only from the event handler — which also avoids astale-read window that a render-sync ref would have. Coverage 640 → **682 across 13 files**.**§5.4b + §4.10 (Batch 7).** §5.4b decided by measurement rather than deference: 22 of the 29`danger`/`success`/`warning` call sites are text, so 4.5:1 is the right bar and the "they'reSolarized's canonical reds" argument does not hold. Six values retuned as minimum-ΔE solutions inOKLCH; three move imperceptibly, the two reds move furthest because no colour at that hue andlightness clears the bar. `KNOWN_STATUS_FLOORS` deleted rather than renegotiated — 96 generatedassertions now cover status × surface × theme, and reverting Solarized's three fails exactly the 8previously-excused pairs.§4.10 wired up the two dead exports. `SavedPermissionsScreen` lists grants newest-first and revokesthem; a wildcard grant is labelled in words ("Any bash command") rather than as `bash: *`, becausethe difference between one command and all of them is the whole decision. Wildcards confirm first, since revoking one re-prompts for everything it silently covered. Fetching goes through TanStackQuery per the `plugins.ts` pattern — which also meant `removeGrant` became dead on arrival and wasdeleted rather than left as a tested-but-unused helper, the exact §10 problem §4.10 exists to fix. Two mutations survived here, both revealing genuine dead code: the explicit `updatedAt === null`sort branch (redundant, since normalisation already guarantees positive values) and a `Math.max(0, …)` clock-skew clamp (unreachable, since a negative `seconds` is always under theone-minute cutoff). Both deleted. 25 tests, all mutation-verified. Coverage 682 → **790 across 14files**.**

### Batch 11 — §4.3 fork, and render coverage for §4.9 / §4.11

**Delivered.** `session.fork` end to end (pure cut arithmetic, transport, mutation hook,
message action sheet); `AttachmentChips` extracted and render-tested; `PermissionBanner`
render-tested. 1046 tests / 29 files, 36 of them new. Mutation verification: **25/25** on
the app code (`mutate-batch11.mjs`), **11/11** on the harness itself
(`mutate-harness-batch11.mjs`), zero survivors.

**Two harness findings worth more than the features.**

1. **`NOT_STUBBED` was not the same as "harmless".** A name the stub omits makes the whole
   module graph fail to _link_ — `CollapsiblePartGroup` imports `Animated`, so every bubble
   was unrenderable, and the gap was recorded as a mere "animation driver; a fake would
   not advance on time". "Absent" and "provided but inert" are different states with
   different consequences, so the list split: `INERT` names a fake that renders and does
   nothing, exported so the graph links and asserted _not_ in `IMPLEMENTED`, with the stub's
   own list cross-checked against the coverage test's so they cannot drift. The documented
   consequence: no test may assert on motion through `Animated`, only on state.

2.

**An act() warning is not a log line.** The bridge tests drove `setState` from the test
body, outside `act`. Every assertion passed — the deferred update is the same update —
which is exactly why it was invisible, and effect ordering is the entire subject of
those tests. The accessors now wrap their mutating calls, and the preload turns any act
warning into a **failed test**, with a self-check that provokes one to prove the
tripwire is armed (a tripwire cannot be verified by disarming it). The console output is
now clean for the first time.

**Smaller things the tests found.**

- `groupSessionsByTime`'s fixtures were wall-clock offsets ("30 hours ago" for _yesterday_),
  so the test failed every day between 00:00 and 06:00 local — a quarter of all days. It had
  been green when written and was red when this batch started. Anchored to local midnight
  instead, which is what the implementation cuts on.
- The permission banner's "Always remembers this for X" sentence has **two** unasserted
  branches: with no action, and with no resources. Both fall back, and the tests now say so.
- `pressText` matches substrings, so `pressText("Always")` found the _prose_ ("“Always”
  remembers this choice…") before the button and then failed, having no `onPress`. Added
  `pressExact`, with a self-check reproducing the collision.
- The bubble's `hasActions` flag and its "no buttons, no sheet" guard were the same rule
  written twice, so the guard was unreachable and untested. Replaced by one `actions` list
  that decides both.
- Nothing verified the context slots reset between mounts, and the clipboard log was
  leaking silently. Both now covered.

**Honest limits.**

- The fork's `before` semantics were a _reading_, not a verified fact. **Verified in Batch
  12** — `before` is exclusive, so the reading was right. What else that turned up is
  below.
- `AgentChat`'s glue (`onFork={fork ? handleFork : undefined}`) is not render-tested; the
  component is too heavy to mount. It is defended in depth instead — `forkSummary` is
  `undefined` in that case, and the tested `onFork && forkSummary` guard suppresses the
  button, so passing `onFork` unconditionally still cannot produce a branch.
- `AttachmentChips` keyed on `path` instead of `id` is _not_ a defect: `addContextAttachment`
  dedupes by path, so the two are equivalent and the duplicate-key case is unreachable. A
  test for it would have been theatre.

---

Next — reliability.** §11.2 gate `release.yml` on CI. §2.3's remaining piece (§6.8 — browsing PTYs across directories, and `experimental.persistentPty.*`) is optional polish rather than a leak fix.**§4.5 — undo / revert (Batch 8).** The doc's claim that "events are already handled at `message-stream.ts:563-565`" checked out in substance — `shouldRefetchMessages` already returns true forall three revert events — but the path was wrong (it is `src/api/message-stream.ts`, and the cases areat `:571-573` and `:643-645`), so the line references are corrected here.
The design question was what `stage`'s `messageID` means: "keep up to here" or "undo from here". Theparameter reads identically under both and there is no server here to probe, so **the client neverinterprets it**. It stages, shows the consequences the _server_ reported, and commits only what cameback — which is what the two-phase API is for, and means an incorrect assumption shows up in the stagedsummary before anything is destroyed. `session-revert.ts` is a pure reducer over `idle → staging → staged → committing`, with **no transition reaching `committed` without passingthrough `staged`** (asserted directly, not just implied by the individual cases). `commit-failed`returns to `staged` rather than `idle`: the server still holds the staging, and dropping the client'scopy would leave the user unable to either retry or abandon a pending change. Switching sessionsresets the machine, since a staging belongs to one conversation. Revoke-style honesty throughout: awildcard-style "reverts 3 files, total +10 −4, this cannot be undone", and an explicit"only the conversation, no files change" for the other case. 40 tests, all mutation-verified.**§4.4 — token & cost dashboard (Batch 8).** `session.stats` turned out to take **no `location`** —it scopes by `project`, unlike almost every other endpoint here. That is load-bearing: without aproject id the server may report every project it knows about, so the screen shows a resolving staterather than an unattributed total, and labels the figures with the project they belong to. `tools:"summary"` rather than `"detail"` — the dashboard shows tool totals, and per-tool rows are a largeresponse to carry for something not displayed.

**No token total is computed.** `TokenUsageInfo` splits input/output/reasoning/cache.read/cache.writeand those are not interchangeable: cache reads are billed at a steep discount, and providers disagreeabout whether `input` already includes them. Summing them would overstate a cache-heavy session byroughly an order of magnitude, so the five figures are shown individually and labelled as such. Modelshares use largest-remainder rounding so they sum to exactly 100. Writing the tests found that `Math.round` per-row also sums to 100 for equal-value splits and only breaks when a share ends in `.5` (63+38=101) — a case the original tests missed, now pinned.
Coverage 790 → **871 across 16 files**.

**Then — capability.** §4.3 fork, §5.3 diff mutations, §5.2 background notifications.~~§5.1 run-in-terminal~~ (Batch 9). The render harness these needed is shipped (Batch 10), so thecapability track is no longer blocked on test infrastructure.

**Later — depth.** §5.7 mentions, §6.1-6.5 subsystems, §9 UX polish, §10 dead code, §12 docs.
These make every other task easier and should not be deferred to the end.---

## Batch 9 — §5.1 run-in-terminal

**The button could never have worked, and the doc's line reference was stale.** §5.1 pointed at `AgentChat.tsx:418-424`, which by then was inside `submitText`. The actual path was `MarkdownRenderer` `CodeBlock` → `ChatMessageBubble` → `AgentChat.handleRunCommand` →`executeCommand.mutateAsync({ command })`, and `session.command` runs **named slash commands**. A `bash` block was therefore asking the server to find a command named `npm test`.**`pty` has no `write` method.** The namespace is `list`, `create`, `get`, `update`, `remove`, `connect.token` — writing to a PTY happens only over the WebSocket, and that socket lives inside theterminal WebView (it authenticates with a short-lived ticket in the URL, which is why it livesthere). So a write from the chat has to be **relayed through the WebView**, the same route `__TERMINAL_APPLY_THEME__` already takes for a theme change. Moving the socket up into JS would havebeen a large regression risk to a feature that had just been fixed and tested.

**Two queues, because neither alone is sufficient.** The panel unmounts on every tab switch, so atthe moment Run is tapped there is usually no WebView and no socket — that needs a queue in the app, above the panel. But the socket's own state is only knowable synchronously _inside_ the WebView, and `injectJavaScript` does not return the injected expression's value — so the shell also buffers, forthe window between the panel deciding it is connected and the injected call arriving.

**Typed versus submitted is not a detail.** Live, the text is **typed**: the shell is at a prompt andEnter is the user's to press. Appending the submitting newline would run the command immediately, leave a blank prompt line, and pressing Enter on _that_ line would re-run it. Queued, it is**submitted** — nobody is there to press Enter. `toTerminalInput(text, { newline: false })` makes thedistinction explicit rather than incidental.

**Run is now offered on the shell family only.** The button appeared on _every_ code block; against areal shell, a JSON or TypeScript block just produces a syntax error in the user's terminal. Offering `python` would mean guessing an interpreter invocation for an arbitrary snippet, which is worse thannot offering it.

**Wiring it up surfaced two real ordering bugs in my own first pass**, both invisible until traced:- The sink-registration effect called `cancelPending()` in its cleanup. Since `writeToShell` closes over `webViewState`, that effect re-runs on every connection-state change — so flipping `loading → connected` wiped the queue _before_ the drain could take it. `cancelPending` was removed rather than fixed: a queued write is a request to run a command in a project, tagged with the directory it was asked for, so it cannot fire somewhere unintended. Clearing it on unmount was the difference between "I asked for this and it ran" and "I tapped Run and nothing happened".- The drain ran inside the WebView message handler, right after `setWebViewState("connected")` — so `sinkRef` still held the sink bound to `"loading"`, and every write was rejected. Draining in an effect declared _after_ the sink effect is what makes React's effect ordering do the work.ESLint's `react-hooks/set-state-in-effect` then caught the confirmation banner: setting notice statein an effect body is a cascading render for text the shell is about to display anyway. The deliverycount moved into the bridge, and the panel renders it.

**Mutation verification.** 13 mutations on `src/utils/terminal-input.ts`, **13 caught**. One survivorwas genuine dead code: an explicit `if (!normalized) return false` in `isRunnableLanguage`, whichchanged nothing because a Set lookup of `undefined` is already false — deleted rather than kept. 9mutations on the shell generator (regenerating the real 500KB asset each time), **9 caught**; threeof those survivors were my test's fault, not the shell's — the slice used for the flush-orderingassertion still contained the `function flushWrites() {` _declaration_, so a naive `toContain("flushWrites()")` passed after the call was deleted. The `onopen` handler is now sliced onits own, and the ordering test also asserts `post("connected")` is present so it cannot pass bycomparing against `-1`.

**Coverage 871 → 917 across 18 files.** 46 tests: 34 for framing, language gating and the queue;12 contract tests on the generated shell, which nothing else in the suite examines — and which failsilently if a regeneration drops the hook, because the app injects JS that calls a function which nolonger exists, gets no error, and the command simply never runs.

**Not covered:** the bridge's deliver-live-or-queue branch is four lines whose outcome depends on asink call that cannot be faked from `bun:test`; the panel's effect ordering is only pinned by thereasoning above. Both want the §11.1 render harness.

**Closed in Batch 10.**---

## Batch 10 — §11.1b component-test harness

**The premise had to be checked before the work started.** §11.1 assumed a component-test harnesswas a matter of installing a renderer. It was not: `react-native@0.86` ships Flow-typed source, andreaching it outside Metro needs the whole of React Native's Jest preset —`@testing-library/react-native` peers on `jest >= 29`, so it was never an option under `bun test`. A Bun plugin with `@babel/plugin-transform-flow-strip-types` got as far as transforming `react-native/index.js` before failing on Flow's `as` cast, with Haste resolution and the nativemodules still ahead. Chosen instead: **shim the host layer, real reconciler above it.**`test-renderer@1.3.0` is `react-reconciler`-based, supports React 19, and has no Jest dependency.

**Three environment findings, each of which cost real time and is now pinned by a test:**1. `mock.module` only takes effect **before the module graph is linked**. Registering a context mock at render time made Bun re-resolve `react-native` against the real package, and every component then failed with `Export named 'TurboModuleRegistry' not found`. Hence a preload that registers shapes once, with mutable slots each test fills in.2. Bun resolves **named** ESM imports statically, so a `Proxy` module double is not enough — it fails with `Export named 'X' not found` despite answering any property. The lucide icon keys are read from the app's own imports instead.3. React **bails out of a subtree whose element it has already seen**, and cloning the outermost element does not help — the bailout happens on the identical child. `rerender` only reaches a component if the tree was mounted from a factory. Plus one that would have made every data assertion fail for an unrelated reason: a query fetchresolves through microtasks _and_ a macrotask, so `flush()` needs real event-loop turns. Drainingmicrotasks alone left every screen in its pending state.

**The shim cannot drift silently** — the quiet failure being prevented is a component importingsomething the shim lacks, rendering nothing, and the test passing while asserting nothing. Thenamespace `Proxy` throws on any unimplemented member by name, and `rn-stub-coverage.test.ts`re-scans `src/` every run so a new `react-native` import fails the suite. Nine exports are listedas `NOT_STUBBED` with the reason a fake would mislead — a bad fake of `Animated` is worse than anhonest gap.

**The two §5.1 gaps are closed, and each had broken twice for real.** The bridge'sdeliver-**or**-queue branch and the panel's effect ordering were previously pinned only byreasoning. Both are now driven through a genuine WebSocket lifecycle with only the WebView and thePTY session standing in, because both breakages were invisible to the type checker, to lint, and toevery pure test: the sink effect's cleanup clearing the queue on `loading → connected`, and thedrain running inside the message handler against the sink still bound to `"loading"`.

**Two real defects found by rendering rather than by reasoning:

**- `SavedPermissionsScreen` gated its spinner on `list.isPending` alone. A query with `enabled: false` stays pending forever, so with no client the screen spun indefinitely and could never reach the empty list. Fixed to also require `fetchStatus !== "idle"` — no behaviour change on the connected path.- `tsconfig.test.json` included only `**/__tests__/**/*.ts`, so all five `.tsx` component tests were running under `bun test` while **never being typechecked**. Fixed, plus `src/testing` is excluded from the app build so Bun's and Node's types stay out of it.**31 mutations across three harnesses, all caught** — and the survivors were the interesting part. One found a real gap (a whitespace-only write was sent to a _live_ sink; the blank test onlycovered the queue path). Three were dropped as non-bugs: a drain that happens twice is redundantrather than wrong, and dropping `projectId !== null` from a query's `enabled` changes nothingobservable because the query's own guard throws first. Left out rather than papered over with acontrived assertion — a mutation that demands a failure on working code measures nothing.

**Open finding, now fixed in Batch 12:** `listSavedPermissions(client, activeDirectory)` sent a filesystempath in a field the API names `projectID`. It was real: a live server rejects a path in `projectID` exactly as it rejects a random string, so the screen rendered "No persistent grants" forever and no test could tell that from a project that has none.

**Coverage 917 → 994 across 25 files.** 77 tests: 11 `RevertBanner`, 14 `TerminalBridgeContext`,13 `TerminalPanel.bridge`, 12 `StatsScreen`, 12 `SavedPermissionsScreen`, 8 harness self-checks,7 stub-coverage guards. All gates green — `bun test`, `bun run lint`, `bun run typecheck`, prettier clean, `check:install` up to date.
---

## Batch 12 — verifying the API assumptions against a live server

Four assumptions in this codebase were written down as "the server does X" and never executed, because the app talks to a remote server and CI has nothing to talk to. A comment is a claim, not evidence. A live `opencode serve` settled all four, and **two of the four were wrong**.

`scripts/probe-server-contracts.mjs` (also `bun run validate:contracts`) is the artefact. It imports sessions carrying synthetic messages, so fork and revert are measured without a model provider or an API key, and each probe is written to _disprove_ the assumption first so that agreement is meaningful rather than vacuous. It exits non-zero on disagreement, so it can gate a commit.

| §     | Assumption                                           | Verdict                                                     |
| ----- | ---------------------------------------------------- | ----------------------------------------------------------- |
| §4.3  | `session.fork({before})` keeps the anchor            | **Holds** — `before` is exclusive                           |
| §5.4b | `permission.saved.list` takes a directory            | **Wrong** — a path is rejected like a random string         |
| §4.5  | `session.revert.stage({messageID})` keeps the anchor | **Wrong** — the anchor is the first message _removed_       |
| §4.4  | `session.stats({project})` scoping                   | **Holds** — a project id, which `StatsScreen` already sends |

**`projectID` is not a directory, and nothing named it as such.** `project.list` reports an opaque 40-hex `id` and the filesystem path as two separate fields, `id` and `canonical`. `SavedPermissionsScreen` passed `activeDirectory` straight into a field called `projectID`, so the server matched nothing and the screen said "No persistent grants" — which is _indistinguishable_ from a project that genuinely has none. That is the worst shape a bug can take: correct-looking, silent, and the screen existed precisely to be trustworthy about grants. Fixed by resolving the id through `useCurrentProject()`, the same way `StatsScreen` already did.

The fix needed a second change to be honest: gating the query on a resolved id leaves `data` undefined when the project is unresolved, which looks identical to an empty list. So an unresolved project now gets its own message. Claiming "no grants" about a project the app never asked would have reproduced the original bug in a new place.

**`StatsScreen` was right, and checking was the only way to know.** It passes `useCurrentProject().id`, a real id. Its long comment arguing that `project` must be a project because the input has no `location` field turned out to be the right conclusion by a different route than the one given.

**The revert anchor cuts the same way the fork does.** Both are exclusive, so "fork from here" and "undo from here" cut at the same place — which is what makes anchoring on the most recent _user_ message correct: "undo my last request" should take the request itself, not stop one short of it. The module doc had been deliberately refusing to interpret the id, hedged across a line break, on the grounds that no server could be asked. It can be, so the hedge is now a verified statement.

**A fork renumbers every message it carries.** No source id survives. Nothing may match branch messages to source messages by id, so `forkSession` returns a session id and nothing about messages — the branch has to be re-listed. Found only because the probe printed the ids rather than just counting them.

**Two probe bugs, both of which nearly became findings.** `message.list` returns **newest-first**, and the probe assumed oldest-first — which inverted every index and "disproved" a correct assumption. And reading the revert anchor off the _staged_ state proves nothing, because staging deliberately changes nothing; only the commit reveals it. A probe that reports a wrong answer is worse than no probe, because it gets acted on. Both are now commented where they bit.

**Coverage 1046 → 1048 across 29 files.** The existing test had _pinned the bug on purpose_ — it sent `projectID: "/repo"` with a comment saying the server's expectation was unverified and the test kept the question visible. Inverted, plus two new tests for the unresolved-project branch. Mutation verification: **6/6** (`mutate-batch12.mjs`), zero survivors.

One survivor taught something: ungating the `enabled:` check was invisible, because the `queryFn` guard throws first and the request never happens either way. `StatsScreen` already had the answer — a registered-but-disabled query stays `pending` in the cache while an enabled one lands on `error` — so the test now inspects the query state. Without that, the gate could be deleted with every test still green.

### Also fixed: the CI build died before compiling anything

`build-debug` failed at _Setup Android SDK_, not on anything to do with this project. `android-actions/setup-android@v3` defaults to `packages: tools platform-tools`, and `tools` was withdrawn from the SDK repository years ago — so `sdkmanager tools` exited 1 and took the job with it. The last 200 lines of log were six Google licence agreements.

Upgraded to `setup-android@v4`, whose default is `platform-tools` alone, and **pinned the package list explicitly** so the next action default cannot break the build the same silent way — inheriting that default is what broke it. Also `actions/setup-java@v4` → `@v5`, clearing the Node 20 deprecation warning.

**Verified:** run `37183357142` completed `success`. `build-debug` now gets past SDK setup, prebuild, and the Gradle assemble — so RN 0.86 under `newArchEnabled=true` builds from this checkout at this Windows path, and the failure was entirely the withdrawn `tools` package.

---

## Batch 13 - §5.3 the diff panel

**§5.3 as written asked for per-file revert, apply and discard. That is not implementable, and the reason is worth recording rather than quietly dropping.** Both the SDK and the live server's 116-route OpenAPI expose exactly three revert endpoints, all session-level: `session.revert.unrevert`, `session.revert.stage`, `session.revert.commit`. There is no file or hunk granularity anywhere in the surface. Per-file mutation would mean a new server capability, not a client change.

The mutation axis already exists at the granularity that _is_ available — §4.5's turn-level revert, anchored on the last user message. So §5.3 splits in two, and this batch takes the half that was real: **the diff was unreadable and slow, and said nothing about files git had never seen.**

| Asked for                              | Verdict                                                      |
| -------------------------------------- | ------------------------------------------------------------ |
| Per-file revert / apply / discard      | **Not implementable** — no such endpoint, at any granularity |
| Virtualized line rendering             | Done — `SectionList` over `FlatList`                         |
| Auto-refresh while open                | Done — `refetchInterval: 15_000`                             |
| Per-file counts, collapse, filter      | Done                                                         |
| Show files git has never seen          | Done — reconstructed, see below                              |
| Turn-level revert (the available axis) | Already shipped in §4.5                                      |

### A new file has no diff, which is why it was invisible

`vcs.diff` cannot report a file git has never seen — there is no patch for it. It is not reported as empty; it is **absent**. So the panel was not omitting new files by accident, it was faithfully rendering what the endpoint sent, and the gap was in the endpoint.

Recovering them takes two more calls: a path is untracked when it is in `file.list` and **absent from** `vcs.status`. V2 dropped the `"untracked"` status entirely, so subtraction is the only way left. Both are issued concurrently — sequentially they would add two round trips to the path that already works.

**Both are required, or neither.** With the listing but no status set, every file in the repository reads as new: the panel would claim thousands of new files when the truth is one. `withListing` treats a partial failure as no reconstruction at all rather than as a partial one.

**An untracked file is labelled "new file" and shows no numbers.** Not `+0 −0` — there is no patch, so no lines were counted, and `+0` is a confident claim about a measurement nobody made.

`withUntracked` returns `{ files, untrackedPaths }` rather than a merged list, because "no hunks" is ambiguous on its own: a mode-only change on a tracked file also arrives with no hunks. A caller given only the list would label it new.

### The panel said nothing about scale, which is what makes it hang

The old panel flattened every hunk of every file into one array, so a 4,000-line diff built 4,000 React elements before virtualization could discard any of them. Now each file is a section and each line a row: collapsed, a file contributes `data: []` and its body is never constructed at all.

### A wrong stub would have shipped a crash

Writing the `SectionList` stub, I gave it a `{ section, data }` wrapper — which is not React Native's shape. RN passes each section **flattened alongside** `data` (`SectionListData<ItemT, SectionT> = SectionT & { data: ItemT[] }`). The panel duly passed flat objects and rendered `undefined` for every header.

This is the argument for the §11.1b stub design in one concrete instance: the fake was the thing that was wrong, and had the stub been more permissive it would have been invisible. Fixed, and the correct shape is now asserted rather than assumed — including a by-index section key, because `String(sectionObject)` is `"[object Object]"` for every one of them.

### Five components had no render coverage at all, for a reason nobody had hit yet

Writing the first `UnifiedDiff` render test surfaced a gap with a much larger blast radius: **`react-native-reanimated` was never mocked.** It reaches `TurboModuleRegistry` at module load, so importing it under Bun threw before a single assertion ran. `ChatScrollBar`, `FileDrawer`, `Snackbar`, `WorkspaceScreen` and `UnifiedDiff` all import it — none had ever been render-testable, which is a coverage hole that looks exactly like a component nobody wanted to test.

`src/testing/reanimated-stub.ts` closes it. Its bargain is **values are real, time is not**: a shared value is a genuinely mutable box and `useAnimatedStyle` genuinely evaluates its worklet, so a component renders its _settled_ state — which is the only state a test can assert on. There is no frame loop, so `withTiming` resolves to its destination instantly and no test may observe motion mid-flight. Asserting on animation would require a fake clock that could only be wrong.

### Two lint findings that were real

- `diff?.files ?? []` in a `useMemo` dependency is a fresh array every render, defeating the memo it feeds. Derived inside the callback instead.
- Clearing the filter and collapsed set in an effect on `visible` is `setState` after the render that hid the panel — a second render to change state nothing can see. Moved into the close handler, which is the event that actually caused the transition.

### Verification

**1102 tests across 32 files** (from 1048 / 29). New: 28 `diff-view` model, 10 `UnifiedDiff` render, 16 reanimated-stub self-checks.

Mutation verification: **22/22** (`mutate-batch13.mjs`), zero survivors. Both survivors on the first pass were mine, not the tests': one fixture listed a file in the status set, so the dedupe filter had nothing to remove and the duplicate-rendering mutation was undetectable; the other used only lowercase paths, so a filter that had forgotten to fold case still matched everything. Fixed by making each fixture actually exercise the case its test claimed — a mixed-case path, and an _empty_ status set against a diff that reports the file.

---

## Batch 14 - §5.2 Phase 1, and the test hole that hid a live bug

**The report was right about the defect and understated it.** §5.2 said a tap on "Allow" with no client is "silently dropped". It was worse than that. The old handler was:

```ts
if (action === "allow" || action === "reject" || action === "always-allow") {
  if (v2Client) {
    replyToPermission(v2Client, { ... }).catch(console.error);
  }
  return; // <- skips the banner too
}
```

That `return` also skipped the enqueue below it. So one tap left the request in **no queue at all** — not sent, and not visible in the app either. It came back only on a reconnect, when rehydration re-listed it. The OS had already dismissed the notification, so the system recorded the interaction as handled; the app said nothing, because it had no channel to say anything; and the agent stayed blocked. With §4.9's queue it is worse than one — a killed app can hold _N_ outstanding requests and produce no notification for any of them.

### Why a live bug sat in a mounted, shipped provider with no tests

`PermissionProvider` is mounted at `App.tsx:44` and had **zero** tests. The reason was a single import:

```
expo-notifications → expo-modules-core → expo/src/async-require/setup.ts
                                              if (__DEV__ && ...)   // ReferenceError
```

`__DEV__` is a global only Metro defines, so the module cannot be loaded under `bun test` at all — the failure is at module load, before any assertion. The comment in `setup.ts` blamed the provider's event-bus subscription instead, which was **not** the blocker (`useConnection` is already substituted there). A plausible wrong reason is worse than no reason: it reads as a considered decision.

That one native import was hiding the SSE subscription, the mount-time rehydration, the auto-approve path, the `AppState` gate on posting, and the notification listener. `AppState` was the second blocker — it was absent from the React Native stub, so the namespace `Proxy` would have thrown on it.

### What shipped

`src/api/notification-replies.ts` (pure) holds the decision table and the deferred-reply queue. Two properties of it are deliberate:

- **"Ignored" is named, not silent.** A response the app declines to act on returns `{ kind: "ignored", reason: "not-a-permission" | "missing-identifiers" }`. `null` would make "not ours" and "ours but malformed" indistinguishable — which is precisely the vocabulary in which the original bug was invisible.
- **A replacement keeps its position.** A second tap on one request replaces rather than appends, and does so **in place**. Caught by a test written from the principle before the implementation existed: appending reorders the sends, and §4.9 established that order is load-bearing because the agent is blocked on its own queue head.

`PermissionProvider` now: enqueues the request **first**, whatever the tap was; sends the reply if a client exists; otherwise **holds** it. Held replies flush when a client appears, are dropped on success, and are kept on failure — a dropped one would leave the agent blocked on a prompt that looks answered. `PermissionBanner` shows the count, which is the honest answer to "gate the actions when the client is not ready": the OS presents those buttons and the app cannot un-present them, so what it can do is never lose the tap and say so.

### Two gaps the new tests found in the fix itself

- **The cold-start read double-answered.** `isSameNotification` was written into the pure module and then never called. Read-after-register deliberately overlaps the two routes — that is what closes the gap — so the overlap is designed in, and without dedupe one tap produced two replies, the second of which the server rejects as already-answered. Dedupe is keyed on the **OS's** notification id, matching the package's own `determineNextResponse`.
- **The `AppState` gate was asserted but unreachable until `AppState` became drivable.** Moving the stub's `currentState` from a constant to a getter plus an emitter is what makes "posts in the background, not in the foreground" a test rather than a hope.

### Verified from the package source, not from memory

- `getLastNotificationResponse` is the current API; `getLastNotificationResponseAsync` is **deprecated** and merely calls it. Only the current spelling is stubbed, so a test cannot reach for a shim.
- `opensAppToForeground` defaults to `true`, and the package documents that a `false` action does **not** reach the listener when the app is killed. Now set explicitly with the reason: it is what gives the cold-start read something to find.

### Harness work this required, and one gap it exposed

Three new stubs (`notifications-stub`, `event-bus-stub`, `AppState`) and two harness options (`notificationResponse`, `notificationPermissionStatus`), all because `mount` resets every slot — so a value set before mounting is gone before the component runs. That reset is correct, and it means the only way to say "the user tapped before JavaScript existed" is as part of the world the mount creates.

Adding `MountedTree.act` fixed a gap that had been hiding in plain sight: nothing could drive an **external** stimulus into a mounted tree. Presses went through `act`; an SSE event or a notification tap did not, so the `setState` was applied but not flushed and the next assertion read stale state. Every such failure looks exactly like a product bug.

`PermissionState` gained `deferredCount: 0`. It looked unnecessary — `deferredCountLabel(undefined)` returns a **truthy** string, so the banner rendered "undefined replies waiting for the connection" and all 13 banner tests still passed. A harness state that disagrees with the real shape turns a missing field into a visible lie and fails nothing.

### Verification

**1168 tests across 34 files** (from 1102 / 32). New: 33 `permission-provider`, 29 `notification-replies`, 4 `PermissionBanner` deferred-notice, plus the stub's own contract.

Mutation verification: **31/31** (`mutate-batch14.mjs`), zero survivors. Three things the survivors taught:

1. Two first-pass survivors were one gap: the **immediate-send** failure path and the **flush** failure path both existed, but only the flush was tested — and because deferring on immediate failure _triggers_ a flush retry, the flush's `setError` masked the immediate one. Fixed with a handler that fails once then succeeds, which separates them.
2. A test that mounts twice cannot assert on the shared call log — the second mount resets it. Rewritten to assert on the mechanism instead: the cold-start slot is emptied.
3. `deferReply`'s position-preserving replace was the _implementation_ being wrong, not the test. A test written from the stated principle caught it.

One correction to an earlier claim in this document: I stated during the work that `PermissionProvider` was never rendered. It is — at `App.tsx:44`. My grep had only searched `src`.

---

## Batch 15 - review findings on Batches 13 and 14

A review of the two most recent commits found eight issues. Four are fixed here; the rest are listed at the end as still open, because each needs a decision rather than a patch.

### 1. The diff panel fetched and rendered while closed (performance)

`WorkspaceScreen.tsx` mounts `UnifiedDiff` unconditionally and hides it with `pointerEvents`. `useQuery` gated on `enabled: Boolean(client)` and never on `visible`, so a panel that was never opened still ran every 15 seconds:

- `vcs.diff` - the working-tree diff
- `vcs.status` - server-side git status
- `file.list` - **every path in the workspace**

and then rebuilt the entire row model through `toDiffSections`. Measured with a throwaway test: rendering `visible={false}` produced one `vcs.diff` call and the full tree, header and all rows. `file.list` is the sharp edge - in a large repo it is tens of thousands of paths, every 15 seconds, on a mobile client talking to a remote dev box.

Fixed by threading `visible` into `useWorkspaceDiff` and gating on it. Every existing `UnifiedDiff` test rendered with `visible`, so the closed case had no coverage at all; there are now two tests, one per direction, because a gate that never opens looks identical to a gate that works if nothing asserts the open case reaches the server.

### 2. The biometric lock did not gate notification replies (security)

The app lock is enforced as an **overlay on the workspace screen**. That is a display gate: it hides the session without stopping the app from acting. `handleNotificationResponse` never consulted `lockState`, so tapping "Allow" or "Always Allow" on a notification answered the agent **with the lock up** - the prompt would be on screen while the approval was already sent. All three actions are also registered with `isAuthenticationRequired: false`, so the OS did not demand device auth either, and "Always Allow" writes a grant that outlives the session.

Replies are now **held** while the gate is up and released on unlock. The deferred queue from Batch 14 is reused rather than a second mechanism invented: unlocking is simply another reason a reply became sendable, and the flush effect already runs on that kind of transition.

The predicate is `isLockGated` in `biometric-lock-state.ts`, shared with nothing else today but written so the screen and the provider cannot drift. It takes `biometricAvailable` as well as `lockState`, and **that is the part that prevents a hang**: the stored preference is a boolean the user set once, biometrics can be unenrolled in system settings afterwards, and `authenticate()` then returns `false` without ever leaving `"locked"`. Gating on `lockState` alone would hold every approval permanently, with the banner blaming a connection that is perfectly healthy. `lockState !== "unlocked"` is deliberate too - `"unlocking"` is the moment the user has _not_ been authenticated yet, so it is the worst moment to send an approval.

`biometricAvailable` moved from a private probe in `WorkspaceScreen` into `useBiometricLock`, because two consumers now need it and two independent probes are two answers.

### 3. The flush loop could double-send, and the harness could not see it

The old flush walked the whole snapshot while each successful send shrank the very state it was iterating. `setDeferred` schedules a render; React serves it on the Scheduler's `MessageChannel` (a macrotask) while the loop's next iteration resumes in a microtask. The next send could therefore begin before the cleanup that set `cancelled`, and the re-run the shrinking state triggers would send the same entry twice - the server accepts the first and rejects the second, which reaches the user as their approval bouncing back.

**It does not reproduce under this harness, and that is the finding.** `act` flushes React synchronously, so the cleanup always wins. The existing suite never reached the case either: two tests held exactly one entry, and the test holding two never connected a client. The flush is now **head-only** - one entry per effect run, with the next run driven by the state change - plus an in-flight set for the remaining way a re-run can overlap.

Two mutations survived the first sweep and both were honest:

- The in-flight guard could not be reached, because a tap taken with a client present is sent **immediately** and never queues. Making the second tap's send fail is what puts an entry behind the in-flight head, and a hanging first send is what keeps it there. That test now exists.
- The `cancelled` flag was suppressing `setError`, which meant a send that failed _because_ the queue changed underneath it reported nothing at all. Dropped it: setting state after unmount is a no-op, so there was nothing to guard, and the silent failure was the cost.

### 4. `removeDeferredReply` contradicted its own comment

The comment said "Returns the same array if it was not held"; the code returned `[...deferred]`. Since every reply that sends immediately clears itself through this function, and an immediate send holds nothing, the copy meant a state update and a flush-effect re-run on **every notification tap**, changing no value. There was a test asserting the copy, so the contradiction was pinned in both directions.

### Also fixed

- `deferredCountLabel` typed its count as required, so a context state missing the field fell through every comparison to the plural branch and rendered "undefined replies waiting for the connection". It now accepts `number | undefined` and returns `null` for anything non-numeric. That was the same class of bug as the `deferredCount` gap in Batch 14, reached a second way.
- `handledNotificationsRef` was used 100 lines above its declaration. Correct at runtime, since effect callbacks run post-render, but it reads as a TDZ bug.

### Verification

**1187 tests across 34 files** (from 1168). New: 6 provider lock tests, 5 `isLockGated`, 3 `deferredCountLabel`, 2 `UnifiedDiff` closed-panel, 2 multi-entry flush.

Mutation verification: **14/14** (`mutate-review.mjs`), zero survivors.

One process note worth recording: `bun test` writes its summary lines to **stderr**, so a mutation script reading only stdout reports every mutation as a survivor. That produced one false "14/14 survived" run before it was caught. And the `edit` tool renders em dashes as `--` when reading, so copying a comment out of a read result silently converts them; the corruption was caught by diffing against `HEAD` and counting `U+2014` per file, which is now part of the routine for any change to a file containing non-ASCII.

### Still open, pending a decision

- ~~**A stale error survives a successful retry.**~~ **Resolved in Batch 16.** `deliverReply` now clears the error on success, and both halves are pinned: a failure with no retry keeps its message, a recovered one drops it.
- ~~**`respond()` rethrows into four `void` callers.**~~ **Resolved in Batch 16.** `respond` resolves on failure with the error still set. Tested in both directions, because a resolution-only test would pass just as well if the error had been swallowed.
- ~~**The collapse comment overstates what collapse does.**~~ **Resolved in Batch 16**, and not only the comment: `collapsed` is now an option on `toDiffSections`, checked before the rows exist, so a folded file genuinely never allocates a `DiffRow`.
- **§5.2 Phase 2** - no push endpoint exists on the server (116 routes, zero matching push/device/notification/subscribe), and `expo-task-manager` is not installed. Unresolved from the review.
- ~~**The server has a form surface the app ignores.**~~ **Wrong, and retired in Batch 17.** The premise was checked against a live server and the surface is _already fully adopted_: src/api/forms.ts is implemented, QuestionContext holds the pending list with a cold-start read, and QuestionBanner renders the fields. All four server form paths match, verified by execution rather than by reading the spec. §5.2's listing of question/form requests as missing is obsolete - the note was written about a surface nobody had opened, and reading it as a task list is what kept it resurfacing. The live probe did find one real defect here, now fixed in Batch 18: a form containing an xternal field could not be answered at all.

---

## Batch 16 - the three stability fixes left open by the review

Batch 15 closed the review's four blocking findings and listed the rest as needing a decision. These are the decisions, taken.

### A stale error survived a successful retry

`deliverReply` cleared the entry on success but never `setError(null)`, so after a failed flush and then a successful one the banner went on reading "server said no" about a reply the agent had accepted. Proven in Batch 15's review with `deferred:0 err:server said no`.

A test asserted the opposite, and its reasoning was not wrong so much as incomplete: _"silently clearing it would tell the user nothing went wrong"_ is exactly right while the reply is still failing and exactly wrong once it has gone through. Both halves are now pinned - a failure with no retry keeps its message, a failure the retry recovered from drops it.

Clearing on _every_ success, not only a recovered one, is deliberate. The error is a duplicate of what the user already has: a reply that failed leaves its request in the visible queue, so the banner is already showing the outstanding work. Nothing is lost, and the alternative - tracking which request each message belongs to - is state for a label.

### `respond()` rethrew into four `void` callers

All three banner buttons and the harness were `void respond(...)`, so the rejection had no observer: the message reached the user through `error` and the same rejection became an unhandled rejection, which on a release build is a crash report about a permission the user was told had failed _and visibly failed_. `respond` now resolves on failure, with the error still set. The type comment says so, because "resolves" is surprising for an async function unless it is written down.

Both directions are tested: resolving _and_ still reporting. A test that only asserted the resolution would pass just as well if the error had been swallowed, which is the same shape of bug as the `undefined` count in Batch 14.

### Collapse now avoids building the rows, rather than hiding them

The comment claimed a collapsed file's body "is never built", and it was wrong. `toDiffSections` built every `DiffRow` for every file, and the component then blanked `data` for the collapsed ones. Identical section list, completely different allocation - and this module runs on every 15-second refresh, so for a large diff it was building a row object for every line the user had folded away.

`collapsed` is now an option on `toDiffSections`, checked _before_ the rows exist, and the component's separate `collapsed.has(...) ? [] : ...` mapping is gone. Counts deliberately still come from the hunks: counting the rows that were not built would show "+0 -0" in a folded file's header, which reads as a change the agent undid rather than one out of sight, and would disagree with the panel's own totals.

The panel test that asserts a collapsed body disappears cannot tell the two implementations apart - both render the same. Only the pure-module tests can, so they assert on `rows.length`, and one asserts that expanding rebuilds them, because a one-directional predicate would fold a file permanently and nothing else would notice.

### Verification

**1193 tests across 34 files** (from 1187). New: 5 `toDiffSections` collapse tests, 1 `respond` contract test, 1 kept-failure test.

Mutation verification: **8/8** (`mutate-batch16.mjs`), zero survivors. Two of the eight are the directions that matter most: clearing the error _before_ the send rather than after (6 failures, since it would wipe a genuine failure message), and counting from the built rows so a folded file reports zero.

One housekeeping note: `suggestions.md` picked up a formatting-only change - prettier rewrites markdown emphasis from `*x*` to `_x*` - and added a trailing newline. Nothing in the commit path formats, so the cause is not pinned down; both files are `prettier --check` clean now, which is what `bun run check` requires, so the change was kept rather than reverted. Worth knowing that `bun run format` would reintroduce it either way.

---

## Batch 17 - §12 docs, and the form probe

### §12 `docs/ARCHITECTURE.md`, rewritten

Rewrote it against the source tree and a running server. Every claim in the new
version was checked; where a claim would need a live server it says so instead of
asserting it. 253 lines to 487.

What was actually wrong:

- **The SDK was named wrongly and versioned wrongly.** It claimed
  `@opencode-ai/sdk/client` v1. The real dependency is `@opencode/client`
  **2.0.22**, targeting the **V2** API. `@opencode-ai/sdk` is not installed.
- **`directory.ts` does not exist.** V1's flat `?directory=` parameter is
  replaced by `src/api/opencode/location.ts`, which serializes a `location`
  object to the deepObject parameter `?location[directory]=` and passes it per
  call. Session endpoints take no location at all, and passing one is a schema
  error.
- **Five of nine navigation routes were missing**, including the whole Cursor
  path (`ProviderPicker`, `CursorConnection`, `CursorSessions`) plus
  `SavedPermissions` and `Stats`.
- **Two providers were missing** from the tree table (`SessionMetaProvider`,
  `QuestionProvider`), as was `TerminalBridgeContext` - which is not in `App.tsx`
  at all, but mounted per-workspace inside `WorkspaceScreen`.
- **The agent provider abstraction was absent entirely.** `src/api/providers/`
  with the `AgentProvider` interface and both the `opencode` and `cursor`
  implementations is the largest subsystem the old document never mentioned.
- **The event vocabulary was V1.** The old list (`message.updated`,
  `message.part.updated`, `command.executed`) is gone. The app branches on 34 V2
  names; they are now grouped by family in a table.
- **`hacker` was missing**, making it 8 themes rather than 7.
- **The landscape rail dimensions were wrong.** Not "320px / 35%" but
  `min(max(screenWidth × 0.28, 160), 200)` - 160 to 200 px - and it renders only
  on `isTablet && isLandscape && activePanel === "agent"`.
- **The diff panel description was stale.** It does not read `useFilePatch` per
  file; `useWorkspaceDiff(visible)` runs one 15-second query gated on `visible`,
  prefers the working tree, and falls back to the session diff _without_ the
  untracked overlay.
- **`src/components/chat/`** was missing as a subsystem.

Claims that turned out to be **correct** and were kept: React Native 0.86 +
Expo SDK 57, gesture-handler 2.32, reanimated 4.5, the reconnect constants
(30 s ping, 1 s base, 60 s cap, 20 attempts, 10% jitter), `FontScale` as
0.85 | 1 | 1.15 | 1.3, 14 colour tokens, 5 spacing values, and
`testConnection` / `ensureSession` living in `client.ts`.

Two corrections I made to my own draft rather than ship: I wrote "eleven
providers" over a table of eight, and "and two more" after listing 11 of 14
colour tokens. Both were the same sloppiness I was removing from the old file.

### The form probe - the surface is adopted, and one bug is live

**The premise was wrong.** §5.2 listed question/form requests as missing. They
are not: `src/api/forms.ts` is fully implemented, `QuestionContext` holds the
pending list with a cold-start read, and `QuestionBanner` renders the fields. The
"unused server form surface" note in this file was stale and is now retired.

**All four form paths match the server**, confirmed against the live OpenAPI
(116 routes, 4 matching `/form/`) and then executed for real. One thing nearly
became a false bug report: `client.session.form.cancel` has no `POST .../cancel`
path in the spec, which looked like a mismatch until reading the SDK showed
`cancel` is a `DELETE` on the resource path with `?message=` - exactly what the
server declares. Verified, not assumed.

**One real bug, found by running the app's own code against a real form.**

> The server requires every `external` field to be acknowledged in the answer
> map. Omitting it fails the entire reply with `FormInvalidAnswerError:
External form field must be acknowledged: <key>`.

`initialAnswer()` skips external fields by design (`if (field.type ===
"external") continue`), `missingRequiredKeys()` skips them too, and
`QuestionBanner` renders them as a bare link with no control that writes to the
answer map. **There is no path by which this app can produce a valid answer for a
form containing an `external` field.** Such a form is unsubmittable: the user
taps submit, gets an error naming a field they cannot set, and the agent stays
blocked.

Found by brute-forcing the accepted value rather than reading the spec and
hoping: `true` is accepted, and it is the only one of `true / false /
"acknowledged" / {}` that is.

Method notes, all of which cost time and are worth keeping:

- **A 401 is not evidence.** Every `/api/*` path returns 401 because auth runs
  before routing, so an unauthenticated probe cannot distinguish "route missing"
  from "route exists". The earlier `GET /api/form` "timeout" was the auth
  middleware holding the connection, not evidence of anything.
- The two running servers had unrecoverable generated passwords, so a fresh
  `opencode serve` was started on a spare port with a password set explicitly.
- Sessions carry their directory at `location.directory`, not `directory` (the
  V1 field name). Reading the wrong one yields `undefined` and looks like an
  empty list.
- An `external` field needs a `url` at creation; the server rejects the form
  without one.
- Two of the probe's own assertions were wrong (a miscounted visible-field
  total, and asserting a visible-but-optional field is demanded) and were
  corrected rather than left to make the app look wrong.
- The leftover probe form was cancelled with `DELETE` (204), which also
  confirmed `cancelForm` works against the real server.

Per "report before changing anything", the gap was documented in
`ARCHITECTURE.md` first -- then fixed in Batch 18 and the doc updated to describe
the resolved contract. The fix is the one the sentence already named: seed
external fields to `false` in `initialAnswer`, render an acknowledgement toggle
in `QuestionBanner` that writes `true`, and stop skipping external fields in
`missingRequiredKeys` so a missing acknowledgement is reported before submit
rather than as a server rejection after it.

### Verification

1193 tests, unchanged and passing - this batch changed no product code.
`tsc`, `eslint` and `prettier --check .` all clean.

---

## Batch 18 - external fields can now be answered

The form probe (Batch 17) ended with a question: the server requires every
`external` field to carry `true`, and the app had no way to provide it. The fix.

### The verified constraint

Probed against a live server, not read from the spec: of `omitted`, `false`,
`"yes"`, `1` and `true`, **only `true` is accepted**. Everything else fails the
_entire_ reply with
`FormInvalidAnswerError: External form field must be acknowledged: <key>`. So
this is not "the field is optional and the value is advisory" -- it is
"the reply is refused" unless the user confirms they visited the link.

### The three places the app got this wrong

1. `initialAnswer()` skipped external fields, so the answer map never had a key
   for them.
2. `missingRequiredKeys()` skipped them too, so an unacknowledged external field
   was never reported before submit.
3. The payload builder in `QuestionBanner` skipped them, so even an
   acknowledgement the UI had collected was dropped on the floor.

The component therefore showed a bare link with no control and no validation,
and "Submit" sent a payload the server was guaranteed to refuse -- a form
containing any external field was unsubmittable.

### The fix

- `initialAnswer()` now seeds every external field to `false`. The key has to
  exist for a controlled toggle; `false` is the unacknowledged state, not an
  answer.
- `isUnanswered()` is split out from `isEmptyValue()`: for an `external` field
  unacknowledged means `!== true`; for a boolean field `false` is a real answer
  ("No"), so the two must not share a rule. A single `isEmptyValue`-backed check
  is how the boolean case would have been rebroken while fixing the external one.
- `missingRequiredKeys()` treats external fields as required unconditionally --
  the author's `required` flag is irrelevant, the server demands it either way --
  and flags them until the value is exactly `true`.
- `QuestionBanner` renders a "I have read this" / "Not yet" toggle beside the
  link, marks the field required, and the payload builder no longer drops it.
  Submit is blocked before the request leaves: the local gate now mirrors the
  server's own rule.
- `styles.external` gap widened from 2 to `spacing.sm`, since it now hosts two
  children instead of one.

### Getting there: the stub gap

`QuestionBanner` could not be tested before this batch. It imports `Linking` from
`react-native`, and the RN test shim listed `Linking` under `NOT_STUBBED` -- so
the shim's proxy threw on import, failing the whole graph before a single
assertion ran. The stub now provides a no-op `Linking.openURL` that resolves
`true`, and `Linking` moved from `NOT_STUBBED` to `IMPLEMENTED` in
`rn-stub-coverage.test.ts`. `openURL` is not asserted on (out of scope for a
render test); it is stubbed so the component is renderable and its _logic_ is
exercisable, which is the gap that held.

### Tests

- New `src/components/__tests__/QuestionBanner.test.tsx`: renders nothing when
  no form is pending, renders the link + toggle, blocks submit while
  unacknowledged, and -- the regression -- sends `{ runbook: true }` once the
  user confirms. Includes a boolean-`false` case pinning the `isUnanswered`
  split: "No" must still submit.
- `forms.test.ts`: six new/moved cases pinning `initialAnswer` seeding external
  to `false` (ignoring any `default`), unacknowledged external as required,
  `true`-only acknowledgement, and boolean `false` not missing.

**1202 tests across 35 files** (from 1193). `tsc` (app + test), `eslint`,
`prettier --check .` all clean.

### Mutation verification

7/7, zero survivors (`mutate-batch18.mjs`):

- `initialAnswer` reverts to skipping external
- `isUnanswered` reverts to `isEmptyValue` for external (breaks the
  false-is-meaningful-for-boolean case)
- `missingRequiredKeys` excludes external again
- the payload builder skips external again
- the toggle writes the wrong value
- the toggle is removed (link-only)
- acknowledged external still treated as required

Notably, both directions of the core contract are pinned: `false` is refused
(`isUnanswered` split) _and_ `true` is accepted (the payload test), so the only
survivable middle ground -- "treat any value as acknowledgement" -- is covered by
neither and therefore cannot exist.
