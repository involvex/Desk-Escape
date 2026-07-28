# Fix Duplicate SSE Subscriptions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate SSE connections by creating a shared event bus that opens one connection and broadcasts events to multiple consumers.

**Architecture:** A new `EventBus` class manages a single SSE connection to `/event` and maintains a registry of listener callbacks. `ConnectionContext` owns the bus instance — starting it when connected, stopping on disconnect. `useSessionMessageStream` and `PermissionProvider` register listeners on the bus instead of opening independent connections.

**Tech Stack:** TypeScript ~6.0.3, React Context, `@opencode-ai/sdk/client`, Expo SDK 57

---

## File Map

| File                                | Action | Purpose                                                               |
| ----------------------------------- | ------ | --------------------------------------------------------------------- |
| `src/api/event-bus.ts`              | Create | `EventBus` class: single SSE connection, listener registry            |
| `src/context/ConnectionContext.tsx` | Modify | Own and lifecycle-manage the `EventBus` instance                      |
| `src/api/hooks.ts`                  | Modify | `useSessionMessageStream` listens via bus instead of direct subscribe |
| `src/context/PermissionContext.tsx` | Modify | `PermissionProvider` listens via bus instead of direct subscribe      |

---

## Global Constraints

- Expo SDK 57 (`~57.0.8`), React Native 0.86.0, TypeScript ~6.0.3
- Use `bun` for installs/scripts; run `bun run typecheck` and `bun run lint` after changes
- Do not git commit unless explicitly requested
- Existing lint issue in `UnifiedDiff.tsx:221` (index as key) — not introduced by this work

---

### Task 1: Create `EventBus` class

**Files:**

- Create: `src/api/event-bus.ts`

**Interfaces:**

- Consumes: `OpencodeClient` from `@/api/client`, `EventSubscribeResponse` from SDK
- Produces: `EventBus` class with `start(client)`, `stop()`, `onEvent(callback)`, `offEvent(callback)`

- [ ] **Step 1: Create `src/api/event-bus.ts`**

```typescript
import type { OpencodeClient } from "@/api/client";

type EventCallback = (event: unknown) => void;

export class EventBus {
  private abortController: AbortController | null = null;
  private listeners: Set<EventCallback> = new Set();
  private active = false;

  onEvent(callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  offEvent(callback: EventCallback): void {
    this.listeners.delete(callback);
  }

  async start(client: OpencodeClient): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.abortController = new AbortController();

    try {
      const subscription = await client.event.subscribe({
        signal: this.abortController.signal,
      });

      for await (const event of subscription.stream) {
        if (!this.active) break;
        for (const listener of this.listeners) {
          listener(event);
        }
      }
    } catch {
      // SSE may be unavailable on some remote hosts
    } finally {
      this.active = false;
    }
  }

  stop(): void {
    this.active = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  get isRunning(): boolean {
    return this.active;
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Verify lint passes**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/api/event-bus.ts
git commit -m "feat: create EventBus with single SSE connection and listener registry"
```

---

### Task 2: Integrate `EventBus` into `ConnectionContext`

**Files:**

- Modify: `src/context/ConnectionContext.tsx`

**Interfaces:**

- Consumes: `EventBus` from Task 1
- Produces: `eventBus` exposed via context; bus started on connect, stopped on disconnect

- [ ] **Step 1: Add import**

Add to the imports at the top of `src/context/ConnectionContext.tsx`:

```typescript
import { EventBus } from "@/api/event-bus";
```

- [ ] **Step 2: Create bus instance and expose in context**

Inside the `ConnectionProvider` function body, after existing state declarations:

```typescript
const eventBusRef = useRef(new EventBus());
```

Add to the `ConnectionContextValue` interface:

```typescript
eventBus: EventBus;
```

Add to the memoized `value` object:

```typescript
eventBus: eventBusRef.current,
```

- [ ] **Step 3: Start bus on connect, stop on disconnect**

In the `connect()` function, after setting `status` to `"connected"` and creating the client, start the bus:

```typescript
void eventBusRef.current.start(client);
```

