import { beforeEach, describe, expect, test } from "bun:test";
import { Text } from "react-native";

import {
  PermissionProvider,
  usePermission,
} from "@/context/permission-provider";
import {
  apiStub,
  defaultClient,
  setPendingPermissions,
  setPermissionReply,
} from "@/testing/context-holds";
import {
  DEFAULT_NOTIFICATION_ACTION,
  deliverResponse,
  pendingColdStartResponse,
  responseListenerCount,
  scheduledNotifications,
  type ResponseParts,
} from "@/testing/notifications-stub";
import { setAppState } from "@/testing/react-native-stub";
import {
  renderWithProviders,
  type MountedTree,
  type RenderOptions,
  type RenderResult,
} from "@/testing/harness";
import { emitEvent } from "@/testing/event-bus-stub";

/**
 * Tests for the real `PermissionProvider`.
 *
 * ## Why this file exists at all
 *
 * The provider had no tests, and the reason was a single native import:
 * `expo-notifications` reaches `expo-modules-core`, which reads `__DEV__` — a global
 * only Metro defines — so the module could not be loaded under `bun test` at all.
 * `setup.ts` blamed the event-bus subscription instead, which was not the blocker, and
 * the mock it installed made the omission look like a considered decision.
 *
 * Everything the provider owns was therefore untested: the SSE subscription, the
 * rehydration on mount, the auto-approve path, the AppState gate on posting a
 * notification, and the notification listener. The last contained a real defect — a tap
 * on "Allow" with no client was dropped, *and* the request was skipped for the in-app
 * banner too, so it became invisible everywhere at once.
 */

/**
 * A `permission.asked` event, as the SSE stream delivers it.
 *
 * The payload is under `data`, and the reply event keys on `requestID` — neither is
 * guessed at, both come from `parsePermissionEvent` and `parsePermissionRepliedEvent`.
 * A fixture that invented its own envelope would test the fixture.
 */
function askedEvent(overrides: {
  id: string;
  sessionId?: string;
  action?: string;
  message?: string;
}): Record<string, unknown> {
  return {
    type: "permission.asked",
    data: {
      id: overrides.id,
      sessionID: overrides.sessionId ?? "ses_test",
      action: overrides.action ?? "bash",
      message: overrides.message ?? "Run the tests?",
      resources: [],
    },
  };
}

/** A `permission.replied` event, naming the request it closes. */
function repliedEvent(requestId: string): Record<string, unknown> {
  return {
    type: "permission.replied",
    data: { requestID: requestId, sessionID: "ses_test" },
  };
}

/** What `permission.reply` was called with, or `undefined`. */
function replyArgs(index = 0): Record<string, unknown> | undefined {
  return apiStub().permissionReply.calls[index] as
    Record<string, unknown> | undefined;
}

/**
 * Tap a notification, inside `act`.
 *
 * Wrapped because the tap is the outside world reaching into the tree: it produces
 * `setState` calls, and outside `act` those are applied but not flushed — so the next
 * assertion reads stale state and the failure looks like a product bug.
 */
function tap(result: MountedTree, parts: ResponseParts): Promise<void> {
  return result.act(() => void deliverResponse(parts));
}

/** Deliver an SSE event, inside `act`, for the same reason as {@link tap}. */
function emit(result: MountedTree, event: unknown): Promise<void> {
  return result.act(() => void emitEvent(event));
}

/**
 * Move the app to the background, inside `act`.
 *
 * Also inside `act` because it is a stimulus, not a plain assignment: the stub fires
 * the change event, the provider's `AppState` subscription calls `setState`, and an
 * unflushed update means the SSE handler still closes over the *previous* state. The
 * symptom would be a permission notification not being posted because the app looked
 * foreground — a plausible-looking product bug caused entirely by the test.
 */
function background(result: MountedTree): Promise<void> {
  return result.act(() => setAppState("background"));
}

/**
 * Mount the provider with a probe reporting what `usePermission` sees.
 *
 * The probe is the only way to observe the queue: `@/context/PermissionContext` is the
 * mocked seam, so importing `usePermission` from *there* would give the fake. This
 * file imports the real one from the provider module.
 */
