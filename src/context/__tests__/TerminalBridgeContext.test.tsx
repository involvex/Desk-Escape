import { describe, expect, test } from "bun:test";

import {
  TerminalBridgeProvider,
  useTerminalBridge,
} from "@/context/TerminalBridgeContext";
import { act, renderWithContext, type RenderResult } from "@/testing/harness";

/**
 * Render tests for the terminal bridge.
 *
 * This is the branch the pure `terminal-input` tests cannot reach: whether a write
 * is handed to a live shell or held for the next connect depends on what the
 * registered sink returns, which only exists once React has mounted something.
 *
 * Two failures are worth guarding. Running a command twice, because a write was
 * both delivered and queued. And dropping a command the user was told had run,
 * because the queue was drained before anyone checked there was a shell to send
 * it to.
 */

/** What the tests drive the bridge through. */
interface Bridge {
  runInTerminal: (text: string) => void;
  setWriteSink: (sink: ((text: string) => boolean) | null) => void;
  drainFor: (directory: string | null) => number;
  clearDelivery: () => void;
  pendingCount: number;
  lastDelivery: { count: number; token: number } | null;
}

/**
 * Mount the provider and hand back the bridge plus a re-read.
 *
 * The consumer publishes the bridge into a box on every render, so after `flush()`
 * the box holds values from the render that included the state change — reading
 * the context object captured at mount would always report the initial state.
 *
 * Every *mutating* method is handed back wrapped in `act`. All four call `setState`
 * on the provider, and a test body is not an act scope: React updates outside one,
 * warns, and defers the update to the next `act` — which here is the `flush()` that
 * follows. The assertions would still pass, because the deferred update is the same
 * update, but it would not have been processed the way the app processes it, and
 * ordering is the entire subject of these tests. Reads are returned untouched.
 */
async function mountBridge(): Promise<{
  result: RenderResult;
  bridge: () => Bridge;
}> {
  const box: { current: Bridge | null } = { current: null };

  function Consumer() {
    const context = useTerminalBridge();
    box.current = {
      runInTerminal: context.runInTerminal,
      setWriteSink: context.setWriteSink,
      drainFor: context.drainFor,
      clearDelivery: context.clearDelivery,
      pendingCount: context.pendingCount,
      lastDelivery: context.lastDelivery,
    };
    return null;
  }

  const result = await renderWithContext(
    <TerminalBridgeProvider>
      <Consumer />
    </TerminalBridgeProvider>,
  );

  return {
    result,
    bridge: () => {
      const current = box.current;
      if (!current) {
        throw new Error("The bridge consumer has not rendered yet.");
      }
      return {
        runInTerminal: (text) => act(() => current.runInTerminal(text)),
        setWriteSink: (sink) => act(() => current.setWriteSink(sink)),
        drainFor: (directory) => {
          let drained = 0;
          act(() => {
            drained = current.drainFor(directory);
          });
          return drained;
        },
        clearDelivery: () => act(() => current.clearDelivery()),
        pendingCount: current.pendingCount,
        lastDelivery: current.lastDelivery,
      };
    },
  };
}

/** A sink that records what it was given. */
function recordingSink(accept = true): {
  sink: (text: string) => boolean;
  sent: string[];
} {
  const sent: string[] = [];
  return {
    sent,
    sink: (text: string) => {
      sent.push(text);
      return accept;
    },
  };
}