In the `disconnect()` function, stop the bus:

```typescript
eventBusRef.current.stop();
```

- [ ] **Step 4: Stop bus on unmount**

Add a `useEffect` cleanup:

```typescript
useEffect(() => {
  return () => {
    eventBusRef.current.stop();
  };
}, []);
```

- [ ] **Step 5: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 6: Verify lint passes**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/context/ConnectionContext.tsx
git commit -m "feat: integrate EventBus into ConnectionContext lifecycle"
```

---

### Task 3: Migrate `useSessionMessageStream` to use `EventBus`

**Files:**

- Modify: `src/api/hooks.ts`

**Interfaces:**

- Consumes: `eventBus` from `ConnectionContext`
- Produces: `useSessionMessageStream` registers listener on bus instead of calling `client.event.subscribe()`

- [ ] **Step 1: Modify `useSessionMessageStream`**

Replace the current implementation that calls `client.event.subscribe()` with a bus listener. The hook signature stays the same — it still takes `sessionId` and returns nothing (it updates React Query cache as a side effect).

Find the `useSessionMessageStream` function in `src/api/hooks.ts` and replace its body:

```typescript
export function useSessionMessageStream(sessionId: string | null) {
  const { client, eventBus, setAgentActive } = useConnection();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!client || !sessionId || !eventBus) return;

    const unsubscribe = eventBus.onEvent((event: unknown) => {
      // Check agent busy state
      const busy = isAgentBusyEvent(event);
      if (busy !== null) {
        setAgentActive(busy);
        return;
      }

      // Check if we need a full refetch
      if (shouldRefetchMessages(event)) {
        void fetchSessionMessages(client, sessionId).then((messages) => {
          queryClient.setQueryData(sessionMessagesKey(sessionId), messages);
        });
        return;
      }

      // Incremental cache update
      const base = queryClient.getQueryData<MessageWithParts[]>(
        sessionMessagesKey(sessionId),
      );
      if (!base) return;

      const updated = applyStreamEvent(base, event, sessionId);
      if (updated) {
        queryClient.setQueryData(sessionMessagesKey(sessionId), updated);
      }
    });

    return unsubscribe;
  }, [client, eventBus, sessionId, queryClient, setAgentActive]);
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Verify lint passes**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/api/hooks.ts
git commit -m "feat: migrate useSessionMessageStream to use shared EventBus"
```

---

### Task 4: Migrate `PermissionProvider` to use `EventBus`

**Files:**

- Modify: `src/context/PermissionContext.tsx`

**Interfaces:**

- Consumes: `eventBus` from `ConnectionContext`
- Produces: `PermissionProvider` registers listener on bus instead of calling `client.event.subscribe()`

- [ ] **Step 1: Modify `PermissionProvider`**

Replace the SSE subscription in `PermissionProvider` with a bus listener. Find the `useEffect` that calls `client.event.subscribe()` and replace it:

```typescript
useEffect(() => {
  if (!client || !eventBus) return;

  const unsubscribe = eventBus.onEvent((event: unknown) => {
    const permissionData = parsePermissionEvent(event);
    if (permissionData) {
      handlePermission(permissionData);
    }
  });

  return unsubscribe;
}, [client, eventBus, handlePermission]);
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Verify lint passes**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/context/PermissionContext.tsx
git commit -m "feat: migrate PermissionProvider to use shared EventBus"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run full lint**

Run: `bun run lint`
Expected: PASS (only pre-existing `UnifiedDiff.tsx:221` warning)

- [ ] **Step 3: Run format**

Run: `bun run format`
Expected: All files unchanged or reformatted consistently

- [ ] **Step 4: Verify no duplicate SSE connections**

Grep the codebase for `event.subscribe` — it should appear only in `src/api/event-bus.ts`:

Run: `rg "event\.subscribe" src/`
Expected: Only match is in `src/api/event-bus.ts`

- [ ] **Step 5: Commit any formatting changes**

```bash
git add -A && git commit -m "chore: format after SSE dedup refactor"
```
