import { describe, expect, test } from "bun:test";

import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";
import { clipboardWrites, setClipboardFailure } from "@/testing/clipboard-stub";
import { takeAlertCalls, type AlertCall } from "@/testing/react-native-stub";
import {
  renderWithContext,
  renderWithProviders,
  type RenderResult,
} from "@/testing/harness";
import type { ChatMessage } from "@/types/domain";

/**
 * The message action sheet.
 *
 * Long press used to copy the message outright, which left no room for a second
 * action — and "Fork from here" needs one. What matters here is that the sheet
 * offers exactly the actions that apply to the message it belongs to, that the fork
 * button explains the cut before it runs, and that copy still reports success only
 * when the write landed.
 */

const FORK_SUMMARY =
  "Forks before this message, keeping 2 earlier messages. " +
  "This message and everything after it stay in the original.";

function message(role: "user" | "assistant", text: string): ChatMessage {
  return {
    info: {
      id: `msg_${role}`,
      role,
      kind: role === "user" ? "user" : "assistant",
      time: { created: 0 },
    },
    parts: text ? [{ id: `prt_${role}`, type: "text", text }] : [],
  } as unknown as ChatMessage;
}

type SheetButton = { text?: string; onPress?: () => void; style?: string };

/** An opened sheet, with the alerts it produced already drained from the stub. */
interface Sheet {
  /** The alert's message body, or `undefined` when it had none. */
  message: string | undefined;
  /** Button labels, in the order the sheet offers them. */
  labels: string[];
  /** Press a button by label. A missing label is a no-op, so a test can assert on
   * `labels` rather than on a throw from deep inside a helper. */
  press: (label: string) => Promise<void>;
}

/** Render one bubble and report what its long press did. */
async function render(
  msg: ChatMessage,
  props: Record<string, unknown> = {},
): Promise<{ result: RenderResult; forked: string[] }> {
  const forked: string[] = [];
  takeAlertCalls();
  const result = await renderWithProviders(
    <ChatMessageBubble
      collapseResetKey="default-default-default"
      defaultCollapsed
      message={msg}
      onFork={(id: string) => forked.push(id)}
      thinkingDefaultCollapsed
      {...props}
    />,
  );
  return { result, forked };
}

/**
 * Long-press the bubble and read the sheet it opened.
 *
 * `null` when the long press did nothing at all, which is the case worth
 * distinguishing from a sheet that merely happens to be empty.
 */
async function openSheet(result: RenderResult): Promise<Sheet | null> {
  const bubble = result.find("Pressable");
  if (typeof bubble.props.onLongPress !== "function") {
    return null;
  }
  bubble.props.onLongPress();
  await result.flush();

  const alerts = takeAlertCalls();
  if (alerts.length === 0) {
    return null;
  }
  return sheetOf(alerts[0]!);
}