function render(options?: RenderOptions) {
  function Probe() {
    const value = usePermission();
    return (
      <>
        <Text>{`pending:${value.pending?.id ?? "none"}`}</Text>
        <Text>{`count:${value.pendingCount}`}</Text>
        <Text>{`deferred:${value.deferredCount}`}</Text>
        <Text>{`reason:${value.deferredReason ?? "none"}`}</Text>
        <Text>{`error:${value.error ?? "none"}`}</Text>
      </>
    );
  }

  return renderWithProviders(
    <PermissionProvider>
      <Probe />
    </PermissionProvider>,
    options,
  );
}

/**
 * Mount and let the mount-time effects settle.
 *
 * Returns `RenderResult` rather than `MountedTree` because several tests below
 * re-render against a different connection — which is the transition the whole
 * deferral mechanism turns on, and it cannot be expressed by mounting twice.
 */
async function mounted(options?: RenderOptions): Promise<RenderResult> {
  const result = await render(options);
  await result.flush();
  return result;
}

/**
 * A working fake client, for putting one back after a test has removed it.
 *
 * From the context holds rather than rebuilt here, so a test that swaps the client out
 * and a test that swaps it back use the same object shape. A second fake would drift,
 * and the drift would surface as a mystery failure in whichever test held it.
 */
function apiStubClient(): unknown {
  return defaultClient();
}

beforeEach(() => {
  // Adopt nothing and let every reply succeed, so each test opts in to the branch it
  // is about. The defaults being quiet is what keeps an unrelated failure from looking
  // like a queue problem.
  setPendingPermissions(async () => ({ data: [] }));
  setPermissionReply(async () => undefined);
});

