# Auto Detect Sessions by History

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement per-directory session history, smart session ranking, session activity indicators, and auto-switch on project change so the app remembers and auto-selects the most relevant session per workspace.

**Architecture:** Extend AsyncStorage keys to be directory-scoped, add a scoring function that ranks sessions by recency/cost/message-count, add status badges to SessionPicker, and wire `selectProject` to auto-pick the best session.

**Tech Stack:** React Native (Expo SDK 56), AsyncStorage, `@opencode-ai/sdk/client`, `@tanstack/react-query`, React Navigation, `lucide-react-native` icons.

## Global Constraints

- Pin `react-native-gesture-handler` to exact `2.31.1`.
- Use Bun for installs and scripts.
- Expo SDK 56 stable; React Navigation native stack (not Expo Router).
- No git commits or pushes unless explicitly requested.
- PowerShell-compatible shell commands only (Windows).
- ESLint 10 flat config, TypeScript 6.

---

## File Map

| File                                | Purpose                                                         |
| ----------------------------------- | --------------------------------------------------------------- |
| `src/api/client.ts`                 | Modify `ensureSession` to use smart ranking                     |
| `src/context/ConnectionContext.tsx` | Directory-scoped session storage, auto-switch on project change |
| `src/utils/session-ranking.ts`      | **New** — scoring/ranking logic                                 |
| `src/components/SessionPicker.tsx`  | Activity indicators (running badge, message count)              |
| `src/components/CommandPalette.tsx` | Activity indicators for sessions in palette                     |

---

## Task 1: Create session ranking utility

**Files:**

- Create: `src/utils/session-ranking.ts`

**Interfaces:**

- Consumes: `Session` from `@opencode-ai/sdk/client` (fields: `time.updated`, `time.created`, `cost`, `tokens`, `summary`, `title`)
- Produces: `rankSessions(sessions: Session[]): Session[]` — returns sessions sorted by composite score descending

- [ ] **Step 1: Create the ranking module**

```typescript
// src/utils/session-ranking.ts
import type { Session } from "@opencode-ai/sdk/client";

/**
 * Composite score for ranking sessions.
 * Higher = more relevant to resume.
 *
 * Factors (weights):
 *   recency  — minutes since last update (exponential decay, half-life 60 min)
 *   activity — summary.additions + summary.deletions (log-scaled)
 *   cost     — session cost in dollars (log-scaled, capped)
 */
function recencyScore(updatedAt: number): number {
  const minutesAgo = (Date.now() - updatedAt) / 60_000;
  // exponential decay: 1.0 at now, ~0.5 at 60 min, ~0.25 at 120 min
  return Math.pow(0.5, minutesAgo / 60);
}

function activityScore(session: Session): number {
  const additions = session.summary?.additions ?? 0;
  const deletions = session.summary?.deletions ?? 0;
  const totalChanges = additions + deletions;
  // log-scale so 1 change ~ 0, 10 changes ~ 1, 100 changes ~ 2
  return Math.log10(Math.max(totalChanges, 1));
}

function costScore(session: Session): number {
  const cost = session.cost ?? 0;
  // log-scale, capped at $5 = ~0.7
  return Math.min(Math.log10(Math.max(cost, 0.01)) + 2, 0.7);
}

function compositeScore(session: Session): number {
  const recency = recencyScore(session.time.updated);
  const activity = activityScore(session);
  const cost = costScore(session);

  // weighted sum: recency dominates (70%), activity (20%), cost (10%)
  return recency * 0.7 + activity * 0.2 + cost * 0.1;
}

/**
 * Rank sessions by composite relevance score (descending).
 * Pure function — no side effects.
 */
export function rankSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => compositeScore(b) - compositeScore(a));
}

/**
 * Find the single best session from a list.
 * Returns null if the list is empty.
 */
export function bestSession(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null;
  return rankSessions(sessions)[0] ?? null;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit --pretty`
Expected: no errors (or only pre-existing errors unrelated to this file)

- [ ] **Step 3: Commit**

```bash
git add src/utils/session-ranking.ts
git commit -m "feat: add session ranking utility with recency/activity/cost scoring"
```

---

## Task 2: Directory-scoped session persistence

**Files:**

- Modify: `src/context/ConnectionContext.tsx` (lines ~46–48 storage keys, lines ~111–121 save/load helpers)

**Interfaces:**

