import type { PendingPermission } from "@/api/permissions";

/**
 * The pending-permission queue.
 *
 * ## Why a queue and not a single slot
 *
 * The agent blocks on each permission request in the order it asked them, and the
 * user has to answer every one. Holding only the newest meant a second request
 * silently replaced the first: the user answered B, and A — which the agent was
 * still waiting on — became unreachable. Rehydration compounded it by adopting
 * `requests[0]` and discarding the rest. Both failures present as the same thing,
 * a turn that hangs forever with no visible cause.
 *
 * ## Ordering is load-bearing
 *
 * FIFO, always. The requests cannot be reordered or batched: the agent is blocked
 * on the head, so answering request 3 before request 1 is not a shortcut, it is a
 * no-op that leaves the turn stuck.
 *
 * ## Identity is the request id
 *
 * Every transition keys on `id`, never on position. A reply can land while a new
 * request is arriving, so "clear the current slot" would clear the wrong thing —
 * the same class of bug as clearing a single slot in the first place.
 *
 * Kept pure so the algebra can be tested without React, React Native, or a server.
 */

/** The request at the head of the queue, or `null` when it is empty. */
export function head(
  queue: readonly PendingPermission[],
): PendingPermission | null {
  return queue[0] ?? null;
}

/** `true` when the queue holds this request, wherever it sits. */
export function contains(
  queue: readonly PendingPermission[],
  id: string,
): boolean {
  return queue.some((request) => request.id === id);
}

/**
 * Append a request.
 *
 * Re-adding a request already in the queue is a no-op rather than a duplicate.
 * A reconnect replays `permission.asked` for anything still outstanding, and a
 * duplicated entry would make the user answer the same prompt twice — the second
 * time to a server that has already been told the answer.
 */
export function enqueue(
  queue: readonly PendingPermission[],
  request: PendingPermission,
): PendingPermission[] {
  if (contains(queue, request.id)) {
    return [...queue];
  }
  return [...queue, request];
}

/** Remove one request by id, wherever it sits. Returns the same array if absent. */
export function removeById(
  queue: readonly PendingPermission[],
  id: string,
): PendingPermission[] {
  if (!contains(queue, id)) {
    return [...queue];
  }
  return queue.filter((request) => request.id !== id);
}

/** Remove the request the banner is showing, advancing to the next one. */
export function dismissHead(
  queue: readonly PendingPermission[],
): PendingPermission[] {
  const current = head(queue);
  return current ? removeById(queue, current.id) : [];
}

/**
 * Merge a server rehydration into the queue.
 *
 * All of it, not just the first entry. Anything already held wins on conflict,
 * because a locally-received request carries the `receivedAt` stamp and the
 * original prompt text, whereas the list endpoint returns the bare request.
 * Server order is preserved for entries we have not seen, and the whole incoming
 * list is appended in order rather than interleaved — reordering is not safe, and
 * a stable append is the closest thing to the server's own sequence.
 */
export function mergeRehydrated(
  queue: readonly PendingPermission[],
  incoming: readonly PendingPermission[],
): PendingPermission[] {
  const seen = new Set(queue.map((request) => request.id));
  const additions = incoming.filter((request) => {
    if (seen.has(request.id)) {
      return false;
    }
    seen.add(request.id);
    return true;
  });

  return additions.length === 0 ? [...queue] : [...queue, ...additions];
}

/**
 * Whether the user should be told about a request yet.
 *
 * Notification bookkeeping is keyed on the set of ids already announced, held
 * separately from the queue. Whether to send a push is decided inside the event
 * handler — where a ref is safe to write — and the queue itself is the
 * authority on what still needs answering.
 */
export function shouldNotify(
  announcedIds: ReadonlySet<string>,
  id: string,
): boolean {
  return !announcedIds.has(id);
}

/**
 * The banner's position indicator, or `null` when one request is showing.
 *
 * Without this the queue is invisible: answering the head would make a different
 * prompt appear with nothing to say why, which reads as a glitch rather than as
 * "there were three of these". `null` rather than an empty string so the caller
 * can render nothing and leave no gap.
 */
export function queueDepthLabel(count: number): string | null {
  if (count <= 1) {
    return null;
  }
  return `1 of ${count}`;
}
