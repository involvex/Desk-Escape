import { describe, expect, test } from "bun:test";

import { CursorProvider } from "@/api/providers/cursor/provider";

/**
 * Tests for the Cursor provider's Stop path and its event-listener lifecycle.
 *
 * Two defects are guarded here:
 *
 * 1. `sendPrompt` used to register a `CursorEventBus` listener and never remove
 *    it. Each prompt added another permanent listener, so after N prompts every
 *    event was folded into `_messages` N times - the transcript multiplied and
 *    memory grew without bound.
 * 2. There was no way to cancel a Cursor run, so the composer had nothing to call
 *    for the OpenCode provider's new Stop button.
 */

/**
 * Structural view of the provider these tests drive.
 *
 * Deliberately *not* an intersection with `CursorProvider`: every field worth
 * asserting on is `private`, so intersecting collapses the whole type to `never`.
 * This describes the public surface the tests call plus the private state they
 * need to read, and is reached through a single `as unknown as` cast.
 */
type AnyProvider = {
  sendPrompt(sessionId: string, text: string): Promise<void>;
  interruptSession(sessionId: string): Promise<boolean>;
  selectSession(id: string): Promise<unknown>;
  disconnect(): Promise<void>;
  _client: unknown;
  _agentId: string | null;
  _messages: unknown[];
  _currentRunId: string | null;
  _listeners: Set<(event: unknown) => void>;
  eventBus: {
    listeners: Set<(event: unknown) => void>;
    onEvent: (cb: (event: unknown) => void) => () => void;
  };
};

function view(provider: CursorProvider): AnyProvider {
  return provider as unknown as AnyProvider;
}

type PromptResult = { run: { id: string } } | Error;

function clientDouble(prompt: PromptResult, cancelled: string[] = []): unknown {
  return {
    createRun: async () => {
      if (prompt instanceof Error) {
        throw prompt;
      }
      return prompt;
    },
    cancelRun: async (agentId: string, runId: string) => {
      cancelled.push(`${agentId}/${runId}`);
    },
    getAgent: async (id: string) => ({
      id,
      name: "agent",
      status: "ACTIVE" as const,
      createdAt: "",
      updatedAt: "",
    }),
  };
}

/**
 * Builds a connected provider whose event bus streams only what a test asks for.
 *
 * `sendPrompt` awaits `eventBus.start`, so the double's `streamRun` returns a
 * stream that emits `frames` as SSE `data:` lines and then closes. That keeps
 * these tests free of timers and network while still exercising the real
 * read/parse/dispatch path in `CursorEventBus`.
 */
function providerWith(
  prompt: PromptResult,
  cancelled: string[] = [],
  frames: unknown[] = [],
): AnyProvider {
  const provider = view(new CursorProvider());
  const client = clientDouble(prompt, cancelled) as Record<string, unknown>;

  client.streamRun = async () => {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) {
          // A string is written verbatim so a test can inject a body that is
          // not valid JSON; anything else is encoded as a real event.
          const body =
            typeof frame === "string" ? frame : JSON.stringify(frame);
          controller.enqueue(encoder.encode(`data: ${body}\n`));
        }
        controller.close();
      },
    });
  };

  provider._client = client;
  provider._agentId = "agent_1";
  return provider;
}