- Consumes: existing `SESSION_KEY_PREFIX` constant
- Produces: updated `saveLastSessionId` / `loadLastSessionId` that accept a directory param and encode it into the key

- [ ] **Step 1: Add directory-scoped key helper**

In `src/context/ConnectionContext.tsx`, after the existing constants (line ~48), add:

```typescript
const SESSION_DIR_KEY_PREFIX = "@desk-escape/session-dir:";
```

Add a new helper after `loadLastDirectory` (around line ~133):

```typescript
function sessionStorageKey(baseUrl: string, directory?: string | null): string {
  const dir = directory?.trim() || "_default";
  return `${SESSION_DIR_KEY_PREFIX}${baseUrl}:${dir}`;
}

async function saveDirectorySessionId(
  baseUrl: string,
  directory: string | null | undefined,
  sessionId: string,
): Promise<void> {
  const key = sessionStorageKey(baseUrl, directory);
  await AsyncStorage.setItem(key, sessionId);
}

async function loadDirectorySessionId(
  baseUrl: string,
  directory: string | null | undefined,
): Promise<string | undefined> {
  const key = sessionStorageKey(baseUrl, directory);
  const value = await AsyncStorage.getItem(key);
  return value ?? undefined;
}
```

- [ ] **Step 2: Update `connect()` to use directory-scoped storage**

In the `connect` callback (around line ~313), change:

```typescript
// BEFORE:
const savedSessionId = await loadLastSessionId(nextConfig.baseUrl);
const nextSession = await ensureSession(
  nextClient,
  savedSessionId,
  savedDirectory,
);

// AFTER:
const savedSessionId = await loadDirectorySessionId(
  nextConfig.baseUrl,
  savedDirectory,
);
const nextSession = await ensureSession(
  nextClient,
  savedSessionId,
  savedDirectory,
);
```

And later (around line ~346), change:

```typescript
// BEFORE:
await saveLastSessionId(nextConfig.baseUrl, nextSession.id);

// AFTER:
await saveDirectorySessionId(
  nextConfig.baseUrl,
  savedDirectory,
  nextSession.id,
);
```

- [ ] **Step 3: Update `selectSession()` to save directory-scoped**

In the `selectSession` callback (around line ~399), change:

```typescript
// BEFORE:
await saveLastSessionId(config?.baseUrl ?? "", sessionId);

// AFTER:
await saveDirectorySessionId(config?.baseUrl ?? "", activeDirectory, sessionId);
```

Add `activeDirectory` to the `useCallback` deps array.

- [ ] **Step 4: Update `selectProject()` to use directory-scoped storage**

In the `selectProject` callback (around line ~418), change the two places where `saveLastSessionId` is called:

```typescript
// BEFORE (line ~442):
await saveLastSessionId(config.baseUrl, existing.id);

// AFTER:
await saveDirectorySessionId(config.baseUrl, worktree, existing.id);
```

```typescript
// BEFORE (line ~452):
await saveLastSessionId(config.baseUrl, created.id);

// AFTER:
await saveDirectorySessionId(config.baseUrl, worktree, created.id);
```

- [ ] **Step 5: Update `createSession()` to save directory-scoped**

In the `createSession` callback (around line ~461), change:

```typescript
// BEFORE:
await saveLastSessionId(config?.baseUrl ?? "", session.id);

// AFTER:
await saveDirectorySessionId(
  config?.baseUrl ?? "",
  activeDirectory,
  session.id,
);
```

Add `activeDirectory` to the `useCallback` deps array.

- [ ] **Step 6: Update `deleteSession()` to save directory-scoped**

In the `deleteSession` callback (around line ~482), change:

```typescript
// BEFORE (line ~501):
await saveLastSessionId(config?.baseUrl ?? "", next.id);

// AFTER:
await saveDirectorySessionId(config?.baseUrl ?? "", activeDirectory, next.id);
```

Add `activeDirectory` to the `useCallback` deps array.

- [ ] **Step 7: Remove old non-scoped helpers**

Remove the `saveLastSessionId` and `loadLastSessionId` functions (lines ~111–121) since they are no longer used. Also remove `SESSION_KEY_PREFIX` constant (line ~47).

- [ ] **Step 8: Verify it compiles**

Run: `bunx tsc --noEmit --pretty`
Expected: no new errors

- [ ] **Step 9: Commit**

```bash
git add src/context/ConnectionContext.tsx
git commit -m "feat: scope session persistence by directory for per-project history"
```

---

