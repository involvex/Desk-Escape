import type {
  FormAnswer,
  FormDetail,
  FormField,
  FormInfo,
  FormValue,
  FormWhen,
  OpenCodeClient,
  V2Event,
} from "@opencode/client";

import { withOpenCodeErrors } from "./opencode/errors";
import { withLocation } from "./opencode/location";

export type {
  FormAnswer,
  FormDetail,
  FormField,
  FormInfo,
  FormValue,
  FormWhen,
};

/**
 * What the agent is asking for.
 *
 * V1 had a bespoke `/question` subsystem with a rigid
 * `[{ question, options, multiple, custom }]` shape. V2 deletes all of it and
 * replaces it with a generic Form: a heterogeneous, ordered `fields` list where
 * each field carries its own type, constraints and visibility conditions.
 */
export interface PendingForm {
  id: string;
  sessionId: string;
  title: string;
  metadata: Record<string, unknown> | undefined;
  fields: FormField[];
  receivedAt: string;
}

/** V1 `QuestionOption.label` maps onto V2's `{ value, label }` option pair. */
export interface FormChoice {
  value: string;
  label: string;
  description?: string;
}

function toPendingForm(
  info: Partial<FormInfo> & Pick<FormInfo, "id" | "sessionID">,
  receivedAt = new Date().toISOString(),
): PendingForm {
  return {
    id: info.id,
    sessionId: info.sessionID,
    title: info.title ?? "Agent request",
    metadata: info.metadata,
    fields: info.fields ? [...info.fields] : [],
    receivedAt,
  };
}

/**
 * Read a `form.created` event.
 *
 * The payload is the documented V2 shape, so it is read directly; ids still
 * fall back to `""` and a form missing either id is dropped rather than thrown.
 */
export function parseFormEvent(event: V2Event): PendingForm | null {
  if (event.type !== "form.created") {
    return null;
  }
  const form = (event.data as { form?: Partial<FormInfo> } | undefined)?.form;
  if (!form) {
    return null;
  }

  const id = form.id ?? "";
  const sessionId = form.sessionID ?? "";
  if (!id || !sessionId) {
    return null;
  }

  return toPendingForm({ ...form, id, sessionID: sessionId });
}

/**
 * Identify the form a terminal `form.replied` / `form.cancelled` event closes.
 *
 * V2 has no `question.rejected`: a form leaves the pending list via either
 * `form.replied` or `form.cancelled`, so both close it.
 */
export function parseFormResolvedEvent(event: V2Event): { id: string } | null {
  if (event.type !== "form.replied" && event.type !== "form.cancelled") {
    return null;
  }
  const data = event.data as { id?: string } | undefined;
  const id = data?.id ?? "";
  return id ? { id } : null;
}

/** `true` when the form is waiting on the user. */
export function isPendingForm(event: V2Event): boolean {
  return event.type === "form.created";
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** The options a field offers, if it is a choice at all. */
export function fieldOptions(field: FormField): FormChoice[] {
  if (field.type !== "multiselect" && field.type !== "string") {
    return [];
  }
  const options = field.options ?? [];
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    ...(option.description ? { description: option.description } : {}),
  }));
}

/** `true` when the field accepts free text alongside its options. */
export function fieldAllowsCustom(field: FormField): boolean {
  if (field.type !== "multiselect" && field.type !== "string") {
    return false;
  }
  return field.custom === true;
}

function conditionHolds(when: FormWhen, answer: FormAnswer): boolean {
  const current = answer[when.key];
  // The two guards below are currently unreachable, and kept deliberately.
  //
  // `FormWhen.value` is a scalar (`string | number | boolean | "Infinity" | …`),
  // so `Array.isArray(current)` and `current === undefined` both already imply
  // `current === when.value` is false. A mutation that deletes the ternary
  // entirely passes the whole suite, because it changes no behaviour.
  //
  // They are retained because `FormValue` *does* allow `Array<string>`, so the
  // answer side is array-capable and only the `value` side keeps this safe. If a
  // future SDK widens `FormWhen.value` to accept an array, these guards stop
  // being dead and start being load-bearing — at which point removing them would
  // silently make a multiselect answer comparable by reference.
  const matches =
    Array.isArray(current) || current === undefined
      ? false
      : current === when.value;
  return when.op === "neq" ? !matches : matches;
}

/**
 * Visibility of a field, evaluated against the answers collected so far.
 *
 * All `when` clauses must hold (logical AND), and a field is visible when it
 * has no clauses at all. `hidden: true` always wins.
 *
 * `external` fields are the one variant that carries neither flag — they are
 * always shown, because they point at something the user has to visit.
 */
