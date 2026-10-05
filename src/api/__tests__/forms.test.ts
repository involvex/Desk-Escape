import { describe, expect, test } from "bun:test";
import type {
  FormAnswer,
  FormField,
  FormInfo,
  V2Event,
} from "@opencode/client";

import {
  coerceNumber,
  fieldAllowsCustom,
  fieldLabel,
  fieldOptions,
  initialAnswer,
  isFieldVisible,
  isNumericField,
  isPendingForm,
  missingRequiredKeys,
  multiselectConstraintViolations,
  parseFormEvent,
  parseFormResolvedEvent,
  visibleFields,
} from "@/api/forms";

/**
 * Tests for the V2 form subsystem.
 *
 * The visibility rules are the interesting part: a form is a heterogeneous list of
 * fields whose later fields depend on earlier answers, and the agent blocks until
 * the user replies. Getting `when` evaluation wrong does not throw — it hides
 * fields the agent is waiting on, or asks for ones the user cannot see, and the
 * turn hangs either way.
 */

/**
 * `FormField` is a discriminated union, so `Partial<FormField>` rejects
 * combinations that are legal at runtime — `custom` on a `number` field,
 * `hidden` on an `external` one. Overrides are taken loosely and narrowed once
 * here, which keeps each call site readable.
 */
function field(overrides: Record<string, unknown> = {}): FormField {
  return { key: "k", type: "string", ...overrides } as unknown as FormField;
}

function created(form: Partial<FormInfo>): V2Event {
  return {
    type: "form.created",
    properties: {},
    data: { form },
  } as unknown as V2Event;
}

/** Any event shape, for the negative cases. */
function event(type: string, data?: unknown): V2Event {
  return { type, data } as unknown as V2Event;
}

// ---------------------------------------------------------------------------
// parseFormEvent
// ---------------------------------------------------------------------------

describe("parseFormEvent", () => {
  const form: Partial<FormInfo> = {
    id: "form_1",
    sessionID: "ses_1",
    title: "Deploy target",
    metadata: { source: "agent" },
    fields: [field({ key: "env", type: "string" })],
  };

  test("reads a well-formed form.created", () => {
    const parsed = parseFormEvent(created(form));
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("form_1");
    expect(parsed!.sessionId).toBe("ses_1");
    expect(parsed!.title).toBe("Deploy target");
    expect(parsed!.metadata).toEqual({ source: "agent" });
    expect(parsed!.fields).toHaveLength(1);
  });

  test("copies the fields array rather than aliasing it", () => {
    // The server payload is shared with the event buffer; aliasing it would let a
    // later mutation of one form rewrite another's fields.
    const parsed = parseFormEvent(created(form))!;
    expect(parsed.fields).not.toBe(form.fields);
  });

  test("stamps a receivedAt ISO timestamp", () => {
    const parsed = parseFormEvent(created(form))!;
    expect(parsed.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(parsed.receivedAt))).toBe(false);
  });

  test("ignores unrelated event types", () => {
    expect(parseFormEvent(event("message.updated"))).toBeNull();
  });

  test("ignores a terminal event", () => {
    expect(parseFormEvent(event("form.replied", { id: "form_1" }))).toBeNull();
  });

  test("returns null when the payload has no form", () => {
    expect(parseFormEvent(event("form.created"))).toBeNull();
    expect(parseFormEvent(event("form.created", {}))).toBeNull();
  });

  test("drops a form missing either id", () => {
    // Both ids are required to reply. A form with half an identity would render a
    // prompt that could never be submitted.
    expect(
      parseFormEvent(created({ ...form, sessionID: undefined })),
    ).toBeNull();
    expect(parseFormEvent(created({ ...form, id: undefined }))).toBeNull();
    expect(parseFormEvent(created({ ...form, id: "" }))).toBeNull();
  });

  test("substitutes a default title", () => {
    expect(parseFormEvent(created({ ...form, title: undefined }))!.title).toBe(
      "Agent request",
    );
  });

  test("substitutes an empty field list", () => {
    expect(
      parseFormEvent(created({ ...form, fields: undefined }))!.fields,
    ).toEqual([]);
  });

  test("keeps metadata undefined rather than inventing an object", () => {
    expect(
      parseFormEvent(created({ ...form, metadata: undefined }))!.metadata,
    ).toBeUndefined();
  });
});