/** Build a `Sheet` from a recorded alert. */
function sheetOf(alert: AlertCall): Sheet {
  const buttons = (alert.buttons ?? []) as SheetButton[];
  return {
    message: alert.message,
    labels: buttons.map((button) => String(button.text)),
    press: async (label: string) => {
      await buttons.find((button) => button.text === label)?.onPress?.();
      // Both handlers are async — copy writes to the pasteboard before it confirms,
      // and a fork callback may kick off a request — so give them a turn before the
      // caller asserts on what they did.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("ChatMessageBubble action sheet", () => {
  test("an assistant message offers copy and nothing else", async () => {
    const { result } = await render(
      message("assistant", "Here is the answer."),
    );
    const sheet = await openSheet(result);

    expect(sheet?.labels).toEqual(["Copy", "Cancel"]);
    result.unmount();
  });

  test("a user message has no long press at all", async () => {
    // The prompt the user just typed is still in the composer, and until there is a
    // fork point there is nothing else to offer — so the gesture does nothing rather
    // than opening an alert whose only button is Cancel.
    const { result } = await render(message("user", "Fix the parser."));

    expect(await openSheet(result)).toBeNull();
    result.unmount();
  });

  test("a user message offers a branch when there is a fork point", async () => {
    const { result } = await render(message("user", "Fix the parser."), {
      forkSummary: FORK_SUMMARY,
    });
    const sheet = await openSheet(result);

    // Copy is deliberately absent for the user's own prompt.
    expect(sheet?.labels).toEqual(["Fork from here", "Cancel"]);
    result.unmount();
  });

  test("an assistant message offers both", async () => {
    const { result } = await render(
      message("assistant", "Here is the answer."),
      {
        forkSummary: FORK_SUMMARY,
      },
    );
    const sheet = await openSheet(result);

    expect(sheet?.labels).toEqual(["Copy", "Fork from here", "Cancel"]);
    result.unmount();
  });

  test("the sheet explains what the branch keeps before it runs", async () => {
    // The reason a sheet rather than a direct action: which side of the cut each
    // message lands on is a reading of the API's `before` parameter, and the user
    // sees that while there is still nothing to undo.
    const { result } = await render(message("user", "Fix the parser."), {
      forkSummary: FORK_SUMMARY,
    });

    expect((await openSheet(result))?.message).toBe(FORK_SUMMARY);
    result.unmount();
  });

  test("no summary means no branch, rather than a silent one", async () => {
    // `onFork` without `forkSummary` is a wiring mistake. Branching anyway would
    // create a session at an anchor the user was never told about.
    const { result } = await render(message("user", "Fix the parser."));

    expect(await openSheet(result)).toBeNull();
    result.unmount();
  });

  test("the branch button reports the message it belongs to", async () => {
    const { result, forked } = await render(
      message("assistant", "Here is the answer."),
      { forkSummary: FORK_SUMMARY },
    );
    const sheet = await openSheet(result);
    await sheet?.press("Fork from here");

    // This message's id, not the newest one — anchoring on the wrong message would
    // branch from somewhere else in the conversation entirely.
    expect(forked).toEqual(["msg_assistant"]);
    result.unmount();
  });

  test("the sheet follows the conversation as it grows", async () => {
    // The memo comparator is the only thing standing between a re-render and a stale
    // bubble, and its failure is invisible in a single render: the sheet keeps
    // describing the cut as it was when the message was first drawn. A user
    // branching three turns later would read "keeping 2 earlier messages" with no way
    // to tell it was out of date.
    //
    // The *same* tree has to be re-rendered — two mounts would each render fresh and
    // the comparator would never be consulted.
    let summary = "Forks before this message, keeping 2 earlier messages.";
    const msg = message("user", "Fix the parser.");

    const result = await renderWithContext(() => (
      <ChatMessageBubble
        collapseResetKey="default-default-default"
        defaultCollapsed
        forkSummary={summary}
        message={msg}
        onFork={() => {}}
        thinkingDefaultCollapsed
      />
    ));

    expect((await openSheet(result))?.message).toContain("keeping 2 earlier");

    summary = "Forks before this message, keeping 9 earlier messages.";
    await result.rerender();

    expect((await openSheet(result))?.message).toContain("keeping 9 earlier");
    result.unmount();
  });

  test("cancel leaves the conversation and the clipboard alone", async () => {
    const { result, forked } = await render(
      message("assistant", "Here is the answer."),
      { forkSummary: FORK_SUMMARY },
    );
    const sheet = await openSheet(result);
    await sheet?.press("Cancel");

    expect(forked).toEqual([]);
    expect(clipboardWrites()).toEqual([]);
    result.unmount();
  });

  describe("copy", () => {
    test("writes the message text", async () => {
      const { result } = await render(
        message("assistant", "Here is the answer."),
      );
      const sheet = await openSheet(result);
      await sheet?.press("Copy");

      expect(clipboardWrites()).toEqual(["Here is the answer."]);
      result.unmount();
    });

    test("confirms only after the write landed", async () => {
      // `copyToClipboard` resolves false when the write is rejected, and that is
      // the whole reason it returns a boolean. Reporting "Copied" anyway is the
      // failure it exists to prevent: the user pastes and gets the old contents
      // with nothing to explain why.
      const { result } = await render(
        message("assistant", "Here is the answer."),
      );
      const sheet = await openSheet(result);
      takeAlertCalls();

      await sheet?.press("Copy");

      expect(takeAlertCalls()).toEqual([
        {
          title: "Copied",
          message: "Message copied to clipboard",
          buttons: undefined,
        },
      ]);
      result.unmount();
    });

    test("says nothing when the write did not land", async () => {
      const { result } = await render(
        message("assistant", "Here is the answer."),
      );
      const sheet = await openSheet(result);
      // Forced *after* the render: `mount` resets the clipboard stub, so setting it
      // beforehand would be undone before the sheet was even opened.
      setClipboardFailure(new Error("denied"));
      takeAlertCalls();

      await sheet?.press("Copy");

      // The write was attempted — the failure is reported by silence, not by
      // pretending the copy never happened.
      expect(clipboardWrites()).toEqual(["Here is the answer."]);
      expect(takeAlertCalls()).toEqual([]);
      result.unmount();
    });
  });
});