describe("a tap with no client", () => {
  test("sends the reply when a client is ready", async () => {
    // The ordinary path, asserted first so a failure below is unambiguous.
    const result = await mounted();
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(replyArgs()).toMatchObject({
      sessionID: "ses_1",
      requestID: "per_1",
      decision: "once",
    });
    result.unmount();
  });

  test("holds the reply instead of dropping it", async () => {
    // The core of the fix. Before it, `if (v2Client) { reply(...) }` meant the tap
    // vanished: the OS had already dismissed the notification, so nothing anywhere
    // recorded that the user had answered.
    const result = await mounted({ connection: { client: null } });

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(0);
    expect(result.text()).toContain("deferred:1");
    result.unmount();
  });

  test("still shows the request in the banner", async () => {
    // The half of the bug that is worse than a lost reply. The old code returned as
    // soon as it saw an action, so a tap while disconnected left the request in *no*
    // queue — unanswered and invisible, back only on a reconnect.
    const result = await mounted({ connection: { client: null } });

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(result.text()).toContain("pending:per_1");
    result.unmount();
  });

  test("holds a reply whose immediate send failed, and says why", async () => {
    // Distinct from the flush path, and the two behave differently on purpose. Here
    // the client *was* ready and the send failed outright, so the reply has to be held
    // for a retry rather than dropped — and the request is in the banner, so the user
    // can also just answer it in the app.
    setPermissionReply(async () => {
      throw new Error("server said no");
    });

    const result = await mounted();

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(result.text()).toContain("deferred:1");
    expect(result.text()).toContain("server said no");
    // Still reachable, because a rejected reply is not an answered one.
    expect(result.text()).toContain("pending:per_1");
    result.unmount();
  });

  test("reports nothing when an immediate send succeeds", async () => {
    // The ordinary path. Asserted so the failure test above cannot pass for the wrong
    // reason — a permanently-set error would satisfy a `toContain` too.
    const result = await mounted();

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(result.text()).toContain("error:none");
    expect(result.text()).toContain("deferred:0");
    result.unmount();
  });

  test("retries a failed send, and keeps reporting why it first failed", async () => {
    // The immediate-failure path defers, which makes the flush effect retry at once.
    // That is the right behaviour — a blip should not need a reconnect — but it means
    // a test cannot tell the two `setError` calls apart unless the retry *succeeds*.
    // With the retry succeeding, the error still on screen can only have come from the
    // first failure.
    let attempts = 0;
    setPermissionReply(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("blip");
      }
      return undefined;
    });

    const result = await mounted();

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(attempts).toBe(2);
    // Sent, so nothing is held any more...
    expect(result.text()).toContain("deferred:0");
    // ...and the first failure is still on screen rather than being erased by a
    // successful retry. Silently clearing it would tell the user nothing went wrong,
    // which is the opposite of what happened.
    expect(result.text()).toContain("blip");
    result.unmount();
  });

  test("holds each outstanding request separately", async () => {
    // §4.9 made this a queue because several requests can be outstanding at once. A
    // single held slot would reintroduce exactly that: the second tap replacing the
    // first, with the agent still blocked on the first.
    const result = await mounted({ connection: { client: null } });

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await tap(result, {
      action: "reject",
      permissionId: "per_2",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(result.text()).toContain("pending:per_1");
    expect(result.text()).toContain("count:2");
    expect(result.text()).toContain("deferred:2");
    result.unmount();
  });

  test("sends what it held once a client appears", async () => {
    // The held reply is only worth holding if it eventually goes out. This is the
    // transition the whole fix depends on.
    const result = await mounted({ connection: { client: null } });

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();
    expect(apiStub().permissionReply.calls).toHaveLength(0);

    await result.rerender({ connection: { client: apiStubClient() } });
    await result.flush();

    expect(replyArgs()).toMatchObject({ requestID: "per_1", decision: "once" });
    result.unmount();
  });

  test("forgets a held reply once it has been sent", async () => {
    // Otherwise every reconnect would re-send it and the server would reject the
    // second as already-answered — which reads to the user as their approval
    // bouncing back.
    const result = await mounted({ connection: { client: null } });

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();
    await result.rerender({ connection: { client: apiStubClient() } });
    await result.flush();

    expect(result.text()).toContain("deferred:0");

    // A second connect must not send it again.
    await result.rerender({ connection: { client: null } });
    await result.rerender({ connection: { client: apiStubClient() } });
    await result.flush();
    expect(apiStub().permissionReply.calls).toHaveLength(1);
    result.unmount();
  });

  test("keeps a held reply that failed, and says why", async () => {
    // Dropping it would leave the agent blocked on a prompt that now looks answered.
    // Keeping it costs nothing — the request is in the banner — and a later reconnect
    // retries it.
    setPermissionReply(async () => {
      throw new Error("server said no");
    });

    const result = await mounted({ connection: { client: null } });
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    await result.rerender({ connection: { client: apiStubClient() } });
    await result.flush();

    expect(result.text()).toContain("deferred:1");
    expect(result.text()).toContain("server said no");
    result.unmount();
  });

  test("holds a rejection the same way it holds an approval", async () => {
    // Symmetry matters: the bug applied to all three buttons, and a fix that only
    // deferred "allow" would leave the most safety-relevant one still broken.
    const result = await mounted({ connection: { client: null } });

    await tap(result, {
      action: "reject",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();
    await result.rerender({ connection: { client: apiStubClient() } });
    await result.flush();

    expect(replyArgs()).toMatchObject({ decision: "reject" });
    result.unmount();
  });

  test("a tap with no button shows the prompt and sends nothing", async () => {
    // Looking is not answering. Sending "once" because someone opened the notification
    // would approve a command they never read.
    const result = await mounted();

    await tap(result, {
      action: DEFAULT_NOTIFICATION_ACTION,
      permissionId: "per_1",
      sessionId: "ses_1",
      title: "Run the tests?",
    });
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(0);
    expect(result.text()).toContain("pending:per_1");
    result.unmount();
  });

  test("ignores a notification from another feature", async () => {
    // The app posts build and step-progress notifications too. Acting on one would
    // try to answer a permission request that does not exist.
    const result = await mounted();

    await tap(result, { action: "allow", type: "build-finished" });
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(0);
    expect(result.text()).toContain("pending:none");
    result.unmount();
  });

  test("ignores a permission notification carrying no ids", async () => {
    // Distinct from the above, and worth its own test: this one *is* ours and is still
    // unusable. There is no request to key on and no session to answer against, and
    // guessing either would risk replying to the wrong thing — worse than not replying.
    const result = await mounted();

    await tap(result, { action: "allow", identifier: "orphan-1" });
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(0);
    expect(result.text()).toContain("pending:none");
    result.unmount();
  });
});

describe("the cold start", () => {
  test("reads the last response, because no listener existed when it arrived", async () => {
    // A tap on a permission action foregrounds a killed app, and the response is
    // handed to the emitter before React mounts. The listener alone cannot see it —
    // the package's own hook reads the last response first for exactly this reason.
    const result = await mounted({
      notificationResponse: {
        action: "allow",
        permissionId: "per_1",
        sessionId: "ses_1",
      },
    });
    await result.flush();

    expect(replyArgs()).toMatchObject({ requestID: "per_1", decision: "once" });
    result.unmount();
  });

  test("answers it exactly once, even though the listener also fires", async () => {
    // Read-after-register deliberately overlaps the two routes so neither leaves a
    // gap. The overlap is safe because a notification is identified by the OS's own
    // id, so the same one arriving twice is recognisable. Two replies would have the
    // server accept one and reject the other, and the rejection would surface as an
    // error on an approval the user genuinely gave.
    const result = await mounted({
      notificationResponse: {
        action: "allow",
        permissionId: "per_1",
        sessionId: "ses_1",
        identifier: "n-1",
      },
    });
    await result.flush();

    // The same notification, delivered again by the listener.
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
      identifier: "n-1",
    });
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(1);
    result.unmount();
  });

  test("holds a cold-start reply when the client is not up yet", async () => {
    // Which is the normal case: the response is read on mount, and the connection has
    // not been established by then.
    const result = await mounted({
      connection: { client: null },
      notificationResponse: {
        action: "allow",
        permissionId: "per_1",
        sessionId: "ses_1",
      },
    });
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(0);
    expect(result.text()).toContain("deferred:1");
    expect(result.text()).toContain("pending:per_1");
    result.unmount();
  });

  test("does nothing when there is no last response", async () => {
    // The overwhelmingly common case. Asserted so a test cannot pass merely because
    // the cold-start path never ran.
    const result = await mounted();
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(0);
    expect(result.text()).toContain("deferred:0");
    result.unmount();
  });

  test("consumes the cold-start response, so no later launch replays it", async () => {
    // Asserted on the slot rather than on the call log: a second mount resets the
    // log, so "was it answered again?" is not observable that way — and the
    // mechanism that prevents a replay is the slot being emptied, which is directly
    // visible. Left in place, a replay would fire days later for a request long since
    // resolved, and each one would be a second reply for a single tap.
    const result = await mounted({
      notificationResponse: {
        action: "allow",
        permissionId: "per_1",
        sessionId: "ses_1",
      },
    });
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(1);
    expect(pendingColdStartResponse()).toBeNull();
    result.unmount();
  });
});