## Task 3: Integrate smart ranking into `ensureSession`

**Files:**

- Modify: `src/api/client.ts` (lines ~143–177 `ensureSession`)

**Interfaces:**

- Consumes: `bestSession` from `@/utils/session-ranking`, `Session` type
- Produces: unchanged `ensureSession` signature, but now picks best-ranked session instead of `sessions.data?.[0]`

- [ ] **Step 1: Import the ranking utility**

Add at top of `src/api/client.ts`:

```typescript
import { bestSession } from "@/utils/session-ranking";
```

- [ ] **Step 2: Update `ensureSession` to use ranking**

Replace lines ~160–165:

```typescript
// BEFORE:
const sessions = await client.session.list(dirQuery);
const existing = sessions.data?.[0];

if (existing) {
  return existing;
}

// AFTER:
const sessions = await client.session.list(dirQuery);
const existing = bestSession(sessions.data ?? []);

if (existing) {
  return existing;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `bunx tsc --noEmit --pretty`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add src/api/client.ts
git commit -m "feat: use smart session ranking as fallback in ensureSession"
```

---

## Task 4: Auto-switch session on project change

**Files:**

- Modify: `src/context/ConnectionContext.tsx` (`selectProject` callback, lines ~418–458)

**Interfaces:**

- Consumes: `bestSession` from `@/utils/session-ranking`, `loadDirectorySessionId` from step 2
- Produces: `selectProject` now tries directory-scoped saved session first, then ranks existing sessions for the new directory

- [ ] **Step 1: Add import**

In `src/context/ConnectionContext.tsx`, add:

```typescript
import { bestSession } from "@/utils/session-ranking";
```

- [ ] **Step 2: Rewrite `selectProject` to use smart detection**

Replace the body of `selectProject` (lines ~424–456) with:

```typescript
const selectProject = useCallback(
  async (worktree: string) => {
    if (!provider || !config) {
      throw new Error("Not connected.");
    }

    setActiveDirectory(worktree);
    await saveLastDirectory(config.baseUrl, worktree);

    const nextProject = (await provider.getCurrentProject()) as Project | null;
    setProject(nextProject);

    // 1. Try directory-scoped saved session
    const savedSessionId = await loadDirectorySessionId(
      config.baseUrl,
      worktree,
    );

    if (savedSessionId) {
      try {
        const result = await provider.selectSession(savedSessionId);
        setSession({
          id: result.id,
          title: result.title,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          status: result.status,
        } as unknown as Session);
        setContextAttachments([]);
        await queryClient.invalidateQueries();
        return;
      } catch {
        // Saved session no longer exists — fall through to ranking
      }
    }

    // 2. Fetch all sessions for this directory and pick the best one
    const sessions = await client?.session.list(withDirectoryQuery(worktree));
    const ranked = bestSession((sessions?.data ?? []) as Session[]);

    if (ranked) {
      setSession(ranked);
      await saveDirectorySessionId(config.baseUrl, worktree, ranked.id);
    } else {
      // 3. No sessions exist — create one
      const created = await provider.createSession("Desk Escape");
      setSession({
        id: created.id,
        title: created.title,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        status: created.status,
      } as unknown as Session);
      await saveDirectorySessionId(config.baseUrl, worktree, created.id);
    }

    setContextAttachments([]);
    await queryClient.invalidateQueries();
  },
  [client, config, provider, queryClient],
);
```

- [ ] **Step 3: Verify it compiles**

Run: `bunx tsc --noEmit --pretty`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add src/context/ConnectionContext.tsx
git commit -m "feat: auto-detect best session when switching projects"
```

---

## Task 5: Session activity indicators in SessionPicker

**Files:**

- Modify: `src/components/SessionPicker.tsx` (styles + renderItem)

**Interfaces:**

- Consumes: `Session` fields (`time.updated`, `summary`, `cost`, `tokens`), `useConnection` for `sessionId`
- Produces: visual badges (running dot, message-change count, cost label) on each session row

- [ ] **Step 1: Add time-ago helper**

Add a helper function at the top of `SessionPicker.tsx` (after imports):

```typescript
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 2: Add activity badge styles**

In the `styles` useMemo, add to the `item` section:

