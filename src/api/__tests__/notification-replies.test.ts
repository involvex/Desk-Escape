import { describe, expect, test } from "bun:test";

import {
  DEFAULT_NOTIFICATION_ACTION,
  PERMISSION_ACTIONS,
  actionToResponse,
  classifyPermissionResponse,
  deferReply,
  deferredCountLabel,
  deferredIds,
  isSameNotification,
  pendingReply,
  removeDeferredReply,
  type DeferredReply,
  type NotificationResponseLike,
} from "@/api/notification-replies";

/**
 * Tests for reading a notification response.
 *
 * The defect these pin down was in the *provider*, not here — but it lived in
 * branching like this, ordered like this, and reachable only through a native module
 * nobody had stubbed. So the decision table is tested on its own first: if it is
 * wrong, no amount of render coverage downstream will say why.
 */

/** The data every well-formed permission notification carries. */
const PERMISSION_DATA = {
  type: "permission",
  permissionId: "per_1",
  sessionId: "ses_1",
} as const;

/**
 * A response the way the OS would deliver it, with only the fields named.
 *
 * `data` is read by presence rather than by `??`, so a test can genuinely pass
 * `undefined` and mean *no data at all*. With `??` the default would quietly stand in
 * and the "notification carrying nothing" case would be untestable — which is the
 * case most likely to crash the classifier on a real device.
 */
function response(overrides: {
  action: string;
  data?: Record<string, unknown>;
  title?: string | null;
  body?: string | null;
  identifier?: string;
}): NotificationResponseLike {
  return {
    actionIdentifier: overrides.action,
    notification: {
      request: {
        identifier: overrides.identifier ?? "notif-1",
        content: {
          title: overrides.title ?? "Permission",
          body: overrides.body ?? null,
          data: Object.hasOwn(overrides, "data")
            ? overrides.data
            : { ...PERMISSION_DATA },
        },
      },
    },
  };
}

describe("classifyPermissionResponse", () => {
  test("reads Allow as a one-time approval", () => {
    expect(classifyPermissionResponse(response({ action: "allow" }))).toEqual({
      kind: "action",
      permissionId: "per_1",
      sessionId: "ses_1",
      action: "allow",
      response: "once",
      notificationId: "notif-1",
    });
  });

  test("reads Always Allow as a persistent approval", () => {
    // Not the same as Allow. Sending "once" for this button would grant the least
    // of the three the user could have asked for, while the label promised the most.
    const intent = classifyPermissionResponse(
      response({ action: "always-allow" }),
    );
    expect(intent).toMatchObject({ kind: "action", response: "always" });
  });

  test("reads Reject as a rejection", () => {
    expect(
      classifyPermissionResponse(response({ action: "reject" })),
    ).toMatchObject({ kind: "action", response: "reject" });
  });

  test("every registered action maps to a distinct answer", () => {
    // Guards against two buttons collapsing onto one reply, which would make
    // "Always Allow" and "Allow" indistinguishable to the agent.
    const answers = PERMISSION_ACTIONS.map(actionToResponse);
    expect(new Set(answers).size).toBe(PERMISSION_ACTIONS.length);
  });

  test("a tap with no button is an open, not an action", () => {
    // The user only looked. Nothing to send, so the app shows the prompt.
    expect(
      classifyPermissionResponse(
        response({ action: DEFAULT_NOTIFICATION_ACTION, title: "Run tests?" }),
      ),
    ).toEqual({
      kind: "open",
      permissionId: "per_1",
      sessionId: "ses_1",
      title: "Run tests?",
      body: "",
      notificationId: "notif-1",
    });
  });

  test("an unknown action identifier is treated as an open, not a crash", () => {
    // The OS owns these strings. An unrecognised one must not take the app down, and
    // "open" is the harmless reading: it shows a prompt rather than guessing a reply.
    expect(
      classifyPermissionResponse(response({ action: "SOMETHING_NEW" })).kind,
    ).toBe("open");
  });

  test("an open carries the body's text through for the banner", () => {
    expect(
      classifyPermissionResponse(
        response({ action: DEFAULT_NOTIFICATION_ACTION, body: "bun test" }),
      ),
    ).toMatchObject({ body: "bun test" });
  });

  test("ignores a notification from another feature, naming why", () => {
    expect(
      classifyPermissionResponse(
        response({ action: "allow", data: { type: "build-finished" } }),
      ),
    ).toEqual({ kind: "ignored", reason: "not-a-permission" });
  });

  test("ignores a response carrying no data at all", () => {
    expect(
      classifyPermissionResponse(
        response({ action: "allow", data: undefined }),
      ),
    ).toEqual({ kind: "ignored", reason: "not-a-permission" });
  });

  test("ignores a permission notification with no permission id", () => {
    // Not answered on a guess. There is no request to key on, and replying to
    // something adjacent would be worse than not replying.
    expect(
      classifyPermissionResponse(
        response({
          action: "allow",
          data: { type: "permission", sessionId: "ses_1" },
        }),
      ),
    ).toEqual({ kind: "ignored", reason: "missing-identifiers" });
  });

  test("ignores a permission notification with no session id", () => {
    // `permission.reply` is session-scoped, so without one there is no valid call.
    expect(
      classifyPermissionResponse(
        response({
          action: "allow",
          data: { type: "permission", permissionId: "per_1" },
        }),
      ),
    ).toEqual({ kind: "ignored", reason: "missing-identifiers" });
  });

  test("treats an empty-string id as missing rather than as an id", () => {
    // The check is on the value, not on its presence: `data.permissionId ?? ""` would
    // otherwise pass `""` through as a real id and address a request named nothing.
    expect(
      classifyPermissionResponse(
        response({
          action: "allow",
          data: { type: "permission", permissionId: "", sessionId: "ses_1" },
        }),
      ),
    ).toEqual({ kind: "ignored", reason: "missing-identifiers" });
  });

  test("carries the notification's own id, not the permission's", () => {
    // The two are different identifiers and conflating them breaks deduplication.
    expect(
      classifyPermissionResponse(
        response({ action: "allow", identifier: "n-9" }),
      ),
    ).toMatchObject({ notificationId: "n-9" });
  });
});