describe("the notification listener", () => {
  test("registers exactly one, and removes it on unmount", async () => {
    // A leaked listener outlives the provider and keeps calling `setState` on a dead
    // tree; a duplicated one answers every tap twice.
    const result = await mounted();
    expect(responseListenerCount()).toBe(1);

    result.unmount();
    expect(responseListenerCount()).toBe(0);
  });

  test("does not duplicate the listener when the client changes", async () => {
    // The old effect depended on `v2Client`, so every reconnect tore the listener down
    // and built it again — and in the gap a tap went to the previous handler, whose
    // `v2Client` closure was stale.
    const result = await mounted({ connection: { client: null } });

    await result.rerender({ connection: { client: apiStubClient() } });
    await result.flush();

    expect(responseListenerCount()).toBe(1);
    result.unmount();
  });
});

describe("rehydration on mount", () => {
  test("adopts what the server already considers pending", async () => {
    // A request that arrived while the app was closed. Without this the agent is
    // blocked on a prompt the user has never seen.
    setPendingPermissions(async () => ({
      data: [
        {
          id: "per_rehydrated",
          sessionID: "ses_test",
          action: "bash",
          message: "Run the tests?",
        },
      ],
    }));

    const result = await mounted();
    await result.flush();

    expect(result.text()).toContain("pending:per_rehydrated");
    result.unmount();
  });

  test("adopts all of them, not just the first", async () => {
    // Adopting `requests[0]` and discarding the rest is what §4.9 fixed: the rest were
    // unreachable until the next reconnect.
    setPendingPermissions(async () => ({
      data: [
        { id: "per_a", sessionID: "ses_test", action: "bash", message: "a" },
        { id: "per_b", sessionID: "ses_test", action: "edit", message: "b" },
        { id: "per_c", sessionID: "ses_test", action: "bash", message: "c" },
      ],
    }));

    const result = await mounted();
    await result.flush();

    expect(result.text()).toContain("pending:per_a");
    expect(result.text()).toContain("count:3");
    result.unmount();
  });

  test("stays quiet when the list call fails", async () => {
    // The SSE stream still delivers anything that arrives from here on, so a failed
    // rehydration is not worth an error the user cannot act on.
    setPendingPermissions(async () => {
      throw new Error("offline");
    });

    const result = await mounted();
    await result.flush();

    expect(result.text()).toContain("count:0");
    expect(result.text()).toContain("error:none");
    result.unmount();
  });

  test("does not adopt when there is no client", async () => {
    // Nothing to ask. Asserted because the client guard is the only thing stopping a
    // null client from reaching the API.
    const result = await mounted({ connection: { client: null } });
    await result.flush();

    expect(apiStub().pendingPermissions.calls).toHaveLength(0);
    result.unmount();
  });
});