export function isFieldVisible(field: FormField, answer: FormAnswer): boolean {
  if (field.type === "external") {
    return true;
  }
  if (field.hidden) {
    return false;
  }
  if (!field.when || field.when.length === 0) {
    return true;
  }
  return field.when.every((when) => conditionHolds(when, answer));
}

/** The fields that should currently be rendered, in declaration order. */
export function visibleFields(
  fields: readonly FormField[],
  answer: FormAnswer,
): FormField[] {
  return fields.filter((field) => isFieldVisible(field, answer));
}

function isEmptyValue(value: FormValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Seed an answer map from the field defaults, so conditional fields start from
 * the value the form author intended rather than from `undefined`.
 *
 * An `external` field is seeded `false` rather than omitted. There is no default
 * to read, but the key has to be *present* so the banner can render a controlled
 * acknowledgement toggle against it, and the server rejects the entire reply
 * unless every external field is acknowledged:
 *
 *     FormInvalidAnswerError: External form field must be acknowledged: <key>
 *
 * `false` is the unacknowledged state, not an answer. Only `true` is accepted --
 * verified against a live server, where `false`, `"yes"` and `1` are all refused
 * with the same error as omitting the key.
 */
export function initialAnswer(fields: readonly FormField[]): FormAnswer {
  const answer: FormAnswer = {};
  for (const field of fields) {
    if (field.type === "external") {
      answer[field.key] = false;
      continue;
    }
    const fallback = (field as { default?: FormValue }).default;
    if (fallback !== undefined) {
      answer[field.key] = fallback;
    }
  }
  return answer;
}

/**
 * Is this field still awaiting an answer?
 *
 * Split out from `isEmptyValue` because `false` means opposite things for the two
 * kinds of field. For a boolean field `false` is a legitimate answer -- "No" is an
 * answer, and reporting it as missing is the bug this split avoids. For an
 * `external` field `false` means the user has not visited the link yet, which is
 * exactly the state the server refuses.
 */
function isUnanswered(field: FormField, answer: FormAnswer): boolean {
  if (field.type === "external") {
    return answer[field.key] !== true;
  }
  return isEmptyValue(answer[field.key]);
}

/**
 * Validate the visible fields against `required`.
 *
 * An `external` field counts as required whether or not it says so: the server
 * demands the acknowledgement unconditionally, so a form carrying one cannot be
 * submitted until the user confirms they visited the link. Without this the only
 * signal was a server rejection after the fact, naming a field the UI had
 * presented as optional and offered no control for.
 *
 * @returns the keys that are required, visible, and still empty.
 */
export function missingRequiredKeys(
  fields: readonly FormField[],
  answer: FormAnswer,
): string[] {
  return fields
    .filter((field) => field.type === "external" || field.required === true)
    .filter((field) => isFieldVisible(field, answer))
    .filter((field) => isUnanswered(field, answer))
    .map((field) => field.key);
}

/**
 * Validate `minItems` / `maxItems` on a multiselect field.
 *
 * @returns the offending field keys.
 */
export function multiselectConstraintViolations(
  fields: readonly FormField[],
  answer: FormAnswer,
): string[] {
  const violations: string[] = [];
  for (const field of fields) {
    if (field.type !== "multiselect") continue;
    if (!isFieldVisible(field, answer)) continue;
    const count = Array.isArray(answer[field.key])
      ? (answer[field.key] as string[]).length
      : 0;
    // One push per field, not one per breached bound. A field with `minItems: 3`
    // and `maxItems: 1` can breach both at once, and the caller renders this list
    // as "pick at least 3, at most 1" — listing the key twice showed the same
    // field's error twice.
    const tooFew = field.minItems !== undefined && count < field.minItems;
    const tooMany = field.maxItems !== undefined && count > field.maxItems;
    if (tooFew || tooMany) {
      violations.push(field.key);
    }
  }
  return violations;
}

/**
 * Coerce raw text into a number for a `number` / `integer` field.
 *
 * Unparseable input is returned as text rather than discarded, so the field can
 * show the user what they typed instead of silently blanking.
 *
 * The wire format also allows `"Infinity"` / `"-Infinity"` sentinels, which
 * `Number()` produces for those literals and which pass through as numbers.
 * `"NaN"` does not: `Number("NaN")` is NaN, so the NaN branch returns the
 * literal string `"NaN"` instead. That is deliberate — a NaN *number* is not
 * representable in a text input, and the server parses the literal either way.
 */
export function coerceNumber(raw: string): number | string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return "";
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? trimmed : parsed;
}