describe("isSameNotification", () => {
  test("two readings of one notification are the same", () => {
    // This is the cold-start overlap: the response is read from the last-response slot
    // *and* delivered to the listener, and answering twice would have the server
    // accept one and reject the other.
    const a = response({ action: "allow", identifier: "n-1" });
    const b = response({ action: "allow", identifier: "n-1" });
    expect(isSameNotification(a, b)).toBe(true);
  });

  test("different notification ids are different notifications", () => {
    // Two notifications for one permission are legitimately distinct, and the second
    // one may carry a different button.
    const a = response({ action: "allow", identifier: "n-1" });
    const b = response({ action: "reject", identifier: "n-2" });
    expect(isSameNotification(a, b)).toBe(false);
  });

  test("ignores which button was pressed when deciding sameness", () => {
    // Deliberately, matching the package's `determineNextResponse`: it compares
    // request identifiers only, so the first interaction with a notification wins.
    const a = response({ action: "allow", identifier: "n-1" });
    const b = response({ action: "reject", identifier: "n-1" });
    expect(isSameNotification(a, b)).toBe(true);
  });
});

describe("deferred replies", () => {
  function reply(overrides: Partial<DeferredReply> = {}): DeferredReply {
    return {
      permissionId: "per_1",
      sessionId: "ses_1",
      response: "once",
      action: "allow",
      ...overrides,
    };
  }

  test("holds a reply made with no client to send it", () => {
    expect(deferredIds(deferReply([], reply()))).toEqual(["per_1"]);
  });

  test("returns a new array rather than mutating", () => {
    // React state, and `permission-queue` sets the precedent: these are read by
    // identity in a `useMemo` dependency list.
    const before: DeferredReply[] = [];
    const after = deferReply(before, reply());
    expect(after).not.toBe(before);
    expect(before).toHaveLength(0);
  });

  test("a second tap on one request replaces the first", () => {
    // Two taps cannot happen from one notification — the OS removes it — but a
    // replayed `permission.asked` can post a second notification for the same
    // request. Sending both would have the server accept one and reject the other.
    const once = deferReply([], reply({ response: "once", action: "allow" }));
    const twice = deferReply(
      once,
      reply({ response: "reject", action: "reject" }),
    );

    expect(twice).toHaveLength(1);
    expect(pendingReply(twice, "per_1")).toMatchObject({ response: "reject" });
  });

  test("keeps replies for different requests apart", () => {
    // §4.9 made the pending set a queue precisely because several can be outstanding
    // at once; holding replies must not collapse them.
    const one = deferReply([], reply({ permissionId: "per_1" }));
    const two = deferReply(one, reply({ permissionId: "per_2" }));
    const three = deferReply(two, reply({ permissionId: "per_3" }));

    expect(deferredIds(three)).toEqual(["per_1", "per_2", "per_3"]);
  });

  test("replacing keeps a reply in its original position", () => {
    // Order is tap order. Moving a replaced reply to the end would reorder the sends,
    // and the agent is blocked on the head — answering out of order is a no-op that
    // leaves the turn stuck.
    const list = deferReply(
      deferReply([], reply({ permissionId: "per_1" })),
      reply({ permissionId: "per_2" }),
    );
    const replaced = deferReply(list, reply({ permissionId: "per_1" }));

    expect(deferredIds(replaced)).toEqual(["per_1", "per_2"]);
  });

  test("reports nothing held for a permission that was never tapped", () => {
    expect(pendingReply([], "per_1")).toBeNull();
  });

  test("drops one request's reply and leaves the rest", () => {
    const list = deferReply(
      deferReply([], reply({ permissionId: "per_1" })),
      reply({ permissionId: "per_2" }),
    );

    expect(deferredIds(removeDeferredReply(list, "per_1"))).toEqual(["per_2"]);
  });

  test("removing an unheld reply returns a copy rather than the same array", () => {
    const list = deferReply([], reply());
    const removed = removeDeferredReply(list, "per_nothing");
    expect(removed).toEqual(list);
    expect(removed).not.toBe(list);
  });

  test("removing the reply for a request that succeeded is how it stops being sent", () => {
    const list = deferReply([], reply());
    expect(deferredIds(removeDeferredReply(list, "per_1"))).toEqual([]);
  });
});

describe("deferredCountLabel", () => {
  test("says nothing when nothing is held", () => {
    // `null` rather than "", so the caller renders nothing and leaves no gap — the
    // convention `queueDepthLabel` already uses.
    expect(deferredCountLabel(0)).toBeNull();
  });

  test("is singular for one", () => {
    expect(deferredCountLabel(1)).toBe("1 reply waiting for the connection");
  });

  test("is plural for more, and says how many", () => {
    expect(deferredCountLabel(3)).toBe("3 replies waiting for the connection");
  });

  test("names the cause, so a held reply is not mistaken for a lost one", () => {
    // The phrase is the whole point. "1 pending" would read as a stalled send and
    // invite the user to wait; saying what it is waiting *for* invites them to fix the
    // connection.
    expect(deferredCountLabel(1)).toContain("connection");
  });
});
