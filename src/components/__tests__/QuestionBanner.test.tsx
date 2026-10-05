import { describe, expect, test } from "bun:test";

import { QuestionBanner } from "@/components/QuestionBanner";
import type { PendingForm } from "@/api/forms";
import type { FormField } from "@opencode/client";
import { questionCallLog } from "@/testing/context-holds";
import { renderWithProviders, type RenderResult } from "@/testing/harness";

/** A form, by default carrying one external field -- the case that broke. */
function pending(overrides: Partial<PendingForm> = {}): PendingForm {
  const base: PendingForm = {
    id: "frm_1",
    sessionId: "ses_test",
    title: "Acknowledge a dependency",
    metadata: undefined,
    receivedAt: "2026-01-01T00:00:00.000Z",
    fields: [
      {
        key: "runbook",
        type: "external",
        title: "Runbook",
        url: "https://example.invalid/runbook",
      } as FormField,
    ],
  };
  return { ...base, ...overrides };
}

async function render(state: {
  pending: PendingForm | null;
}): Promise<RenderResult> {
  return renderWithProviders(<QuestionBanner />, {
    question: {
      pending: state.pending,
      busy: false,
      error: null,
    },
  });
}

describe("QuestionBanner", () => {
  test("renders nothing when no form is pending", async () => {
    const result = await render({ pending: null });
    expect(result.text()).toBe("");
    expect(result.byType("Pressable")).toHaveLength(0);
    result.unmount();
  });

  test("renders the title and the external field as a link plus an acknowledgement", async () => {
    // A link alone is how this field looked before the fix -- and a link alone
    // is precisely what made the form unsubmittable, since nothing wrote the
    // `true` the server requires.
    const result = await render({ pending: pending() });
    const text = result.text();
    expect(text).toContain("Acknowledge a dependency");
    expect(text).toContain("https://example.invalid/runbook");
    expect(text).toContain("I have read this");
    expect(text).toContain("Not yet");
    result.unmount();
  });

  test("submit is blocked while an external field is unacknowledged", async () => {
    // This is the regression: the submit gate used to let the payload through
    // because the external field was treated as optional, and the server then
    // rejected it after the fact with no pointer the user could act on.
    const result = await render({ pending: pending() });
    await result.act(async () => {
      await result.pressExact("Submit");
    });
    expect(questionCallLog().reply).toHaveLength(0);
    expect(result.text()).toContain("Please answer");
    expect(result.text()).toContain("Runbook");
    result.unmount();
  });

  test("an unacknowledged external field is sent as true once the user confirms it", async () => {
    // The core of the bug. Ticking "I have read this" must write `true`, and the
    // payload the banner hands to the context must carry `runbook: true`. A test
    // that only checked `questionCallLog().reply.length === 1` would pass equally
    // well if the payload still omitted the key, which is exactly how the defect
    // survived: `forms.ts` was correct while the component dropped the key on the
    // floor.
    const result = await render({ pending: pending() });

    await result.act(async () => {
      await result.pressExact("I have read this");
    });
    await result.act(async () => {
      await result.pressExact("Submit");
    });

    expect(questionCallLog().reply).toEqual([{ runbook: true }]);
    result.unmount();
  });

  test("a boolean field answered No still submits false", async () => {
    // The case the split into `isUnanswered` exists to protect. `false` is a real
    // answer for a boolean -- "No" -- and it must reach the server the same way
    // `true` does; fixing the external field must not turn every boolean into a
    // required-yes question.
    const form = pending({
      fields: [
        {
          key: "newsletter",
          type: "boolean",
          title: "Send the newsletter?",
          default: true,
        } as FormField,
      ],
    });
    const result = await render({ pending: form });

    await result.act(async () => {
      await result.pressExact("No");
    });
    await result.act(async () => {
      await result.pressExact("Submit");
    });

    expect(questionCallLog().reply).toEqual([{ newsletter: false }]);
    result.unmount();
  });
});