/** The label shown for a field, falling back to its key. */
export function fieldLabel(field: FormField): string {
  return field.title?.trim() || field.key;
}

/** How many numeric fields expect integral input (drives the keyboard type). */
export function isNumericField(field: FormField): boolean {
  return field.type === "number" || field.type === "integer";
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** Pending forms for the active location, as `{ location, data }`. */
export async function listPendingForms(
  client: OpenCodeClient,
  directory?: string | null,
): Promise<PendingForm[]> {
  const result = await withOpenCodeErrors(() =>
    client.form.list(withLocation(directory)),
  );
  return result.data.map((info) => toPendingForm(info));
}

/**
 * How often the foreground, connected client re-reads the pending list as a
 * safety net for `form.created` events that the WebSocket could not deliver --
 * for example a form raised while the app was backgrounded and the JS thread
 * suspended. This mirrors the existing health-ping cadence (see `use-reconnect`
 * §3.4: 30 s) rather than inventing a new number to reason about. It is only a
 * backstop; the live event stream is still the primary delivery path.
 */
export const FORM_POLL_INTERVAL_MS = 30_000;

/**
 * Merge a freshly-polled pending list into the in-memory one.
 *
 * This is the safety-critical rule: a poll must never clobber a form the user
 * is already looking at. If the banner is showing `pending`, that form stays,
 * regardless of what the server returns; a different form that the event stream
 * failed to deliver while the app was backgrounded is a known, acceptable loss
 * for this backstop (the stream picks it up on the next foreground connect),
 * whereas replacing an in-progress answer with a poll result would be data loss.
 *
 * Otherwise, the first polled form surfaces (matching the cold-start read, which
 * also takes `items[0]`).
 */
export function selectPolledForm(
  current: PendingForm | null,
  polled: PendingForm[],
): PendingForm | null {
  return current ?? polled[0] ?? null;
}

/**
 * One backstop poll: re-read the pending list and fold it into `current` via
 * `selectPolledForm`.
 *
 * Wraps `listPendingForms` so a transient failure -- the server is briefly
 * unreachable, or backgrounded-suspension left a stale token -- does not tear the
 * banner down. That mirrors the cold-start read, which also swallows; the event
 * stream still carries anything created from here on.
 */
export async function pollForms(
  client: OpenCodeClient,
  directory: string | null | undefined,
  current: PendingForm | null,
): Promise<PendingForm | null> {
  try {
    const polled = await listPendingForms(client, directory);
    return selectPolledForm(current, polled);
  } catch {
    return current;
  }
}

/** Pending forms for one session. */
export async function listSessionForms(
  client: OpenCodeClient,
  sessionId: string,
): Promise<PendingForm[]> {
  const result = await withOpenCodeErrors(() =>
    client.session.form.list({ sessionID: sessionId }),
  );
  return result.map((info) => toPendingForm(info));
}

/** Fetch a single form, including its current state / existing answers. */
export async function getForm(
  client: OpenCodeClient,
  input: { sessionId: string; formId: string },
): Promise<FormDetail> {
  return withOpenCodeErrors(() =>
    client.session.form.get({
      sessionID: input.sessionId,
      formID: input.formId,
    }),
  );
}

/**
 * Submit answers.
 *
 * The answer is a `{ fieldKey: value }` map, not V1's positional
 * `string[][]`. Resolves to `undefined`: the server answers `204 No Content`.
 */
export async function replyToForm(
  client: OpenCodeClient,
  input: { sessionId: string; formId: string; answer: FormAnswer },
): Promise<void> {
  await withOpenCodeErrors(() =>
    client.session.form.reply({
      sessionID: input.sessionId,
      formID: input.formId,
      answer: input.answer,
    }),
  );
}

/**
 * Take a form off the pending list without answering it.
 *
 * V2 has **no** form-reject endpoint — `question.reject` died with the rest of
 * `/question`. `session.form.cancel` is the closest thing and is the closest
 * match in meaning too: it tells the server the user declined to fill the form
 * in, which lets the agent unblock instead of hanging on a question nobody can
 * answer.
 *
 * Resolves to `undefined`: the server answers `204 No Content`.
 */
export async function cancelForm(
  client: OpenCodeClient,
  input: { sessionId: string; formId: string; message?: string },
): Promise<void> {
  await withOpenCodeErrors(() =>
    client.session.form.cancel({
      sessionID: input.sessionId,
      formID: input.formId,
      ...(input.message ? { message: input.message } : {}),
    }),
  );
}
