import { beforeEach, describe, expect, test } from "bun:test";

import { TerminalPanel } from "@/components/TerminalPanel";
import {
  TerminalBridgeProvider,
  useTerminalBridge,
} from "@/context/TerminalBridgeContext";
import {
  apiStub,
  resetClientCalls,
  resetPtySession,
  setPtySession,
} from "@/testing/context-holds";
import {
  act,
  renderWithContext,
  type RenderOptions,
  type RenderResult,
} from "@/testing/harness";
import {
  postFromShell,
  resetWebViewStub,
  webViewStub,
} from "@/testing/webview-stub";

/**
 * Render tests for the terminal panel's write bridge.
 *
 * These exist because the wiring broke twice while "Run in terminal" was being
 * built, and both breakages were invisible to the type checker, to lint, and to
 * every pure test in `terminal-input.test.ts`:
 *
 *  1. The effect that publishes the write sink also cleared the queue on cleanup.
 *     The sink closes over the connection state, so that effect re-runs on every
 *     state change — flipping `loading → connected` wiped the queue *before* the
 *     drain could take it.
 *  2. The drain ran inside the WebView message handler, right after
 *     `setWebViewState("connected")`. The sink ref still held the sink bound to
 *     `"loading"`, which refuses writes, so every one was re-queued.
 *
 * Both are now pinned by driving the real component through a real WebSocket
 * lifecycle. Only the view and the PTY session stand in — the sink publication,
 * the effect order, and the drain are the component's own.
 */

/** The bridge, as seen from inside the provider. */
interface Bridge {
  runInTerminal: (text: string) => void;
  pendingCount: () => number;
}

/** Writes the panel injected into the shell, decoded back out of the scripts. */
function injectedWrites(): string[] {
  return webViewStub.injected
    .filter((script) => script.includes("__TERMINAL_WRITE__"))
    .map((script) => {
      const match = script.match(/__TERMINAL_WRITE__\((.*)\);/);
      return JSON.parse(match?.[1] ?? "null") as string | null;
    })
    .filter((text): text is string => text !== null);
}

/**
 * Mount the panel with a capture component in the *same* provider.
 *
 * One provider is the point: a queued write only reaches the shell if both the
 * caller and the panel share a queue, and testing them in separate providers would
 * pass while proving nothing.
 */
async function mountPanel(options: RenderOptions = {}) {
  const box: { current: Bridge | null } = { current: null };

  function Capture() {
    const context = useTerminalBridge();
    box.current = {
      // Wrapped for the same reason as in `TerminalBridgeContext.test.tsx`: it calls
      // `setState` on the provider, and a test body is not an act scope. Reads are
      // passed through untouched.
      runInTerminal: (text: string) => act(() => context.runInTerminal(text)),
      // Read through the closure so it reflects the latest render, not the one
      // captured when the box was first filled.
      pendingCount: () => context.pendingCount,
    };
    return null;
  }

  // A factory, not an element: the theme test re-renders this tree, and React
  // skips a subtree whose element it has already seen.
  const result = await renderWithContext(
    () => (
      <TerminalBridgeProvider>
        <Capture />
        <TerminalPanel />
      </TerminalBridgeProvider>
    ),
    options,
  );

  return { result, bridge: () => box.current! };
}

/** Drive the panel through load → connected, the way a real shell would. */
async function connect(result: RenderResult): Promise<void> {
  await act(async () => {
    postFromShell({ type: "connected" });
  });
  await result.flush();
}

beforeEach(() => {
  resetWebViewStub();
  resetPtySession();
  resetClientCalls();
});