describe("the event stream", () => {
  test("enqueues a request as it arrives", async () => {
    const result = await mounted();

    await emit(result, askedEvent({ id: "per_live" }));
    await result.flush();

    expect(result.text()).toContain("pending:per_live");
    result.unmount();
  });

  test("does not duplicate a replayed ask", async () => {
    // A reconnect replays `permission.asked` for anything still outstanding. Two
    // entries would mean answering the same prompt twice, the second time to a server
    // that already has the answer.
    const result = await mounted();

    await emit(result, askedEvent({ id: "per_live" }));
    await result.flush();
    await emit(result, askedEvent({ id: "per_live" }));
    await result.flush();

    expect(result.text()).toContain("count:1");
    result.unmount();
  });

  test("closes a request the agent says was answered", async () => {
    // Whoever answered it — another client, or this app's own notification action.
    // Closing by position rather than id would clear the wrong one.
    const result = await mounted();

    await emit(result, askedEvent({ id: "per_1" }));
    await emit(result, askedEvent({ id: "per_2" }));
    await result.flush();
    expect(result.text()).toContain("count:2");

    await emit(result, repliedEvent("per_2"));
    await result.flush();

    expect(result.text()).toContain("count:1");
    expect(result.text()).toContain("pending:per_1");
    result.unmount();
  });

  test("posts no notification while the app is in the foreground", async () => {
    // The banner is already on screen. A notification too would be the app
    // interrupting the user about something they are looking at.
    const result = await mounted();

    await emit(result, askedEvent({ id: "per_live" }));
    await result.flush();

    expect(scheduledNotifications()).toHaveLength(0);
    result.unmount();
  });

  test("posts one when the app is in the background", async () => {
    const result = await mounted();
    await background(result);

    await emit(result, askedEvent({ id: "per_live" }));
    await result.flush();

    expect(scheduledNotifications()).toHaveLength(1);
    result.unmount();
  });

  test("does not post twice for one request", async () => {
    // A replayed ask after the first notification would stack a second copy, and the
    // user would answer the same prompt from two notifications.
    const result = await mounted();
    await background(result);

    await emit(result, askedEvent({ id: "per_live" }));
    await result.flush();
    await emit(result, askedEvent({ id: "per_live" }));
    await result.flush();

    expect(scheduledNotifications()).toHaveLength(1);
    result.unmount();
  });

  test("posts nothing when notification permission was refused", async () => {
    // Asking is not the same as being granted, and the two decisions belong to
    // different parties: one is the app's, the other the user's.
    const result = await mounted({
      notificationPermissionStatus: "denied",
    });
    await background(result);

    await emit(result, askedEvent({ id: "per_live" }));
    await result.flush();

    expect(scheduledNotifications()).toHaveLength(0);
    result.unmount();
  });

  test("stops listening when the client goes away", async () => {
    const result = await mounted();

    await result.rerender({ connection: { client: null } });
    await result.flush();
    await emit(result, askedEvent({ id: "per_after" }));
    await result.flush();

    expect(result.text()).toContain("count:0");
    result.unmount();
  });
});