describe("CursorProvider.sendPrompt listener lifecycle", () => {
  test("does not accumulate listeners across prompts", async () => {
    // The regression guard: previously each call left a listener behind, so the
    // Nth prompt folded every event N times.
    const provider = providerWith({ run: { id: "run_1" } });
    const bus = provider.eventBus;

    // Peak concurrency matters, not the count after the stream closes: a leaked
    // listener would show up as a growing peak even though each call eventually
    // ends at zero.
    let peak = 0;
    const originalOnEvent = bus.onEvent.bind(bus);
    bus.onEvent = (cb: (event: unknown) => void) => {
      const unsubscribe = originalOnEvent(cb);
      peak = Math.max(peak, bus.listeners.size);
      return () => {
        unsubscribe();
        peak = Math.max(peak, bus.listeners.size);
      };
    };

    await provider.sendPrompt("agent_1", "one");
    const afterFirst = peak;
    await provider.sendPrompt("agent_1", "two");
    const afterSecond = peak;

    expect(afterFirst).toBe(1);
    // With a leak, the second prompt would peak at 2.
    expect(afterSecond).toBe(1);
  });

  test("folds each streamed event exactly once", async () => {
    // The user-visible consequence of the leak: with N listeners attached, the
    // Nth prompt's single `assistant` frame was folded N times, so the
    // transcript grew quadratically (1 + 2 + 3 = 6 messages for 3 prompts).
    const frame = { type: "assistant", payload: { text: "hello" } };
    const provider = providerWith({ run: { id: "run_1" } }, [], [frame]);

    await provider.sendPrompt("agent_1", "one");
    expect(provider._messages).toHaveLength(1);

    await provider.sendPrompt("agent_1", "two");
    expect(provider._messages).toHaveLength(2);

    await provider.sendPrompt("agent_1", "three");
    // With the leak this would be 6.
    expect(provider._messages).toHaveLength(3);
  });

  test("a malformed frame is skipped without aborting the stream", async () => {
    // `CursorEventBus` swallows per-frame parse errors, so one bad body must not
    // stop the good frames that follow it in the same stream.
    const provider = providerWith(
      { run: { id: "run_1" } },
      [],
      [
        { type: "assistant", payload: { text: "first" } },
        "{ not json",
        { type: "assistant", payload: { text: "second" } },
      ],
    );

    await provider.sendPrompt("agent_1", "hello");

    expect(provider._messages).toHaveLength(2);
  });

  test("detaches its reducer when the stream ends", async () => {
    const provider = providerWith({ run: { id: "run_1" } });
    const bus = provider.eventBus;

    expect(bus.listeners.size).toBe(0);
    await provider.sendPrompt("agent_1", "hello");
    expect(bus.listeners.size).toBe(0);
  });

  test("detaches its reducer even when streaming throws", async () => {
    const provider = providerWith({ run: { id: "run_1" } });
    const bus = provider.eventBus;

    const client = provider._client as Record<string, unknown>;
    client.streamRun = async () => {
      throw new Error("network down");
    };

    // `CursorEventBus.start` swallows stream errors, so this resolves.
    await provider.sendPrompt("agent_1", "hello");
    expect(bus.listeners.size).toBe(0);
  });

  test("records the active run id", async () => {
    const provider = providerWith({ run: { id: "run_42" } });
    await provider.sendPrompt("agent_1", "hello");

    expect(provider._currentRunId).toBe("run_42");
  });

  test("surfaces a failed run creation", async () => {
    const provider = providerWith(new Error("no capacity"));
    await expect(provider.sendPrompt("agent_1", "hello")).rejects.toThrow();
  });
});

describe("CursorProvider.interruptSession", () => {
  test("cancels the in-flight run", async () => {
    const cancelled: string[] = [];
    const provider = providerWith({ run: { id: "run_1" } }, cancelled);
    await provider.sendPrompt("agent_1", "hello");

    await expect(provider.interruptSession("agent_1")).resolves.toBe(true);
    expect(cancelled).toEqual(["agent_1/run_1"]);
  });

  test("clears the run id so a second stop is a no-op", async () => {
    const cancelled: string[] = [];
    const provider = providerWith({ run: { id: "run_1" } }, cancelled);
    await provider.sendPrompt("agent_1", "hello");

    await provider.interruptSession("agent_1");
    await expect(provider.interruptSession("agent_1")).resolves.toBe(false);
    expect(cancelled).toHaveLength(1);
  });

  test("returns false when nothing is running", async () => {
    const provider = providerWith({ run: { id: "run_1" } });
    await expect(provider.interruptSession("agent_1")).resolves.toBe(false);
  });

  test("throws when not connected", async () => {
    const provider = view(new CursorProvider());
    await expect(provider.interruptSession("agent_1")).rejects.toThrow();
  });

  test("throws when no agent is selected", async () => {
    const provider = providerWith({ run: { id: "run_1" } });
    provider._agentId = null;

    await expect(provider.interruptSession("agent_1")).rejects.toThrow();
  });
});

describe("CursorProvider state resets", () => {
  test("selectSession clears the in-flight run", async () => {
    const provider = providerWith({ run: { id: "run_1" } });
    await provider.sendPrompt("agent_1", "hello");
    expect(provider._currentRunId).toBe("run_1");

    await provider.selectSession("agent_2");

    expect(provider._currentRunId).toBeNull();
    expect(provider._agentId).toBe("agent_2");
  });

  test("disconnect clears the in-flight run", async () => {
    const provider = providerWith({ run: { id: "run_1" } });
    await provider.sendPrompt("agent_1", "hello");

    await provider.disconnect();

    expect(provider._currentRunId).toBeNull();
  });
});
