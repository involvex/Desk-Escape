import { describe, expect, test } from "bun:test";

import {
  contains,
  dismissHead,
  enqueue,
  head,
  mergeRehydrated,
  queueDepthLabel,
  removeById,
  shouldNotify,
} from "@/api/permission-queue";
import type { PendingPermission } from "@/api/permissions";

/**
 * Tests for the pending-permission queue.
 *
 * Every case here is a way the turn used to hang: a request replaced by a newer
 * one, a reply clearing the wrong entry, rehydration dropping all but the first.
 * None of them throw, so they are only catchable by asserting the algebra
 * directly.
 */

function request(id: string, overrides: Partial<PendingPermission> = {}) {
  return {
    id,
    sessionId: "ses_1",
    action: "bash",
    resources: [],
    message: "",
    title: "Run a shell command",
    description: "",
    receivedAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  } as PendingPermission;
}

const ids = (queue: readonly PendingPermission[]) => queue.map((r) => r.id);

// ---------------------------------------------------------------------------
// head
// ---------------------------------------------------------------------------

describe("head", () => {
  test("is the first request", () => {
    expect(head([request("a"), request("b")])?.id).toBe("a");
  });

  test("is null when empty", () => {
    expect(head([])).toBeNull();
  });

  test("is the only request when there is one", () => {
    expect(head([request("a")])?.id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe("enqueue", () => {
  test("appends behind the existing request", () => {
    // The whole point: the agent is blocked on the head, so a new request goes
    // behind it rather than replacing it.
    const queue = enqueue([request("a")], request("b"));
    expect(ids(queue)).toEqual(["a", "b"]);
  });

  test("appends to an empty queue", () => {
    expect(ids(enqueue([], request("a")))).toEqual(["a"]);
  });

  test("preserves arrival order across many appends", () => {
    let queue: PendingPermission[] = [];
    for (const id of ["a", "b", "c", "d"]) {
      queue = enqueue(queue, request(id));
    }
    expect(ids(queue)).toEqual(["a", "b", "c", "d"]);
  });

  test("ignores a request already in the queue", () => {
    // A reconnect replays `permission.asked` for anything still outstanding. A
    // duplicate would make the user answer the same prompt twice, the second time
    // to a server that already has the answer.
    const once = enqueue([request("a")], request("b"));
    expect(ids(enqueue(once, request("a")))).toEqual(["a", "b"]);
  });

  test("does not mutate the input", () => {
    const original = [request("a")];
    enqueue(original, request("b"));
    expect(ids(original)).toEqual(["a"]);
  });

  test("does not add a duplicate when re-enqueued at the head", () => {
    const queue = enqueue([request("a")], request("a"));
    expect(ids(queue)).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// removeById
// ---------------------------------------------------------------------------

describe("removeById", () => {
  test("removes the head", () => {
    expect(ids(removeById([request("a"), request("b")], "a"))).toEqual(["b"]);
  });

  test("removes from the middle", () => {
    // The replied event can close any request, not just the one on screen.
    expect(
      ids(removeById([request("a"), request("b"), request("c")], "b")),
    ).toEqual(["a", "c"]);
  });

  test("removes the tail", () => {
    expect(ids(removeById([request("a"), request("b")], "b"))).toEqual(["a"]);
  });

  test("leaves order intact after a middle removal", () => {
    const queue = removeById(
      [request("a"), request("b"), request("c"), request("d")],
      "c",
    );
    expect(ids(queue)).toEqual(["a", "b", "d"]);
  });

  test("is a no-op for an unknown id", () => {
    expect(ids(removeById([request("a")], "zzz"))).toEqual(["a"]);
  });

  test("is a no-op on an empty queue", () => {
    expect(removeById([], "a")).toEqual([]);
  });

  test("does not mutate the input", () => {
    const original = [request("a"), request("b")];
    removeById(original, "a");
    expect(ids(original)).toEqual(["a", "b"]);
  });

  test("removes only the matching id when ids repeat across sessions", () => {
    // Two sessions can each have a request; only the named one closes.
    const queue = [
      request("p1", { sessionId: "ses_1" }),
      request("p2", { sessionId: "ses_2" }),
    ];
    expect(removeById(queue, "p1")[0]?.sessionId).toBe("ses_2");
  });
});

// ---------------------------------------------------------------------------
// dismissHead
// ---------------------------------------------------------------------------

describe("dismissHead", () => {
  test("advances to the next request", () => {
    expect(ids(dismissHead([request("a"), request("b")]))).toEqual(["b"]);
  });

  test("empties a single-request queue", () => {
    expect(dismissHead([request("a")])).toEqual([]);
  });

  test("keeps the rest in order", () => {
    expect(
      ids(dismissHead([request("a"), request("b"), request("c")])),
    ).toEqual(["b", "c"]);
  });

  test("is a no-op on an empty queue", () => {
    expect(dismissHead([])).toEqual([]);
  });

  test("does not mutate the input", () => {
    const original = [request("a"), request("b")];
    dismissHead(original);
    expect(ids(original)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// mergeRehydrated
// ---------------------------------------------------------------------------

describe("mergeRehydrated", () => {
  test("adopts every request, not just the first", () => {
    // The bug: `requests[0]` only. Two outstanding requests meant the second was
    // unreachable until the next reconnect.
    expect(
      ids(mergeRehydrated([], [request("a"), request("b"), request("c")])),
    ).toEqual(["a", "b", "c"]);
  });

  test("appends behind requests already held locally", () => {
    expect(
      ids(mergeRehydrated([request("a")], [request("b"), request("c")])),
    ).toEqual(["a", "b", "c"]);
  });

  test("keeps the local copy of a request the server also reports", () => {
    // The local copy carries `receivedAt` and the original prompt text; the list
    // endpoint returns the bare request.
    const local = request("a", { receivedAt: "2026-10-03T10:00:00.000Z" });
    const merged = mergeRehydrated([local], [request("a")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.receivedAt).toBe("2026-10-03T10:00:00.000Z");
  });

  test("deduplicates within the incoming list itself", () => {
    expect(
      ids(mergeRehydrated([], [request("a"), request("a"), request("b")])),
    ).toEqual(["a", "b"]);
  });

  test("is a no-op for an empty server list", () => {
    expect(ids(mergeRehydrated([request("a")], []))).toEqual(["a"]);
    expect(mergeRehydrated([], [])).toEqual([]);
  });

  test("preserves server order for unseen entries", () => {
    expect(
      ids(mergeRehydrated([], [request("c"), request("a"), request("b")])),
    ).toEqual(["c", "a", "b"]);
  });

  test("does not mutate either input", () => {
    const local = [request("a")];
    const remote = [request("b")];
    mergeRehydrated(local, remote);
    expect(ids(local)).toEqual(["a"]);
    expect(ids(remote)).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------------------
// contains / shouldNotify
// ---------------------------------------------------------------------------

describe("contains", () => {
  test("finds a request anywhere in the queue", () => {
    const queue = [request("a"), request("b"), request("c")];
    expect(contains(queue, "a")).toBe(true);
    expect(contains(queue, "c")).toBe(true);
    expect(contains(queue, "zzz")).toBe(false);
  });

  test("is false for an empty queue", () => {
    expect(contains([], "a")).toBe(false);
  });
});

describe("shouldNotify", () => {
  test("notifies for a request never announced", () => {
    expect(shouldNotify(new Set(), "a")).toBe(true);
    expect(shouldNotify(new Set(["z"]), "a")).toBe(true);
  });

  test("does not re-notify for an already-announced request", () => {
    // Without this, a reconnect would re-notify for every outstanding request.
    expect(shouldNotify(new Set(["a", "b"]), "b")).toBe(false);
  });

  test("treats ids independently", () => {
    const announced = new Set(["a"]);
    expect(shouldNotify(announced, "a")).toBe(false);
    expect(shouldNotify(announced, "b")).toBe(true);
  });
});

describe("queueDepthLabel", () => {
  test("is null for a single request", () => {
    // Nothing to indicate: there is no queue the user cannot see.
    expect(queueDepthLabel(1)).toBeNull();
    expect(queueDepthLabel(0)).toBeNull();
  });

  test("reports position once more than one is waiting", () => {
    expect(queueDepthLabel(2)).toBe("1 of 2");
    expect(queueDepthLabel(3)).toBe("1 of 3");
  });

  test("is null for a negative count", () => {
    // Defensive: a bad count should not render a nonsense indicator.
    expect(queueDepthLabel(-1)).toBeNull();
  });

  test("tracks the head as requests are answered", () => {
    // The label must move as the queue drains, or it looks frozen.
    let queue: PendingPermission[] = [];
    for (const id of ["a", "b", "c"]) {
      queue = enqueue(queue, request(id));
    }
    expect(queueDepthLabel(queue.length)).toBe("1 of 3");
    queue = removeById(queue, "a");
    expect(queueDepthLabel(queue.length)).toBe("1 of 2");
    queue = removeById(queue, "b");
    expect(queueDepthLabel(queue.length)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The scenario the single slot could not represent
// ---------------------------------------------------------------------------

describe("two outstanding requests", () => {
  test("survives a second request arriving while the first is unanswered", () => {
    let queue = enqueue([], request("p1"));
    queue = enqueue(queue, request("p2"));

    // Both are answerable; the banner shows the first.
    expect(head(queue)?.id).toBe("p1");
    expect(ids(queue)).toEqual(["p1", "p2"]);

    // Answering the head advances rather than clearing.
    queue = removeById(queue, "p1");
    expect(head(queue)?.id).toBe("p2");
    expect(ids(queue)).toEqual(["p2"]);
  });

  test("a reply for the tail does not disturb the head", () => {
    // Another client, or the notification action, answers p2 while p1 is on
    // screen. Clearing "the pending slot" would have thrown away p1.
    const queue = [request("p1"), request("p2")];
    expect(head(removeById(queue, "p2"))?.id).toBe("p1");
  });

  test("dismissing the head reveals the next without answering it", () => {
    // Dismiss is "not now": the request stays pending on the server and returns
    // on the next rehydration, exactly as before.
    const queue = dismissHead([request("p1"), request("p2")]);
    expect(head(queue)?.id).toBe("p2");
  });

  test("a reply arriving mid-flight clears only the answered request", () => {
    // The user taps "Allow" on p1; before the request resolves, p2 arrives. The
    // completion handler keys on p1's id, so p2 survives.
    const beforeReply = [request("p1")];
    const arrived = enqueue(beforeReply, request("p2"));
    const afterReply = removeById(arrived, "p1");
    expect(ids(afterReply)).toEqual(["p2"]);
  });
});