/**
 * The app lock, and replies taken from a notification while it is up.
 *
 * The lock is a *display* gate: it covers the workspace with an overlay, so it hides
 * the session without stopping the app from acting. A notification action is not
 * displayed by the app at all, so it sailed straight past — tapping "Allow" answered
 * the agent with the lock up, which is the one ordering that makes the lock decorative.
 *
 * These tests hold the reply instead, and release it on unlock.
 */
describe("the app lock", () => {
  const LOCKED = { biometricLock: { lockState: "locked" } } as const;
  const UNLOCKED = { biometricLock: { lockState: "unlocked" } } as const;

  test("holds a reply given while the app is locked", async () => {
    const result = await mounted({ ...LOCKED });

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(0);
    expect(result.text()).toContain("deferred:1");
    // Still visible in the banner, so the request is not invisible while it waits.
    expect(result.text()).toContain("pending:per_1");
    result.unmount();
  });

  test("names the lock as the reason, rather than blaming the connection", async () => {
    // The only phrase available to the banner used to be "waiting for the
    // connection". Here the connection is fine, so that sentence would send the user
    // to repair something that is not broken — and it is the one wait that ends
    // without them touching a setting at all.
    const result = await mounted({ ...LOCKED });
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(result.text()).toContain("reason:locked");
    result.unmount();
  });

  test("sends the held reply as soon as the user unlocks", async () => {
    // Holding is only acceptable because it is temporary. This is the transition the
    // policy depends on, and the reason it can reuse the deferred queue rather than
    // inventing a second mechanism: unlocking is just another reason a reply became
    // sendable.
    const result = await mounted({ ...LOCKED });
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();
    expect(apiStub().permissionReply.calls).toHaveLength(0);

    await result.rerender({ ...UNLOCKED });
    await result.flush();

    expect(replyArgs()).toMatchObject({ requestID: "per_1", decision: "once" });
    expect(result.text()).toContain("deferred:0");
    result.unmount();
  });

  test("holds while a biometric prompt is on screen", async () => {
    // `"unlocking"` is the moment the user has not been authenticated yet, so it is
    // the worst moment to send an approval. Wider than the workspace overlay's own
    // check, deliberately: an overlay during the prompt would cover it.
    const result = await mounted({
      biometricLock: { lockState: "unlocking" },
    });
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(apiStub().permissionReply.calls).toHaveLength(0);
    result.unmount();
  });

  test("does not hold on a device that cannot authenticate", async () => {
    // The hang this avoids. The stored preference survives the user unenrolling their
    // fingerprint in system settings; `lockState` then stays "locked" forever because
    // `authenticate()` returns false before it ever changes. Gating on the lock state
    // alone would hold every approval permanently, with the banner blaming a connection
    // that is perfectly healthy.
    const result = await mounted({
      biometricLock: { lockState: "locked", biometricAvailable: false },
    });
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(replyArgs()).toMatchObject({ requestID: "per_1" });
    expect(result.text()).toContain("deferred:0");
    result.unmount();
  });

  test("sends immediately when the lock is off", async () => {
    // The control for the four above: the default path must be untouched, or this
    // policy would silently disable notifications for every user without the lock.
    const result = await mounted({ ...UNLOCKED });
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    expect(replyArgs()).toMatchObject({ requestID: "per_1" });
    expect(result.text()).toContain("deferred:0");
    result.unmount();
  });
});

/**
 * Flushing more than one held reply.
 *
 * The previous implementation looped over the whole snapshot while each successful send
 * shrank the state it was iterating, which cannot be made safe by checking a `cancelled`
 * flag: `setDeferred` schedules a render, React serves it on the Scheduler's
 * `MessageChannel` (a macrotask), and the loop's next iteration resumes in a microtask.
 * The next send could therefore start before the cleanup ran, and the re-run the
 * shrinking state triggers would send the same entry twice — the server accepts the
 * first and rejects the second, which the user sees as their approval bouncing back.
 *
 * It does not reproduce under this harness, and that is exactly why it needed a test
 * rather than another attempt at reasoning: `act` flushes React synchronously, so the
 * cleanup always wins. A passing test here is not evidence the loop was safe. It is
 * now head-only, so this pins the outcome rather than the hazard — and it covers the
 * case the old suite never reached, where two replies are held and a client appears.
 */
