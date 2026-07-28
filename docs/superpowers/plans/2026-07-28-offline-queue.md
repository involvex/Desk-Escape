# Offline Queue for Prompts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Queue user prompts in AsyncStorage when offline and auto-send them on reconnection, so messages are never lost during network interruptions.

**Architecture:** A `useOfflineQueue` hook manages a persisted queue of `{ id, text, attachments, timestamp }` entries in AsyncStorage. The send flow in `AgentChat` checks connection status: if connected, sends immediately; if disconnected/reconnecting, enqueues. A `useEffect` in `ConnectionContext` watches for `"connected"` status and flushes the queue in FIFO order. A small `OfflineQueueIndicator` component shows the queue count with a clear button.

**Tech Stack:** React Context, AsyncStorage (`@react-native-async-storage/async-storage`), React Query mutations, Expo SDK 57, TypeScript ~6.0.3

---

## File Map

| File                                       | Action | Purpose                                  |
| ------------------------------------------ | ------ | ---------------------------------------- |
| `src/types/opencode.ts`                    | Modify | Add `QueuedMessage` interface            |
| `src/api/use-offline-queue.ts`             | Create | Queue hook with AsyncStorage persistence |
| `src/context/ConnectionContext.tsx`        | Modify | Integrate queue flush on reconnection    |
| `src/components/AgentChat.tsx`             | Modify | Route through queue when offline         |
| `src/components/OfflineQueueIndicator.tsx` | Create | Queue count badge + clear button         |
| `src/screens/WorkspaceScreen.tsx`          | Modify | Render `OfflineQueueIndicator` in header |

---

## Global Constraints

- Expo SDK 57 (`~57.0.8`), React Native 0.86.0, TypeScript ~6.0.3
- Use `bun` for installs/scripts; run `bun run typecheck` and `bun run lint` after changes
- AsyncStorage key prefix: `@desk-escape/offline-queue`
- Do not git commit unless explicitly requested
- Existing lint issue in `UnifiedDiff.tsx:221` (index as key) — not introduced by this work

---

### Task 1: Define `QueuedMessage` type

**Files:**

- Modify: `src/types/opencode.ts`

**Interfaces:**

- Produces: `QueuedMessage` type used by all subsequent tasks

- [ ] **Step 1: Add `QueuedMessage` to `src/types/opencode.ts`**

Add at the end of the file, before the closing of the module:

```typescript
export interface QueuedMessage {
  id: string;
  text: string;
  attachments: Array<{ path: string; name: string }>;
  timestamp: number;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS (no errors)

- [ ] **Step 3: Verify lint passes**

Run: `bun run lint`
Expected: PASS

---

### Task 2: Create `useOfflineQueue` hook

**Files:**

- Create: `src/api/use-offline-queue.ts`

**Interfaces:**

- Consumes: `QueuedMessage` from `src/types/opencode.ts`
- Produces: `useOfflineQueue` hook returning `{ queue, enqueue, dequeue, clearQueue, flushQueue }`

- [ ] **Step 1: Create `src/api/use-offline-queue.ts`**

```typescript
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueuedMessage } from "@/types/opencode";

const STORAGE_KEY = "@desk-escape/offline-queue";

let nextId = 0;
function generateId(): string {
  nextId += 1;
  return `q-${Date.now()}-${nextId}`;
}

