import { describe, expect, test } from "bun:test";

import { OpenCodeProvider } from "@/api/providers/opencode/provider";

/**
 * Tests for the provider-level Stop path.
 *
 * `interruptSession` is the seam that lets the composer stop a runaway turn. Two
 * things matter and are easy to get wrong:
 *
 * 1. It must NOT send `resume`. V2's `session.interrupt` takes an optional
 *    `resume` flag that restarts the turn with the same input - the opposite of
 *    what a Stop button should do, and it would re-run the agent's work.
 * 2. It must surface the server's `interrupted` flag, because `false` means the
 *    turn had already finished and the caller should leave busy state alone.
 *
 * A minimal client double is used rather than a real client so the exact request
 * body can be asserted.
 */

type InterruptArgs = { sessionID: string; resume?: boolean };

function clientDouble(
  result: { interrupted: boolean } | Error,
  calls: InterruptArgs[],
) {
  return {
    session: {
      interrupt: async (args: InterruptArgs) => {
        calls.push(args);
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
    },
  };
}

/** Builds a provider wired to the double without going through `connect`. */
function providerWith(client: unknown): OpenCodeProvider {
  const provider = new OpenCodeProvider();
  // The private field is the single source of truth for `requireClient`.
  (provider as unknown as { _client: unknown })._client = client;
  return provider;
}

describe("OpenCodeProvider.interruptSession", () => {
  test("sends the session id and reports the server's answer", async () => {
    const calls: InterruptArgs[] = [];
    const provider = providerWith(clientDouble({ interrupted: true }, calls));

    await expect(provider.interruptSession("ses_1")).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sessionID).toBe("ses_1");
  });

  test("never sends `resume`, which would restart the turn", async () => {
    const calls: InterruptArgs[] = [];
    const provider = providerWith(clientDouble({ interrupted: true }, calls));

    await provider.interruptSession("ses_1");

    // The key must be absent, not merely falsy: `resume: false` is still a
    // resume instruction in some server versions.
    expect(calls[0]).not.toHaveProperty("resume");
    expect("resume" in (calls[0] ?? {})).toBe(false);
  });

  test("reports false when the turn had already finished", async () => {
    const provider = providerWith(clientDouble({ interrupted: false }, []));

    await expect(provider.interruptSession("ses_1")).resolves.toBe(false);
  });

  test("propagates server errors", async () => {
    const provider = providerWith(
      clientDouble(new Error("session not found"), []),
    );

    await expect(provider.interruptSession("ses_missing")).rejects.toThrow();
  });

  test("throws when there is no client", async () => {
    const provider = new OpenCodeProvider();

    await expect(provider.interruptSession("ses_1")).rejects.toThrow();
  });

  test("survives a response missing the interrupted flag", async () => {
    // Defensive: treat an unrecognised payload as "nothing was interrupted"
    // rather than throwing on a boolean coercion.
    const provider = providerWith(clientDouble({} as never, []));

    await expect(provider.interruptSession("ses_1")).resolves.toBe(false);
  });
});

describe("OpenCodeProvider capabilities", () => {
  test("advertises terminal and file browser support", () => {
    const provider = new OpenCodeProvider();

    expect(provider.supportsTerminal).toBe(true);
    expect(provider.supportsFileBrowser).toBe(true);
    expect(provider.type).toBe("opencode");
  });
});