describe("parseFormResolvedEvent", () => {
  test("closes on form.replied", () => {
    expect(
      parseFormResolvedEvent(event("form.replied", { id: "form_1" })),
    ).toEqual({ id: "form_1" });
  });

  test("closes on form.cancelled", () => {
    // V2 has no `question.rejected`; both terminal events close the form.
    expect(
      parseFormResolvedEvent(event("form.cancelled", { id: "form_1" })),
    ).toEqual({ id: "form_1" });
  });

  test("ignores a form.created", () => {
    expect(
      parseFormResolvedEvent(created({ id: "f", sessionID: "s" })),
    ).toBeNull();
  });

  test("returns null without an id", () => {
    expect(parseFormResolvedEvent(event("form.replied", {}))).toBeNull();
    expect(parseFormResolvedEvent(event("form.replied"))).toBeNull();
  });
});

describe("isPendingForm", () => {
  test("only form.created is pending", () => {
    expect(isPendingForm(created({ id: "f", sessionID: "s" }))).toBe(true);
    expect(isPendingForm(event("form.replied", { id: "f" }))).toBe(false);
    expect(isPendingForm(event("session.idle"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fieldOptions / fieldAllowsCustom
// ---------------------------------------------------------------------------

describe("fieldOptions", () => {
  test("returns the options of a choice field", () => {
    expect(
      fieldOptions(
        field({
          type: "multiselect",
          options: [
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta", description: "second" },
          ],
        }),
      ),
    ).toEqual([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", description: "second" },
    ]);
  });

  test("returns an empty list for a field with no options", () => {
    expect(fieldOptions(field({ type: "string" }))).toEqual([]);
  });

  for (const type of ["boolean", "number", "integer"] as const) {
    test(`returns an empty list for a ${type} field`, () => {
      // A number field has no choices; offering any would be a rendering lie.
      expect(
        fieldOptions(field({ type, options: [{ value: "1", label: "One" }] })),
      ).toEqual([]);
    });
  }

  test("omits description when absent rather than setting undefined", () => {
    const options = fieldOptions(
      field({
        type: "string",
        options: [{ value: "a", label: "Alpha", description: undefined }],
      }),
    );
    expect(options).toEqual([{ value: "a", label: "Alpha" }]);
    expect("description" in options[0]!).toBe(false);
  });
});

describe("fieldAllowsCustom", () => {
  test("reports custom for a field that sets it", () => {
    expect(fieldAllowsCustom(field({ type: "string", custom: true }))).toBe(
      true,
    );
  });

  test("is false when custom is absent or explicitly false", () => {
    expect(fieldAllowsCustom(field({ type: "string" }))).toBe(false);
    expect(fieldAllowsCustom(field({ type: "string", custom: false }))).toBe(
      false,
    );
  });

  test("is false for a non-choice field", () => {
    expect(fieldAllowsCustom(field({ type: "number", custom: true }))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// isFieldVisible
// ---------------------------------------------------------------------------

describe("isFieldVisible", () => {
  const conditional = (op: "eq" | "neq", value: unknown) =>
    field({ when: [{ key: "env", op, value }] });

  test("a field with no conditions is visible", () => {
    expect(isFieldVisible(field({ type: "string" }), {})).toBe(true);
  });

  test("an empty condition list is visible", () => {
    expect(isFieldVisible(field({ when: [] }), {})).toBe(true);
  });

  test("an eq condition holds on a matching answer", () => {
    expect(isFieldVisible(conditional("eq", "prod"), { env: "prod" })).toBe(
      true,
    );
  });

  test("an eq condition fails on a different answer", () => {
    expect(isFieldVisible(conditional("eq", "prod"), { env: "dev" })).toBe(
      false,
    );
  });

  test("an unanswered key does not satisfy an eq condition", () => {
    expect(isFieldVisible(conditional("eq", "prod"), {})).toBe(false);
  });

  test("an array answer never satisfies an eq condition", () => {
    // A multiselect answer is an array, so it can never be `===` the scalar
    // `FormWhen.value`; the comparison is false by type, not by the explicit
    // `Array.isArray` guard (which is currently unreachable — see the comment on
    // `conditionHolds`). This pins the observable rule, not that guard.
    expect(isFieldVisible(conditional("eq", "prod"), { env: ["prod"] })).toBe(
      false,
    );
  });

  test("an eq condition compares non-string scalars too", () => {
    expect(isFieldVisible(conditional("eq", 3), { env: 3 })).toBe(true);
    expect(isFieldVisible(conditional("eq", false), { env: false })).toBe(true);
  });

  test("a neq condition is the inverse of eq", () => {
    expect(isFieldVisible(conditional("neq", "prod"), { env: "dev" })).toBe(
      true,
    );
    expect(isFieldVisible(conditional("neq", "prod"), { env: "prod" })).toBe(
      false,
    );
  });

  test("an unanswered key satisfies a neq condition", () => {
    expect(isFieldVisible(conditional("neq", "prod"), {})).toBe(true);
  });

  test("all conditions must hold", () => {
    const both = field({
      when: [
        { key: "env", op: "eq", value: "prod" },
        { key: "region", op: "eq", value: "eu" },
      ],
    });

    expect(isFieldVisible(both, { env: "prod", region: "eu" })).toBe(true);
    expect(isFieldVisible(both, { env: "prod", region: "us" })).toBe(false);
    expect(isFieldVisible(both, { env: "dev", region: "eu" })).toBe(false);
  });

  test("hidden always wins over the conditions", () => {
    const hiddenButMatching = field({
      hidden: true,
      when: [{ key: "env", op: "eq", value: "prod" }],
    });
    expect(isFieldVisible(hiddenButMatching, { env: "prod" })).toBe(false);
  });

  test("an external field is visible even when flagged hidden", () => {
    // Documented intent: `external` points at something the user has to visit, so
    // it is never suppressed — otherwise the agent would reference a step the user
    // cannot see.
    expect(isFieldVisible(field({ type: "external", hidden: true }), {})).toBe(
      true,
    );
  });

  test("an unknown operator is treated as eq", () => {
    // `FormWhen.op` is `"eq" | "neq"`, so this only happens if the server widens
    // it. Falling through to equality is the safer default.
    const unknown = field({
      when: [{ key: "env", op: "contains", value: "prod" }],
    });
    expect(isFieldVisible(unknown, { env: "prod" })).toBe(true);
    expect(isFieldVisible(unknown, { env: "dev" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// visibleFields
// ---------------------------------------------------------------------------

describe("visibleFields", () => {
  const fields = [
    field({ key: "env", type: "string" }),
    field({
      key: "replicas",
      type: "integer",
      when: [{ key: "env", op: "eq", value: "prod" }],
    }),
    field({ key: "note", type: "string", hidden: true }),
  ];

  test("returns only the visible fields, in declaration order", () => {
    // Order matters: it is the order the user answers them in, and the order
    // `initialAnswer` seeds defaults in.
    expect(visibleFields(fields, {}).map((f) => f.key)).toEqual(["env"]);
    expect(visibleFields(fields, { env: "prod" }).map((f) => f.key)).toEqual([
      "env",
      "replicas",
    ]);
  });

  test("reveals a dependent field as soon as its condition is met", () => {
    expect(visibleFields(fields, { env: "dev" }).map((f) => f.key)).toEqual([
      "env",
    ]);
    expect(visibleFields(fields, { env: "prod" }).map((f) => f.key)).toEqual([
      "env",
      "replicas",
    ]);
  });

  test("does not mutate the input", () => {
    const input = [...fields];
    visibleFields(input, { env: "prod" });
    expect(input).toHaveLength(3);
  });

  test("handles an empty form", () => {
    expect(visibleFields([], {})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// initialAnswer
// ---------------------------------------------------------------------------

describe("initialAnswer", () => {
  test("seeds defaults for fields that have them", () => {
    expect(
      initialAnswer([
        field({ key: "env", type: "string", default: "dev" }),
        field({ key: "count", type: "integer", default: 3 }),
      ]),
    ).toEqual({ env: "dev", count: 3 });
  });

  test("omits fields with no default", () => {
    const answer = initialAnswer([field({ key: "env", type: "string" })]);
    expect(answer).toEqual({});
    expect("env" in answer).toBe(false);
  });

  test("seeds an external field to false, not to its default", () => {
    // This test asserted `{}` once, on the reasoning that "seeding an answer would
    // submit a value the user never entered". That reasoning is right about the
    // *value* and wrong about the omission: the server requires every external
    // field to be acknowledged and refuses the whole reply otherwise --
    //
    //   FormInvalidAnswerError: External form field must be acknowledged: url
    //
    // -- so a map with no key for it can never be submitted. The key has to exist
    // so the banner can render a controlled toggle, and the value has to be
    // `false` because `false` is the unacknowledged state. A `default` on an
    // external field is still ignored, since only `true` is ever accepted.
    expect(
      initialAnswer([field({ key: "url", type: "external", default: "x" })]),
    ).toEqual({ url: false });
  });

  test("seeds an external field even with no default at all", () => {
    expect(initialAnswer([field({ key: "url", type: "external" })])).toEqual({
      url: false,
    });
  });

  test("seeds hidden fields too", () => {
    // Visibility is answer-dependent, so a field hidden now may become visible
    // later and should already carry its default.
    expect(
      initialAnswer([
        field({ key: "h", type: "string", hidden: true, default: "d" }),
      ]),
    ).toEqual({ h: "d" });
  });

  test("keeps a falsy default such as 0 or an empty string", () => {
    // A truthiness check would drop these; a numeric field defaulting to 0 must
    // survive.
    expect(
      initialAnswer([
        field({ key: "zero", type: "integer", default: 0 }),
        field({ key: "blank", type: "string", default: "" }),
        field({ key: "no", type: "boolean", default: false }),
      ]),
    ).toEqual({ zero: 0, blank: "", no: false });
  });

  test("a later field with the same key wins", () => {
    expect(
      initialAnswer([
        field({ key: "k", type: "string", default: "first" }),
        field({ key: "k", type: "string", default: "second" }),
      ]),
    ).toEqual({ k: "second" });
  });
});

// ---------------------------------------------------------------------------
// missingRequiredKeys
// ---------------------------------------------------------------------------

describe("missingRequiredKeys", () => {
  const required = (key: string, extra: Record<string, unknown> = {}) =>
    field({ key, type: "string", required: true, ...extra });

  test("reports an unanswered required field", () => {
    expect(missingRequiredKeys([required("env")], {})).toEqual(["env"]);
  });

  test("ignores an optional field", () => {
    expect(
      missingRequiredKeys([field({ key: "env", type: "string" })], {}),
    ).toEqual([]);
  });

  test("ignores an answered field", () => {
    expect(missingRequiredKeys([required("env")], { env: "prod" })).toEqual([]);
  });

  for (const [label, value] of [
    ["an empty string", ""],
    ["only whitespace", "   "],
    ["an empty array", []],
  ] as const) {
    test(`treats ${label} as missing`, () => {
      expect(
        missingRequiredKeys([required("k")], { k: value } as FormAnswer),
      ).toEqual(["k"]);
    });
  }

  test("treats 0 and false as answered", () => {
    // `0` and `false` are real answers. A truthiness check would block submission
    // of a form whose correct answer is zero or no.
    expect(
      missingRequiredKeys(
        [field({ key: "n", type: "integer", required: true })],
        {
          n: 0,
        },
      ),
    ).toEqual([]);
    expect(
      missingRequiredKeys(
        [field({ key: "b", type: "boolean", required: true })],
        {
          b: false,
        },
      ),
    ).toEqual([]);
  });

  test("ignores a hidden required field", () => {
    // The user cannot answer what they cannot see, so blocking on it would make
    // the form unsubmittable.
    expect(missingRequiredKeys([required("h", { hidden: true })], {})).toEqual(
      [],
    );
  });

  test("ignores a conditionally hidden required field", () => {
    const conditional = field({
      key: "replicas",
      type: "integer",
      required: true,
      when: [{ key: "env", op: "eq", value: "prod" }],
    });
    expect(missingRequiredKeys([conditional], { env: "dev" })).toEqual([]);
  });

  test("reports a conditionally visible required field once shown", () => {
    const conditional = field({
      key: "replicas",
      type: "integer",
      required: true,
      when: [{ key: "env", op: "eq", value: "prod" }],
    });
    expect(missingRequiredKeys([conditional], { env: "prod" })).toEqual([
      "replicas",
    ]);
  });

  test("reports an unacknowledged external field as required", () => {
    // The other test that encoded the bug. It asserted an external field is
    // ignored even when explicitly `required`, which is the opposite of what the
    // server does: it demands the acknowledgement whether or not the author asked
    // for it. Ignoring it here meant the only signal was a server rejection after
    // the user hit submit, naming a field the UI had shown as optional and offered
    // no control for.
    expect(
      missingRequiredKeys(
        [field({ key: "url", type: "external", required: true })],
        {},
      ),
    ).toEqual(["url"]);
  });

  test("reports an external field that was never marked required", () => {
    // The author did not ask for it; the server asks anyway.
    expect(
      missingRequiredKeys([field({ key: "url", type: "external" })], {
        url: false,
      }),
    ).toEqual(["url"]);
  });

  test("an acknowledged external field is no longer missing", () => {
    // Only `true` counts. Verified against a live server: `false`, `"yes"` and `1`
    // are all refused with the same error as omitting the key, so treating any
    // truthy value as an acknowledgement would let the form submit and then fail
    // against the server rather than failing fast here.
    expect(
      missingRequiredKeys([field({ key: "url", type: "external" })], {
        url: true,
      }),
    ).toEqual([]);
    for (const notAcknowledged of [false, "yes", 1, 0, "true"]) {
      expect(
        missingRequiredKeys([field({ key: "url", type: "external" })], {
          url: notAcknowledged,
        }),
      ).toEqual(["url"]);
    }
  });

  test("a boolean field answered false is not missing", () => {
    // The case the split into `isUnanswered` exists to protect. `false` is a real
    // answer for a boolean -- "No" -- and reporting it as missing would have been
    // a new bug introduced by fixing the external one.
    expect(
      missingRequiredKeys(
        [field({ key: "tls", type: "boolean", required: true })],
        { tls: false },
      ),
    ).toEqual([]);
  });

  test("reports every missing key in declaration order", () => {
    expect(
      missingRequiredKeys(
        [
          field({ key: "a", type: "string", required: true }),
          field({ key: "b", type: "string" }),
          field({ key: "c", type: "string", required: true }),
        ],
        {},
      ),
    ).toEqual(["a", "c"]);
  });
});

// ---------------------------------------------------------------------------
// multiselectConstraintViolations
// ---------------------------------------------------------------------------

describe("multiselectConstraintViolations", () => {
  const multi = (key: string, extra: Record<string, unknown> = {}) =>
    field({ key, type: "multiselect", ...extra });

  test("reports a selection below minItems", () => {
    expect(
      multiselectConstraintViolations([multi("regions", { minItems: 2 })], {
        regions: ["eu"],
      }),
    ).toEqual(["regions"]);
  });

  test("reports a selection above maxItems", () => {
    expect(
      multiselectConstraintViolations([multi("regions", { maxItems: 1 })], {
        regions: ["eu", "us"],
      }),
    ).toEqual(["regions"]);
  });

  test("accepts a selection within bounds", () => {
    expect(
      multiselectConstraintViolations(
        [multi("regions", { minItems: 1, maxItems: 2 })],
        { regions: ["eu", "us"] },
      ),
    ).toEqual([]);
  });

  test("an unanswered multiselect violates minItems", () => {
    // Treated as a count of 0, so `minItems: 1` is unmet.
    expect(
      multiselectConstraintViolations([multi("regions", { minItems: 1 })], {}),
    ).toEqual(["regions"]);
  });

  test("an unanswered multiselect satisfies maxItems", () => {
    expect(
      multiselectConstraintViolations([multi("regions", { maxItems: 2 })], {}),
    ).toEqual([]);
  });

  test("ignores fields with no constraints", () => {
    expect(multiselectConstraintViolations([multi("regions")], {})).toEqual([]);
  });

  test("ignores non-multiselect fields", () => {
    // A string field carrying `minItems` is not a selection count.
    expect(
      multiselectConstraintViolations(
        [field({ key: "name", type: "string", minItems: 3 })],
        { name: "ab" },
      ),
    ).toEqual([]);
  });

  test("ignores a hidden multiselect", () => {
    expect(
      multiselectConstraintViolations(
        [multi("regions", { minItems: 2, hidden: true })],
        {},
      ),
    ).toEqual([]);
  });

  test("counts a scalar answer as zero selections", () => {
    // A scalar where an array belongs is a malformed answer; treating it as 0
    // surfaces a minItems violation rather than counting `1`.
    expect(
      multiselectConstraintViolations([multi("regions", { minItems: 1 })], {
        regions: "eu",
      } as unknown as FormAnswer),
    ).toEqual(["regions"]);
  });

  test("reports each offending field once", () => {
    // A field breaching both bounds at once must not be listed twice — the caller
    // renders this list as one message per entry.
    expect(
      multiselectConstraintViolations(
        [multi("k", { minItems: 3, maxItems: 1 })],
        { k: ["a", "b"] },
      ),
    ).toEqual(["k"]);
  });

  test("reports multiple fields in declaration order", () => {
    expect(
      multiselectConstraintViolations(
        [
          multi("a", { minItems: 1 }),
          field({ key: "b", type: "string" }),
          multi("c", { minItems: 1 }),
        ],
        {},
      ),
    ).toEqual(["a", "c"]);
  });
});

// ---------------------------------------------------------------------------
// coerceNumber / fieldLabel / isNumericField
// ---------------------------------------------------------------------------

describe("coerceNumber", () => {
  test("parses an integer", () => {
    expect(coerceNumber("42")).toBe(42);
  });

  test("parses a decimal", () => {
    expect(coerceNumber("3.5")).toBe(3.5);
  });

  test("parses a negative", () => {
    expect(coerceNumber("-7")).toBe(-7);
  });

  test("trims surrounding whitespace", () => {
    expect(coerceNumber("  8  ")).toBe(8);
  });

  test("keeps an empty string as empty rather than 0", () => {
    // `Number("")` is 0. Coercing a blank field to 0 would silently submit zero
    // for a field the user never filled in.
    expect(coerceNumber("")).toBe("");
    expect(coerceNumber("   ")).toBe("");
  });

  test("keeps unparseable text as text", () => {
    expect(coerceNumber("abc")).toBe("abc");
  });

  test("passes through the wire's Infinity sentinels as numbers", () => {
    expect(coerceNumber("Infinity")).toBe(Infinity);
    expect(coerceNumber("-Infinity")).toBe(-Infinity);
  });

  test("returns the NaN sentinel as text", () => {
    // `Number("NaN")` is NaN, so it takes the unparseable branch and comes back as
    // the literal. A NaN number is not representable in a text input, and the
    // server parses the literal either way.
    expect(coerceNumber("NaN")).toBe("NaN");
  });

  test("rejects a partially numeric string", () => {
    expect(coerceNumber("12abc")).toBe("12abc");
  });
});

describe("fieldLabel", () => {
  test("prefers the title", () => {
    expect(fieldLabel(field({ key: "k", title: "Environment" }))).toBe(
      "Environment",
    );
  });

  test("falls back to the key when there is no title", () => {
    expect(fieldLabel(field({ key: "environment" }))).toBe("environment");
  });

  for (const [label, title] of [
    ["an empty title", ""],
    ["a whitespace-only title", "   "],
  ] as const) {
    test(`falls back to the key for ${label}`, () => {
      // A blank label would render an unlabelled input.
      expect(fieldLabel(field({ key: "environment", title }))).toBe(
        "environment",
      );
    });
  }

  test("trims the title", () => {
    expect(fieldLabel(field({ key: "k", title: "  Environment  " }))).toBe(
      "Environment",
    );
  });
});

describe("isNumericField", () => {
  for (const type of ["number", "integer"] as const) {
    test(`is true for ${type}`, () => {
      expect(isNumericField(field({ type }))).toBe(true);
    });
  }

  for (const type of [
    "string",
    "boolean",
    "multiselect",
    "external",
  ] as const) {
    test(`is false for ${type}`, () => {
      expect(isNumericField(field({ type }))).toBe(false);
    });
  }
});
