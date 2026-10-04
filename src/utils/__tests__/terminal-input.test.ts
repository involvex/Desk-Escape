import { describe, expect, test } from "bun:test";

import {
  clearWrites,
  drainWrites,
  emptyWriteQueue,
  enqueueWrite,
  isRunnableLanguage,
  terminalDeliveryLabel,
  toTerminalInput,
  type WriteQueue,
} from "@/utils/terminal-input";

/**
 * Tests for the "Run in terminal" bridge.
 *
 * The failure this guards is running a command in the user's shell twice, and
 * the failure that looks most like a feature is a Run button on a JSON block.
 * Neither throws, so they are only catchable by asserting the values directly.
 */

// ---------------------------------------------------------------------------
// isRunnableLanguage
// ---------------------------------------------------------------------------

describe("isRunnableLanguage", () => {
  test("accepts the shell family", () => {
    for (const language of [
      "bash",
      "sh",
      "shell",
      "zsh",
      "fish",
      "console",
      "shellsession",
      "powershell",
    ]) {
      expect(isRunnableLanguage(language)).toBe(true);
    }
  });

  test("normalises case and surrounding whitespace", () => {
    // Fence info strings are user-written, so ```  BASH  ``` is common.
    expect(isRunnableLanguage("  BASH  ")).toBe(true);
    expect(isRunnableLanguage("Shell")).toBe(true);
  });

  test("rejects languages a shell cannot run", () => {
    for (const language of [
      "json",
      "typescript",
      "tsx",
      "python",
      "rust",
      "sql",
      "yaml",
      "html",
    ]) {
      expect(isRunnableLanguage(language)).toBe(false);
    }
  });

  test("rejects an unlabelled block", () => {
    // An unlabelled block is more likely a fragment of something else, and
    // writing it into a shell is a guess the user did not ask to make.
    expect(isRunnableLanguage(undefined)).toBe(false);
    expect(isRunnableLanguage("")).toBe(false);
    expect(isRunnableLanguage("   ")).toBe(false);
  });

  test("is not fooled by a shell name inside another word", () => {
    expect(isRunnableLanguage("bashful")).toBe(false);
    expect(isRunnableLanguage("shellcheck")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toTerminalInput
// ---------------------------------------------------------------------------

describe("toTerminalInput", () => {
  test("appends the newline that submits the line", () => {
    // A terminal executes on the newline, not on the write.
    expect(toTerminalInput("npm test")).toBe("npm test\n");
  });

  test("does not add a second newline", () => {
    // A blank prompt line afterwards reads as "the command did not arrive".
    expect(toTerminalInput("npm test\n")).toBe("npm test\n");
    expect(toTerminalInput("npm test\n\n\n")).toBe("npm test\n");
  });

  test("trims trailing whitespace that is not a newline", () => {
    expect(toTerminalInput("npm test   ")).toBe("npm test\n");
    expect(toTerminalInput("npm test\r\n")).toBe("npm test\n");
  });

  test("strips leading blank lines that would submit an empty command", () => {
    expect(toTerminalInput("\n\nnpm test")).toBe("npm test\n");
    expect(toTerminalInput("\n")).toBe("");
  });

  test("returns nothing for blank input rather than a bare newline", () => {
    // Submitting a blank line scrolls the terminal and tells the user nothing.
    expect(toTerminalInput("")).toBe("");
    expect(toTerminalInput("   ")).toBe("");
    expect(toTerminalInput("\n\n")).toBe("");
  });

  test("keeps blank lines inside the command", () => {
    // They may be significant inside a quoted block.
    expect(toTerminalInput('echo "a\n\nb"')).toBe('echo "a\n\nb"\n');
  });

  test("preserves multi-line scripts", () => {
    const script = "set -e\nnpm ci\nnpm test";
    expect(toTerminalInput(script)).toBe("set -e\nnpm ci\nnpm test\n");
  });

  // ---------------------------------------------------------------------------
  // Typing rather than submitting
  //
  // A live shell is sitting at a prompt with the text already there. Appending the
  // submitting newline would run the command immediately and leave a blank prompt
  // line — and pressing Enter on that line re-runs it.
  // ---------------------------------------------------------------------------

  test("omits the newline when asked to type instead of submit", () => {
    expect(toTerminalInput("npm test", { newline: false })).toBe("npm test");
  });

  test("still trims a trailing newline when typing", () => {
    expect(toTerminalInput("npm test\n", { newline: false })).toBe("npm test");
    expect(toTerminalInput("npm test\r\n", { newline: false })).toBe(
      "npm test",
    );
  });

  test("refuses blank input when typing too", () => {
    expect(toTerminalInput("   ", { newline: false })).toBe("");
    expect(toTerminalInput("\n", { newline: false })).toBe("");
  });

  test("keeps a multi-line script's inner newlines when typing", () => {
    // The shell echoes them, so the user can see what is about to run.
    expect(toTerminalInput("set -e\nnpm test", { newline: false })).toBe(
      "set -e\nnpm test",
    );
  });

  test("types and submits the same text differently", () => {
    const text = "npm test";
    const typed = toTerminalInput(text, { newline: false });
    const submitted = toTerminalInput(text);
    expect(typed).toBe("npm test");
    expect(submitted).toBe("npm test\n");
    // Exactly one newline between them, and only on the submitted form.
    expect(submitted).toBe(`${typed}\n`);
  });
});

// ---------------------------------------------------------------------------
// enqueueWrite
// ---------------------------------------------------------------------------

describe("enqueueWrite", () => {
  test("queues a framed write", () => {
    const queue = enqueueWrite(emptyWriteQueue, "npm test", "/repo");
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]!.text).toBe("npm test\n");
    expect(queue.pending[0]!.directory).toBe("/repo");
  });

  test("drops blank input rather than submitting an empty line", () => {
    expect(enqueueWrite(emptyWriteQueue, "   ", "/repo").pending).toHaveLength(
      0,
    );
  });

  test("preserves order across several writes", () => {
    let queue: WriteQueue = emptyWriteQueue;
    for (const command of ["one", "two", "three"]) {
      queue = enqueueWrite(queue, command, "/repo");
    }
    expect(queue.pending.map((write) => write.text)).toEqual([
      "one\n",
      "two\n",
      "three\n",
    ]);
  });

  test("gives every write a distinct id", () => {
    let queue = enqueueWrite(emptyWriteQueue, "one", "/repo");
    queue = enqueueWrite(queue, "two", "/repo");
    const ids = queue.pending.map((write) => write.id);
    expect(new Set(ids).size).toBe(2);
  });

  test("does not mutate the input queue", () => {
    const before = enqueueWrite(emptyWriteQueue, "one", "/repo");
    enqueueWrite(before, "two", "/repo");
    expect(before.pending).toHaveLength(1);
  });

  test("keeps writes for different directories apart", () => {
    let queue = enqueueWrite(emptyWriteQueue, "old", "/old");
    queue = enqueueWrite(queue, "new", "/new");
    expect(queue.pending).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// drainWrites
// ---------------------------------------------------------------------------

describe("drainWrites", () => {
  const queued = (): WriteQueue => {
    let queue = enqueueWrite(emptyWriteQueue, "one", "/repo");
    queue = enqueueWrite(queue, "two", "/repo");
    return queue;
  };

  test("takes everything queued for this directory", () => {
    const { writes } = drainWrites(queued(), "/repo");
    expect(writes.map((write) => write.text)).toEqual(["one\n", "two\n"]);
  });

  test("empties the queue as it returns the writes", () => {
    // This is the whole point: a second drain cannot replay them, so a reconnect
    // cannot run a command twice.
    const { queue } = drainWrites(queued(), "/repo");
    expect(queue.pending).toHaveLength(0);
  });

  test("returns nothing on a second drain", () => {
    const first = drainWrites(queued(), "/repo");
    const second = drainWrites(first.queue, "/repo");
    expect(second.writes).toEqual([]);
  });

  test("does not take writes meant for another directory", () => {
    // A shell belongs to one location; a write requested for the previous project
    // must not execute in the new one.
    const { writes, queue } = drainWrites(queued(), "/elsewhere");
    expect(writes).toEqual([]);
    expect(queue.pending).toHaveLength(2);
  });

  test("takes one directory's writes and leaves the other's", () => {
    let queue = enqueueWrite(emptyWriteQueue, "mine", "/repo");
    queue = enqueueWrite(queue, "theirs", "/other");
    const result = drainWrites(queue, "/repo");
    expect(result.writes.map((write) => write.text)).toEqual(["mine\n"]);
    expect(result.queue.pending).toHaveLength(1);
    expect(result.queue.pending[0]!.directory).toBe("/other");
  });

  test("matches a null directory consistently", () => {
    const queue = enqueueWrite(emptyWriteQueue, "one", null);
    expect(drainWrites(queue, null).writes).toHaveLength(1);
    expect(drainWrites(queue, "/repo").writes).toHaveLength(0);
  });

  test("is a no-op on an empty queue", () => {
    const result = drainWrites(emptyWriteQueue, "/repo");
    expect(result.writes).toEqual([]);
    expect(result.queue.pending).toEqual([]);
  });

  test("preserves order", () => {
    let queue = emptyWriteQueue;
    for (const command of ["a", "b", "c", "d"]) {
      queue = enqueueWrite(queue, command, "/repo");
    }
    const { writes } = drainWrites(queue, "/repo");
    expect(writes.map((write) => write.text)).toEqual([
      "a\n",
      "b\n",
      "c\n",
      "d\n",
    ]);
  });
});

// ---------------------------------------------------------------------------
// clearWrites
// ---------------------------------------------------------------------------

describe("clearWrites", () => {
  test("drops everything queued", () => {
    const queue = enqueueWrite(emptyWriteQueue, "one", "/repo");
    expect(clearWrites(queue).pending).toHaveLength(0);
  });

  test("does not rewind the id counter", () => {
    // Ids must stay unique for the life of the queue, so a drained write can never
    // collide with a later one.
    const used = enqueueWrite(emptyWriteQueue, "one", "/repo");
    const after = enqueueWrite(clearWrites(used), "two", "/repo");
    expect(after.pending[0]!.id).not.toBe(used.pending[0]!.id);
  });

  test("is a no-op on an empty queue", () => {
    expect(clearWrites(emptyWriteQueue).pending).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// terminalDeliveryLabel
// ---------------------------------------------------------------------------

describe("terminalDeliveryLabel", () => {
  test("singular for one command", () => {
    expect(terminalDeliveryLabel(1)).toBe("Command sent to terminal");
  });

  test("plural for several", () => {
    expect(terminalDeliveryLabel(2)).toBe("2 commands sent to terminal");
    expect(terminalDeliveryLabel(7)).toBe("7 commands sent to terminal");
  });

  test("says nothing when nothing was delivered", () => {
    // A zero-count confirmation is a lie: it would claim a command ran.
    expect(terminalDeliveryLabel(0)).toBe("");
    expect(terminalDeliveryLabel(-1)).toBe("");
  });

  test("names the terminal, not the panel", () => {
    // The panel may not even be on screen; the shell is what ran.
    expect(terminalDeliveryLabel(1)).toContain("terminal");
  });
});