describe("flushing several held replies", () => {
  test("sends each held reply exactly once, in the order they were tapped", async () => {
    const result = await mounted({ connection: { client: null } });

    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await tap(result, {
      action: "reject",
      permissionId: "per_2",
      sessionId: "ses_1",
    });
    await tap(result, {
      action: "always-allow",
      permissionId: "per_3",
      sessionId: "ses_1",
    });
    await result.flush();
    expect(result.text()).toContain("deferred:3");

    await result.rerender({ connection: { client: defaultClient() } });
    await result.flush();

    const calls = apiStub().permissionReply.calls as {
      requestID: string;
      decision: string;
    }[];
    // Three taps, three sends. A duplicate here is the bug this file was written for.
    expect(calls).toHaveLength(3);
    // Order is load-bearing: the agent is blocked on the head of its own queue, so
    // answering out of order is a no-op that leaves the turn stuck.
    expect(calls.map((call) => call.requestID)).toEqual([
      "per_1",
      "per_2",
      "per_3",
    ]);
    expect(calls.map((call) => call.decision)).toEqual([
      "once",
      "reject",
      "always",
    ]);
    expect(result.text()).toContain("deferred:0");
    result.unmount();
  });

  test("stops at the first failure and keeps the rest held", async () => {
    // One failure must not discard what is behind it. The failed entry stays visible
    // in the banner and is retried on a later connect; the ones after it are untouched.
    let attempts = 0;
    setPermissionReply(async () => {
      attempts += 1;
      throw new Error("server said no");
    });

    const result = await mounted({ connection: { client: null } });
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await tap(result, {
      action: "allow",
      permissionId: "per_2",
      sessionId: "ses_1",
    });
    await result.flush();

    await result.rerender({ connection: { client: defaultClient() } });
    await result.flush();

    expect(attempts).toBe(1);
    expect(result.text()).toContain("server said no");
    expect(result.text()).toContain("deferred:2");
    result.unmount();
  });

  test("does not re-send the head while its first send is still in flight", async () => {
    // The guard the comment above says `act` cannot test for, and it turns out a
    // hanging send *is* the way to reach it.
    //
    // The earlier reasoning was that `act` flushes React synchronously, so a re-run
    // always follows a completed send. That is true only because the stub resolves
    // immediately. Hold the reply open and the effect re-runs with the head unchanged
    // and its send still outstanding — a new tap appends behind it, `deferred` changes,
    // and without the in-flight set the same entry is sent twice. That is the one
    // interleaving `act` does not paper over, and it is the production one.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // `per_1` hangs; `per_2` fails. Both details are load-bearing. A hanging send is
    // the only way to have the head still in flight; a *failing* send is the only way
    // a later tap lands in the deferred queue behind it, because a tap taken with a
    // client present is sent immediately and never queues at all.
    setPermissionReply(async (body) => {
      if ((body as { requestID: string }).requestID === "per_1") {
        await gate;
        return;
      }
      throw new Error("server said no");
    });

    const result = await mounted({ connection: { client: null } });
    await tap(result, {
      action: "allow",
      permissionId: "per_1",
      sessionId: "ses_1",
    });
    await result.flush();

    // Connecting starts the send, which then hangs.
    await result.rerender({ connection: { client: defaultClient() } });
    await result.flush();
    const sendsOf = (id: string) =>
      (apiStub().permissionReply.calls as { requestID: string }[]).filter(
        (call) => call.requestID === id,
      );
    expect(sendsOf("per_1")).toHaveLength(1);

    // A second tap whose send fails, so it joins the queue behind the in-flight head
    // and re-runs the effect while that head is still outstanding.
    await tap(result, {
      action: "allow",
      permissionId: "per_2",
      sessionId: "ses_1",
    });
    await result.flush();

    // Still exactly one send of `per_1`. A second is the duplicate the server rejects
    // as already-answered, surfacing as the user's approval bouncing back.
    expect(sendsOf("per_1")).toHaveLength(1);
    expect(result.text()).toContain("deferred:2");

    // Let the held send finish; the queue then drains.
    await result.act(async () => {
      release();
      await gate;
    });
    await result.flush();

    expect(sendsOf("per_1")).toHaveLength(1);
    result.unmount();
  });
});