async function loadQueue(): Promise<QueuedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedMessage[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export interface UseOfflineQueueOptions {
  onSend: (
    text: string,
    attachments: QueuedMessage["attachments"],
  ) => Promise<void>;
}

export function useOfflineQueue({ onSend }: UseOfflineQueueOptions) {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);

  // Load queue on mount
  useEffect(() => {
    void loadQueue().then(setQueue);
  }, []);

  const enqueue = useCallback(
    async (text: string, attachments: QueuedMessage["attachments"]) => {
      const entry: QueuedMessage = {
        id: generateId(),
        text,
        attachments,
        timestamp: Date.now(),
      };
      const next = [...queue, entry];
      setQueue(next);
      await saveQueue(next);
    },
    [queue],
  );

  const dequeue = useCallback(
    async (id: string) => {
      const next = queue.filter((m) => m.id !== id);
      setQueue(next);
      await saveQueue(next);
    },
    [queue],
  );

  const clearQueue = useCallback(async () => {
    setQueue([]);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const flushQueue = useCallback(async () => {
    if (queue.length === 0) return;

    // Send messages in FIFO order
    for (const message of queue) {
      try {
        await onSend(message.text, message.attachments);
      } catch {
        // Stop flushing on first failure — remaining messages stay queued
        break;
      }
    }

    // Reload queue from storage to get the remaining messages
    // (those not yet sent or that failed)
    const remaining = await loadQueue();
    setQueue(remaining);
  }, [queue, onSend]);

  return { queue, enqueue, dequeue, clearQueue, flushQueue };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Verify lint passes**

Run: `bun run lint`
Expected: PASS

---

### Task 3: Integrate queue into `ConnectionContext`

**Files:**

- Modify: `src/context/ConnectionContext.tsx`

**Interfaces:**

- Consumes: `useOfflineQueue` from Task 2
- Produces: `queuedMessages` and `clearQueuedMessages` added to context value; `flushQueue` called on reconnection

- [ ] **Step 1: Add imports and extend context value type**

In `src/context/ConnectionContext.tsx`:

1. Add import at top:

```typescript
import { useOfflineQueue } from "@/api/use-offline-queue";
import type { QueuedMessage } from "@/types/opencode";
```

2. Add to the `ConnectionContextValue` interface:

```typescript
queuedMessages: QueuedMessage[];
enqueueMessage: (text: string, attachments: QueuedMessage["attachments"]) => Promise<void>;
clearQueuedMessages: () => Promise<void>;
```

- [ ] **Step 2: Initialize queue hook inside `ConnectionProvider`**

Inside the `ConnectionProvider` function body, after the existing state declarations, add:

```typescript
// The onSend callback uses the current client/sessionId from closure
const sendMessageDirectly = useCallback(
  async (text: string, attachments: QueuedMessage["attachments"]) => {
    if (!client || !sessionId) throw new Error("No active session.");
    await sendPromptDirectly(
      client,
      sessionId,
      activeDirectory,
      text,
      attachments,
    );
  },
  [client, sessionId, activeDirectory],
);

const { queue, enqueue, clearQueue, flushQueue } = useOfflineQueue({
  onSend: sendMessageDirectly,
});
```

- [ ] **Step 3: Create `sendPromptDirectly` helper**

Add this helper function (outside the provider, near the top of the file or in a separate utility):

```typescript
async function sendPromptDirectly(
  client: OpencodeClient,
  sessionId: string,
  directory: string | null,
  text: string,
  attachments: Array<{ path: string; name: string }>,
): Promise<void> {
  const attachmentParts = attachments.map((a) => ({
    type: "text" as const,
    text: `Context attachment: ${a.path}`,
  }));

  await client.session.prompt({
    path: { id: sessionId },
    ...(directory ? { query: { directory } } : {}),
    body: {
      parts: [...attachmentParts, { type: "text", text }],
    },
  });
}
```

- [ ] **Step 4: Add queue flush on reconnection**

Add a `useEffect` that watches `status` and flushes when it becomes `"connected"`:

```typescript
// Flush offline queue when reconnection succeeds
useEffect(() => {
  if (status === "connected" && queue.length > 0) {
    void flushQueue();
  }
}, [status, queue.length, flushQueue]);
```

- [ ] **Step 5: Expose queue in context value**

Add to the `value` object passed to `ConnectionContext.Provider`:

```typescript
queuedMessages: queue,
enqueueMessage: enqueue,
clearQueuedMessages: clearQueue,
```

- [ ] **Step 6: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 7: Verify lint passes**

Run: `bun run lint`
Expected: PASS

---

### Task 4: Route sends through queue in `AgentChat`

**Files:**

- Modify: `src/components/AgentChat.tsx`

**Interfaces:**

- Consumes: `enqueueMessage`, `queuedMessages` from `ConnectionContext`
- Produces: Modified `submitText` that queues when offline

- [ ] **Step 1: Consume new context values**

In `AgentChat.tsx`, add `enqueueMessage` and `queuedMessages` from `useConnection()`:

```typescript
const { enqueueMessage, queuedMessages } = useConnection();
```

- [ ] **Step 2: Modify `submitText` to queue when offline**

Replace the `submitText` function body. The key change: when `status !== "connected"`, enqueue instead of sending directly.

```typescript
const submitText = useCallback(
  (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sendPrompt.isPending || executeCommand.isPending) {
      return;
    }

    setDraft("");
    Keyboard.dismiss();

    // Queue if not connected
    if (status !== "connected") {
      const attachmentPayload = contextAttachments.map((a) => ({
        path: a.path,
        name: a.name,
      }));
      void enqueueMessage(trimmed, attachmentPayload);
      clearAttachments();
      return;
    }

    // Connected — send directly
    if (trimmed.startsWith("/")) {
      const { name, args } = parseSlashInput(trimmed);
      void executeCommand.mutateAsync({ command: name, arguments: args });
    } else {
      void sendPrompt.mutateAsync(trimmed);
    }
  },
  [
    sendPrompt.isPending,
    executeCommand.isPending,
    status,
    enqueueMessage,
    contextAttachments,
    clearAttachments,
    sendPrompt,
    executeCommand,
  ],
);
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Verify lint passes**

Run: `bun run lint`
Expected: PASS

---

### Task 5: Create `OfflineQueueIndicator` component

**Files:**

- Create: `src/components/OfflineQueueIndicator.tsx`

**Interfaces:**

- Consumes: `queuedMessages`, `clearQueuedMessages` from `ConnectionContext`
- Produces: `OfflineQueueIndicator` component (renders badge + clear button when queue is non-empty)

- [ ] **Step 1: Create `src/components/OfflineQueueIndicator.tsx`**

```typescript
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";

export function OfflineQueueIndicator() {
  const { queuedMessages, clearQueuedMessages } = useConnection();
  const { colors } = useTheme();

  if (queuedMessages.length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.warning }]}>
      <Text style={[styles.text, { color: colors.background }]}>
        {queuedMessages.length} queued
      </Text>
      <TouchableOpacity
        onPress={() => void clearQueuedMessages()}
        accessibilityLabel="Clear queued messages"
        accessibilityRole="button"
      >
        <Text style={[styles.clear, { color: colors.background }]}>Clear</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
  },
  clear: {
    fontSize: 13,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Verify lint passes**

Run: `bun run lint`
Expected: PASS

---

### Task 6: Render indicator in `WorkspaceScreen`

**Files:**

- Modify: `src/screens/WorkspaceScreen.tsx`

**Interfaces:**

- Consumes: `OfflineQueueIndicator` from Task 5
- Produces: Indicator rendered below header when queue is non-empty

- [ ] **Step 1: Import `OfflineQueueIndicator`**

Add to imports in `WorkspaceScreen.tsx`:

```typescript
import { OfflineQueueIndicator } from "@/components/OfflineQueueIndicator";
```

- [ ] **Step 2: Render `OfflineQueueIndicator`**

Place it right after the header `View` closing tag and before `PanelTabs`:

```tsx
{/* Header end */}
</View>

<OfflineQueueIndicator />

<PanelTabs ... />
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Verify lint passes**

Run: `bun run lint`
Expected: PASS

---

### Task 7: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run full lint**

Run: `bun run lint`
Expected: PASS (only pre-existing `UnifiedDiff.tsx:221` warning)

- [ ] **Step 3: Run format**

Run: `bun run format`
Expected: All files unchanged or reformatted consistently

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: offline message queue with auto-send on reconnection

- AsyncStorage-persisted queue survives app restarts
- Messages queued when disconnected/reconnecting, auto-flushed on reconnect
- OfflineQueueIndicator shows count with clear button
- Send flow checks connection status before attempting API call"
```