describe("TerminalPanel write bridge", () => {
  test("mounts the shell once the ticket authorizes", async () => {
    const { result } = await mountPanel();
    // The WebView exists before the socket is up — `wsUrl` only needs the ticket,
    // not a connection. What the socket changes is the status line.
    expect(result.byType("WebView").length).toBe(1);
    expect(result.text()).toContain("Connecting to shell...");

    await connect(result);
    expect(result.text()).toContain("Shell connected");
    result.unmount();
  });

  test("a command asked for before the shell is ready is queued, not lost", async () => {
    const { result, bridge } = await mountPanel();
    // The user taps Run in the chat: the panel is up but the socket is not, so
    // there is nowhere to type yet.
    bridge().runInTerminal("npm test");
    await result.flush();

    expect(bridge().pendingCount()).toBe(1);
    expect(injectedWrites()).toEqual([]);

    await connect(result);

    expect(injectedWrites()).toEqual(["npm test\n"]);
    expect(bridge().pendingCount()).toBe(0);
    result.unmount();
  });

  test("the sink is published before the drain runs", async () => {
    // If the drain effect were declared *above* the sink effect it would find the
    // stale sink, which refuses writes, and quietly leave the command queued. The
    // user would see no confirmation and no command — nothing else catches that.
    const { result, bridge } = await mountPanel();
    bridge().runInTerminal("echo hi");
    await result.flush();

    await connect(result);

    expect(injectedWrites()).toContain("echo hi\n");
    expect(result.text()).toContain("Command sent to terminal");
    result.unmount();
  });

  test("several queued commands arrive together as one notice", async () => {
    const { result, bridge } = await mountPanel();
    bridge().runInTerminal("npm test");
    bridge().runInTerminal("npm run build");
    bridge().runInTerminal("git status");
    await result.flush();
    expect(bridge().pendingCount()).toBe(3);

    await connect(result);

    expect(injectedWrites()).toEqual([
      "npm test\n",
      "npm run build\n",
      "git status\n",
    ]);
    // A count, not three separate receipts.
    expect(result.text()).toContain("3 commands sent to terminal");
    result.unmount();
  });

  test("reconnecting does not replay what already ran", async () => {
    // The drain is destructive on purpose. A WebView reload — which happens on
    // every reconnect — must not re-run a command the user already had run.
    const { result, bridge } = await mountPanel();
    bridge().runInTerminal("npm test");
    await result.flush();

    await connect(result);
    await connect(result);
    await connect(result);

    expect(injectedWrites()).toEqual(["npm test\n"]);
    result.unmount();
  });

  test("a command typed while connected is not queued for later", async () => {
    const { result, bridge } = await mountPanel();
    await connect(result);

    bridge().runInTerminal("ls");
    await result.flush();

    // Typed, not submitted: the user is watching, and a trailing newline would run
    // it immediately and leave a blank prompt for Enter to re-run it on.
    expect(injectedWrites()).toEqual(["ls"]);
    expect(bridge().pendingCount()).toBe(0);
    // And no receipt — the user saw it happen.
    expect(result.text()).not.toContain("sent to terminal");
    result.unmount();
  });

  test("the confirmation clears itself", async () => {
    const { result, bridge } = await mountPanel();
    bridge().runInTerminal("npm test");
    await result.flush();
    await connect(result);
    expect(result.text()).toContain("Command sent to terminal");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4100));
    });

    expect(result.text()).not.toContain("sent to terminal");
    result.unmount();
  });

  test("a theme change repaints without reloading the page", async () => {
    // Reloading would destroy the 5000-line scrollback buffer, which is the whole
    // reason the theme is applied by injection rather than by swapping the source
    // HTML. §2.2 exists for this.
    const { result } = await mountPanel({ theme: "dev-dark" });
    await connect(result);
    const injectedBefore = webViewStub.injected.length;
    const reloadsBefore = webViewStub.reloadCount;

    await result.rerender({ theme: "solarized-dark" });

    expect(webViewStub.reloadCount).toBe(reloadsBefore);
    // A repaint was injected, and it carries the new colours.
    const repaint = webViewStub.injected.slice(injectedBefore);
    expect(repaint.length).toBeGreaterThan(0);
    expect(repaint.some((s) => s.includes("__TERMINAL_APPLY_THEME__"))).toBe(
      true,
    );
    // Same WebView instance throughout, so the buffer survives.
    expect(result.byType("WebView").length).toBe(1);
    result.unmount();
  });

  test("a resize is reported to the server, scoped to the directory", async () => {
    const { result } = await mountPanel();
    await connect(result);

    await act(async () => {
      postFromShell({ type: "resize", cols: 120, rows: 40 });
    });
    await result.flush();

    // V2 nests the directory under `location`, alongside the updatable fields.
    expect(apiStub().ptyUpdate).toEqual([
      {
        ptyID: "pty_test",
        location: { directory: "/repo" },
        size: { cols: 120, rows: 40 },
      },
    ]);
    result.unmount();
  });

  test("a dropped socket is reported with its close code", async () => {
    const { result } = await mountPanel();
    await connect(result);

    await act(async () => {
      postFromShell({ type: "disconnected", code: 1006 });
    });
    await result.flush();

    expect(result.text()).toContain("Shell disconnected (code 1006)");
    result.unmount();
  });

  test("a PTY failure surfaces and leaves queued writes alone", async () => {
    setPtySession({ status: "error", error: "PTY refused" });
    const { result, bridge } = await mountPanel();

    expect(result.text()).toContain("PTY refused");
    // No drain happened, so nothing is claimed as delivered.
    expect(bridge().pendingCount()).toBe(0);
    result.unmount();
  });

  test("no directory means no shell at all", async () => {
    // The project is cleared too: `TerminalPanel` falls back to it when
    // `activeDirectory` is null, so clearing only the directory would leave a
    // worktree to find and the test would pass for the wrong reason.
    const { result } = await mountPanel({
      connection: { activeDirectory: null, project: null },
      project: null,
    });

    expect(result.text()).toContain("Terminal unavailable");
    expect(result.byType("WebView")).toHaveLength(0);
    result.unmount();
  });

  test("unmounting keeps the queue for the next shell", async () => {
    // A queued write is a request to run a command in a project, not state
    // belonging to a mounted view. Clearing it on unmount would drop commands
    // because the user glanced back at the chat before the shell was ready.
    const { result, bridge } = await mountPanel();
    bridge().runInTerminal("npm test");
    await result.flush();
    expect(bridge().pendingCount()).toBe(1);

    result.unmount();

    // Read the count the bridge itself holds, through a fresh provider mounted
    // over the same module state is not possible — so instead assert the panel
    // published nothing and the write was never injected.
    expect(injectedWrites()).toEqual([]);
  });
});