describe("TerminalBridge", () => {
  test("queues a write when no shell is mounted", async () => {
    const { result, bridge } = await mountBridge();
    bridge().runInTerminal("npm test");
    await result.flush();
    expect(bridge().pendingCount).toBe(1);
    result.unmount();
  });

  test("delivers to a live sink instead of queueing", async () => {
    const { sink, sent } = recordingSink();
    const { result, bridge } = await mountBridge();
    bridge().setWriteSink(sink);
    await result.flush();

    bridge().runInTerminal("npm test");
    await result.flush();

    expect(sent).toEqual(["npm test"]);
    // Delivered *or* queued, never both — both would run the command twice.
    expect(bridge().pendingCount).toBe(0);
    result.unmount();
  });

  test("types rather than submits a live write", async () => {
    // A live shell sits at a prompt with the text already there. A trailing
    // newline would run the command immediately and leave a blank prompt line,
    // and pressing Enter on *that* line would run it again.
    const { sink, sent } = recordingSink();
    const { result, bridge } = await mountBridge();
    bridge().setWriteSink(sink);
    await result.flush();

    bridge().runInTerminal("npm test");
    await result.flush();

    expect(sent[0]).toBe("npm test");
    expect(sent[0]!.endsWith("\n")).toBe(false);
    result.unmount();
  });

  test("submits a queued write when it finally reaches a shell", async () => {
    const { sink, sent } = recordingSink();
    const { result, bridge } = await mountBridge();

    bridge().runInTerminal("npm test");
    await result.flush();
    expect(bridge().pendingCount).toBe(1);

    // The panel comes up, registers a sink, then drains.
    bridge().setWriteSink(sink);
    await result.flush();
    const delivered = bridge().drainFor("/repo");
    await result.flush();

    // Submitted this time: a freshly spawned shell has nobody to press Enter.
    expect(delivered).toBe(1);
    expect(sent).toEqual(["npm test\n"]);
    expect(bridge().pendingCount).toBe(0);
    result.unmount();
  });

  test("a sink that refuses a live write falls back to the queue", async () => {
    const { sink } = recordingSink(false);
    const { result, bridge } = await mountBridge();
    bridge().setWriteSink(sink);
    await result.flush();

    bridge().runInTerminal("npm test");
    await result.flush();

    expect(bridge().pendingCount).toBe(1);
    result.unmount();
  });

  test("draining with no sink keeps the writes rather than losing them", async () => {
    // The bug this pins: taking the writes out of the queue *before* checking
    // there was somewhere to send them, then reporting nothing delivered.
    const { result, bridge } = await mountBridge();
    bridge().runInTerminal("npm test");
    await result.flush();

    const delivered = bridge().drainFor("/repo");
    await result.flush();

    expect(delivered).toBe(0);
    expect(bridge().pendingCount).toBe(1);
    result.unmount();
  });

  test("draining twice does not deliver twice", async () => {
    const { sink, sent } = recordingSink();
    const { result, bridge } = await mountBridge();
    bridge().runInTerminal("npm test");
    await result.flush();

    bridge().setWriteSink(sink);
    await result.flush();
    bridge().drainFor("/repo");
    await result.flush();
    bridge().drainFor("/repo");
    await result.flush();

    expect(sent).toEqual(["npm test\n"]);
    result.unmount();
  });

  test("drain only takes the writes for the directory asked about", async () => {
    // A shell belongs to one location; a write asked for in the previous project
    // must not execute in this one.
    const { result, bridge } = await mountBridge();
    bridge().runInTerminal("npm test");
    await result.flush();

    const delivered = bridge().drainFor("/somewhere-else");
    await result.flush();

    expect(delivered).toBe(0);
    expect(bridge().pendingCount).toBe(1);
    result.unmount();
  });

  test("a live write records no delivery", async () => {
    // The confirmation means "this ran while you were not looking". A write typed
    // into a terminal the user is looking at needs no receipt.
    const { sink } = recordingSink();
    const { result, bridge } = await mountBridge();
    bridge().setWriteSink(sink);
    await result.flush();

    bridge().runInTerminal("npm test");
    await result.flush();

    expect(bridge().lastDelivery).toBeNull();
    result.unmount();
  });

  test("records what was delivered, with a fresh token each time", async () => {
    const { sink } = recordingSink();
    const { result, bridge } = await mountBridge();

    // Queued first: with a sink already live the write is delivered immediately
    // and there is nothing to drain, so no delivery would be recorded at all.
    bridge().runInTerminal("two");
    await result.flush();
    bridge().setWriteSink(sink);
    await result.flush();
    bridge().drainFor("/repo");
    await result.flush();

    const first = bridge().lastDelivery;
    expect(first).not.toBeNull();
    expect(first!.count).toBe(1);

    // The token has to change even for an identical count, or the confirmation's
    // auto-dismiss timer would not restart for the second batch.
    // Sink back down first: with it still live both writes would be delivered
    // immediately and there would be nothing left to drain.
    bridge().setWriteSink(null);
    bridge().runInTerminal("three");
    await result.flush();
    expect(bridge().pendingCount).toBe(1);

    bridge().setWriteSink(sink);
    await result.flush();
    bridge().drainFor("/repo");
    await result.flush();

    expect(bridge().lastDelivery!.token).toBeGreaterThan(first!.token);
    result.unmount();
  });

  test("a delivery can be dismissed", async () => {
    const { sink } = recordingSink();
    const { result, bridge } = await mountBridge();

    bridge().runInTerminal("npm test");
    await result.flush();
    bridge().setWriteSink(sink);
    await result.flush();
    bridge().drainFor("/repo");
    await result.flush();
    expect(bridge().lastDelivery).not.toBeNull();

    bridge().clearDelivery();
    await result.flush();
    expect(bridge().lastDelivery).toBeNull();
    result.unmount();
  });

  test("a blank command is dropped rather than queued", async () => {
    const { result, bridge } = await mountBridge();
    bridge().runInTerminal("   ");
    await result.flush();
    expect(bridge().pendingCount).toBe(0);
    result.unmount();
  });

  test("a blank command is not sent to a live shell either", async () => {
    // The queue path drops blanks inside `enqueueWrite`; the live path has to make
    // the same check itself. Whitespace alone at a prompt submits an empty line,
    // which scrolls the terminal and tells the user nothing.
    const { sink, sent } = recordingSink();
    const { result, bridge } = await mountBridge();
    bridge().setWriteSink(sink);
    await result.flush();

    for (const blank of ["", "   ", "\n", "\n\n"]) {
      bridge().runInTerminal(blank);
    }
    await result.flush();

    expect(sent).toEqual([]);
    expect(bridge().pendingCount).toBe(0);
    result.unmount();
  });

  test("using the hook outside the provider says so", async () => {
    function Orphan() {
      useTerminalBridge();
      return null;
    }
    // The message is the assertion: a bare "cannot read property of null" would
    // send a reader looking at the hook instead of at the missing provider.
    await expect(renderWithContext(<Orphan />)).rejects.toThrow(
      /TerminalBridgeProvider/,
    );
  });
});