```typescript
activityRow: {
  alignItems: "center",
  flexDirection: "row",
  gap: spacing.sm,
  marginTop: spacing.xs,
},
activityDot: {
  borderRadius: 999,
  height: 6,
  width: 6,
},
activityLabel: {
  color: colors.textMuted,
  fontSize: 10,
  fontWeight: "500",
},
costBadge: {
  backgroundColor: colors.surfaceElevated,
  borderRadius: 6,
  paddingHorizontal: 6,
  paddingVertical: 2,
},
costText: {
  color: colors.textMuted,
  fontSize: 10,
},
changeBadge: {
  backgroundColor: colors.accentMuted,
  borderRadius: 6,
  paddingHorizontal: 6,
  paddingVertical: 2,
},
changeText: {
  color: colors.accent,
  fontSize: 10,
  fontWeight: "600",
},
```

- [ ] **Step 3: Update the `renderItem` to show activity indicators**

Replace the `renderItem` function (lines ~170–193):

```typescript
renderItem={({ item }) => {
  const isActive = item.id === sessionId;
  const totalChanges =
    (item.summary?.additions ?? 0) + (item.summary?.deletions ?? 0);
  const cost = item.cost ?? 0;
  const minutesAgo = (Date.now() - item.time.updated) / 60_000;
  const isRecent = minutesAgo < 5;

  return (
    <View
      style={[styles.item, isActive ? styles.itemActive : null]}
    >
      <Pressable
        onPress={() => handleSelect(item)}
        style={styles.itemBody}
      >
        <Text style={styles.itemTitle}>
          {item.title || "Untitled session"}
        </Text>
        <View style={styles.activityRow}>
          {isRecent ? (
            <View
              style={[
                styles.activityDot,
                { backgroundColor: colors.success },
              ]}
            />
          ) : null}
          <Text style={styles.activityLabel}>
            {timeAgo(item.time.updated)}
          </Text>
          {totalChanges > 0 ? (
            <View style={styles.changeBadge}>
              <Text style={styles.changeText}>
                +{item.summary?.additions ?? 0}/
                -{item.summary?.deletions ?? 0}
              </Text>
            </View>
          ) : null}
          {cost > 0.001 ? (
            <View style={styles.costBadge}>
              <Text style={styles.costText}>
                ${cost.toFixed(2)}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable onPress={() => handleDelete(item)}>
        <Trash2 color={colors.danger} size={18} />
      </Pressable>
    </View>
  );
}}
```

- [ ] **Step 4: Verify it compiles**

Run: `bunx tsc --noEmit --pretty`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionPicker.tsx
git commit -m "feat: add activity indicators to SessionPicker (recency dot, changes, cost)"
```

---

## Task 6: Session activity indicators in CommandPalette

**Files:**

- Modify: `src/components/CommandPalette.tsx`

**Interfaces:**

- Consumes: `Session` fields for display
- Produces: activity dot and time-ago label for session items in the palette

- [ ] **Step 1: Read the file to find the session rendering section**

Read `src/components/CommandPalette.tsx` and locate where session items are rendered. Look for the section that renders session list items (likely a FlatList or map over sessions).

- [ ] **Step 2: Add the same `timeAgo` helper and activity dot styles**

Mirror the `timeAgo` function and activity dot style from Task 5. Adjust style names/params to match the palette's existing theme tokens.

- [ ] **Step 3: Add activity dot + time-ago to session items**

For each session item in the palette, add:

- A green dot (6px) if `minutesAgo < 5`
- A "5m ago" / "2h ago" label next to the session title

- [ ] **Step 4: Verify it compiles**

Run: `bunx tsc --noEmit --pretty`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandPalette.tsx
git commit -m "feat: add activity indicators to sessions in CommandPalette"
```

---

## Task 7: End-to-end verification

- [ ] **Step 1: Type-check the full project**

Run: `bunx tsc --noEmit --pretty`
Expected: no errors (or only pre-existing unrelated errors)

- [ ] **Step 2: Lint**

Run: `bunx eslint src/utils/session-ranking.ts src/context/ConnectionContext.tsx src/api/client.ts src/components/SessionPicker.tsx src/components/CommandPalette.tsx`
Expected: no new lint errors

- [ ] **Step 3: Manual smoke test scenario**

1. Connect to a host with multiple sessions in different directories
2. Verify SessionPicker shows activity dots, time-ago, change counts, and cost badges
3. Switch projects via ProjectPicker → verify the most relevant session auto-loads
4. Disconnect and reconnect → verify the same directory-scoped session resumes
5. Create a new session → verify it is saved for that directory
6. Delete the active session → verify the next best session is selected

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: address review feedback on auto-detect sessions"
```
