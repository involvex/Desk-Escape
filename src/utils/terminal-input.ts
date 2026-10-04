/**
 * "Run in terminal" — the pieces that decide *what* gets written and *when*.
 *
 * ## Why this cannot be an HTTP call
 *
 * `pty` has no `write` method. The namespace is `list`, `create`, `get`,
 * `update`, `remove` and `connect.token` — writing to a PTY happens only over the
 * WebSocket, and that socket is owned by the terminal WebView (it authenticates
 * with a short-lived ticket in the URL, which is why it lives there). So a write
 * from the chat has to be relayed through the WebView, exactly as
 * `__TERMINAL_APPLY_THEME__` already relays a theme change.
 *
 * ## The ordering problem that creates
 *
 * The panel unmounts on every tab switch, so at the moment "Run" is tapped there
 * is usually no WebView and no socket. The write cannot simply be fired and
 * forgotten — it has to survive until the socket comes up, and it must be
 * delivered *exactly once*. Running a command twice because a reconnect re-drained
 * a queue is the failure mode worth designing against, so the queue is modelled
 * here as a value and drained destructively.
 *
 * Pure and dependency-free so the framing and the queue can be tested without a
 * WebView, a server, or a terminal.
 */

/**
 * Whether a fenced code block is worth offering "Run" on.
 *
 * The Run button used to appear on every code block and call `session.command`
 * with the code as a *command name*, which is why it could never work:
 * `session.command` runs named slash commands, not arbitrary text. Now that the
 * text goes to a real shell, showing the button on a JSON or TypeScript block
 * would just produce a syntax error in the user's terminal.
 *
 * Shell family only, deliberately. Offering `python` here would mean guessing an
 * interpreter invocation for an arbitrary snippet, and getting that wrong is
 * worse than not offering the button.
 */
const RUNNABLE_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "fish",
  "ksh",
  "console",
  "shellsession",
  "terminal",
  "cmd",
  "batch",
  "powershell",
  "ps1",
]);

/**
 * Whether to show the Run affordance for a code block language.
 *
 * An absent or empty language is **not** runnable: an unlabelled block is more
 * likely to be a fragment of something else, and writing it into a shell is a
 * guess the user did not ask to make. Whitespace and case are normalised because
 * fence info strings are user-written.
 */
export function isRunnableLanguage(
  language: string | null | undefined,
): boolean {
  // A missing language normalises to `""`, which is simply not in the set. An
  // earlier explicit `if (!normalized) return false;` here survived mutation
  // testing — nothing pinned it, because it changed nothing.
  return RUNNABLE_LANGUAGES.has(language?.trim().toLowerCase() ?? "");
}

/** Options for framing text for a shell. */
export interface TerminalInputOptions {
  /**
   * Append the newline that submits the line. Default `true`.
   *
   * Turn this off when the text is going to be typed rather than submitted. At an
   * idle prompt the shell submits on Enter, so a trailing newline here would
   * submit the command and leave an empty prompt line — and pressing Enter again
   * on that line runs whatever the last command was, a second time. Tapping "Run"
   * on a block already in the terminal must therefore type, not submit.
   */
  newline?: boolean;
}

/**
 * Frame text for submission to a shell.
 *
 * A terminal does not execute on write — it executes on the newline that submits
 * the line. So by default exactly one trailing newline is appended, and only if
 * the text does not already end with one: appending unconditionally would leave
 * the shell on an empty prompt line, which looks like the command failed to
 * arrive.
 *
 * Leading blank lines are trimmed for the same reason — they would submit an
 * empty line before the command. Trailing *internal* blank lines are left alone,
 * because they may be significant inside a quoted block.
 */
export function toTerminalInput(
  text: string,
  options: TerminalInputOptions = {},
): string {
  const trimmed = text.replace(/^\n+/, "").replace(/\s+$/, "");
  if (trimmed.length === 0) {
    return "";
  }
  return options.newline === false ? trimmed : `${trimmed}\n`;
}

/**
 * Confirmation shown after queued writes reach a shell.
 *
 * Deliberately not a bare count: "1 command sent" reads like a receipt, and the
 * point is that something the user asked for actually ran somewhere they could not
 * see.
 */
export function terminalDeliveryLabel(count: number): string {
  if (count <= 0) {
    return "";
  }
  return count === 1
    ? "Command sent to terminal"
    : `${count} commands sent to terminal`;
}

/** A write waiting for the socket. */
export interface PendingWrite {
  /** Monotonic id, so a duplicate can be recognised rather than run twice. */
  id: number;
  text: string;
  /** Directory the write was requested for, so a shell switch can drop it. */
  directory: string | null;
}

/**
 * Writes queued while no socket is up.
 *
 * A plain value with one operation: `drain` returns everything and leaves the
 * queue empty, because there is no other consumer that could re-read it. A queue
 * that could be read twice would eventually run a command twice.
 */
export interface WriteQueue {
  pending: PendingWrite[];
  /** Highest id issued so far. */
  nextId: number;
}

export const emptyWriteQueue: WriteQueue = { pending: [], nextId: 1 };

/**
 * Queue a write for a directory.
 *
 * Empty or whitespace-only text is dropped rather than queued: submitting a blank
 * line would scroll the terminal and tell the user nothing.
 */
export function enqueueWrite(
  queue: WriteQueue,
  text: string,
  directory: string | null,
): WriteQueue {
  const framed = toTerminalInput(text);
  if (framed === "") {
    return queue;
  }
  return {
    pending: [...queue.pending, { id: queue.nextId, text: framed, directory }],
    nextId: queue.nextId + 1,
  };
}

/**
 * Take everything queued for this directory, leaving the queue empty.
 *
 * Filtered by directory because a shell belongs to one location: a write
 * requested for the previous project must not execute in the new one.
 *
 * Destructively — the returned array is removed from the queue as it is returned,
 * so a second call cannot replay it.
 */
export function drainWrites(
  queue: WriteQueue,
  directory: string | null,
): { queue: WriteQueue; writes: PendingWrite[] } {
  const writes = queue.pending.filter((write) => write.directory === directory);
  if (writes.length === 0) {
    return { queue, writes };
  }
  const taken = new Set(writes.map((write) => write.id));
  return {
    queue: {
      nextId: queue.nextId,
      pending: queue.pending.filter((write) => !taken.has(write.id)),
    },
    writes,
  };
}

/** Drop everything. Used when the shell is torn down or the user navigates away. */
export function clearWrites(queue: WriteQueue): WriteQueue {
  return { nextId: queue.nextId, pending: [] };
}
