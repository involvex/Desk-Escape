import { describe, expect, test } from "bun:test";

import { TERMINAL_SHELL_HTML } from "@/assets/terminal-shell-html";

/**
 * Contract tests for the *generated* terminal shell.
 *
 * `src/assets/terminal-shell-html.ts` is produced by
 * `scripts/build-terminal-shell.mjs` and is 500KB on one line, so nothing else in
 * the suite exercises what is inside it. "Run in terminal" depends on two things
 * in there — a write hook and a buffer for writes that arrive before the socket —
 * and both fail silently if a regeneration drops them: the app injects JS that
 * calls `__TERMINAL_WRITE__`, gets no error, and the command simply never runs.
 *
 * These assert the shell's side of the contract by shape rather than by running
 * xterm, which is the only option short of a WebView harness.
 */

const shell = TERMINAL_SHELL_HTML;

/** The write hook, isolated so a failure does not print 500KB of xterm. */
const writeHook = shell.slice(
  shell.indexOf("window.__TERMINAL_WRITE__ = function"),
  shell.indexOf("term.onData(function"),
);

/**
 * Just the `onopen` handler.
 *
 * Sliced from the socket lifecycle rather than used whole on purpose: that range
 * still contains `function flushWrites() {`, whose *declaration* would satisfy a
 * naive `toContain("flushWrites()")` even after the call was deleted.
 */
const onOpenHandler = shell.slice(
  shell.indexOf("ws.onopen = function"),
  shell.indexOf("ws.onmessage = function"),
);

describe("terminal shell write path", () => {
  test("exposes the write hook the app injects", () => {
    // `TerminalPanel` injects exactly `window.__TERMINAL_WRITE__ && …`. If this
    // name changes, both sides have to change together.
    expect(shell).toContain("window.__TERMINAL_WRITE__");
  });

  test("accepts a single text argument", () => {
    // A second parameter would mean the shell is being asked to frame the text,
    // and the app already does that deliberately (typed vs submitted).
    expect(shell).toContain("__TERMINAL_WRITE__ = function (text)");
  });

  test("refuses nothing rather than sending empty input", () => {
    // An empty string reaching ws.send is at best a no-op and at worst a protocol
    // error, and the app has already filtered blanks before getting here.
    expect(writeHook).toContain(
      'typeof text !== "string" || text.length === 0',
    );
  });

  test("buffers a write that arrives before the socket is open", () => {
    // `onopen` has not fired yet on a fresh WebView, and "Run" is pressed during
    // exactly that window. Dropping the write here is the silent-failure mode.
    expect(writeHook).toMatch(
      /if \(ws\.readyState !== WebSocket\.OPEN\) \{[\s\S]*?pendingWrites\.push\(text\)/,
    );
  });

  test("flushes the buffer on open, before reporting connected", () => {
    // Order matters: the app drains its own queue as soon as it hears "connected",
    // so a flush after that post would race the app's write and lose it.
    expect(onOpenHandler).toContain("flushWrites()");
    expect(onOpenHandler.indexOf("flushWrites()")).toBeLessThan(
      onOpenHandler.indexOf('post("connected")'),
    );
    // `post("connected")` has to be there at all, or the ordering check above
    // would compare against -1 and pass on a handler that never reports.
    expect(onOpenHandler).toContain('post("connected")');
  });

  test("sends immediately once the socket is open", () => {
    // The fast path — a queued write must not sit in the buffer.
    expect(writeHook).toMatch(
      /if \(ws\.readyState !== WebSocket\.OPEN\) \{[\s\S]*?\}\s*ws\.send\(text\)/,
    );
  });

  test("sends each buffered write exactly once", () => {
    // `shift()` in a loop, not a forEach: a forEach over a mutating array skips
    // elements, which would silently drop every other queued command.
    const flush = shell.slice(
      shell.indexOf("function flushWrites"),
      shell.indexOf("ws.onopen = function"),
    );
    expect(flush).toContain("pendingWrites.shift()");
    expect(flush).toContain("while (pendingWrites.length > 0)");
    expect(flush).not.toContain("forEach");
  });

  test("keeps the theme hook the panel already depends on", () => {
    // Regression guard: "Run in terminal" was added alongside this hook, and a
    // rewrite that dropped or renamed one would silently lose the other's
    // scrollback. The name, not just an assignment — `= null` keeps the name and
    // still breaks `TerminalPanel`'s injected repaint.
    expect(shell).toContain("window.__TERMINAL_APPLY_THEME__ = applyTheme;");
  });
});
