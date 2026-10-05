import { useMemo, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { FormAnswer, FormField, FormValue } from "@opencode/client";
import {
  coerceNumber,
  fieldAllowsCustom,
  fieldLabel,
  fieldOptions,
  initialAnswer,
  isNumericField,
  missingRequiredKeys,
  multiselectConstraintViolations,
  visibleFields,
  type FormChoice,
  type PendingForm,
} from "@/api/forms";
import { useQuestion } from "@/context/QuestionContext";
import { useTheme } from "@/context/ThemeContext";

function keyboardTypeFor(format?: string) {
  if (format === "email") return "email-address" as const;
  if (format === "uri") return "url" as const;
  return "default" as const;
}

function isStringField(
  field: FormField,
): field is Extract<FormField, { type: "string" }> {
  return field.type === "string";
}

function selectedValues(field: FormField, answer: FormAnswer): string[] {
  const value = answer[field.key];
  return Array.isArray(value) ? value : [];
}

function FieldShell({
  label,
  description,
  required,
  children,
}: {
  label: string;
  description?: string | undefined;
  required: boolean;
  children: React.ReactNode;
}) {
  const { colors, spacing, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        group: { gap: spacing.xs },
        label: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        required: { color: colors.warning },
        description: {
          color: colors.textMuted,
          fontSize: typography.caption,
        },
      }),
    [colors, spacing, typography],
  );

  return (
    <View style={styles.group}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {description ? (
        <Text style={styles.description}>{description}</Text>
      ) : null}
      {children}
    </View>
  );
}

function ChoiceList({
  choices,
  selected,
  onToggle,
}: {
  choices: FormChoice[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        list: { gap: spacing.xs },
        option: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 10,
          borderWidth: 1,
          padding: spacing.sm,
        },
        optionSelected: {
          backgroundColor: colors.accentMuted,
          borderColor: colors.accent,
        },
        optionLabel: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        optionDesc: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: 2,
        },
      }),
    [colors, spacing, typography],
  );

  return (
    <View style={styles.list}>
      {choices.map((choice) => {
        const isSelected = selected.includes(choice.value);
        return (
          <Pressable
            key={choice.value}
            onPress={() => onToggle(choice.value)}
            style={[styles.option, isSelected ? styles.optionSelected : null]}
          >
            <Text style={styles.optionLabel}>
              {isSelected ? "✓ " : ""}
              {choice.label}
            </Text>
            {choice.description ? (
              <Text style={styles.optionDesc}>{choice.description}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function FieldRenderer({
  field,
  answer,
  onChange,
  customOpen,
  onToggleCustom,
  customDraft,
  onChangeCustomDraft,
}: {
  field: FormField;
  answer: FormAnswer;
  onChange: (field: FormField, value: FormValue) => void;
  customOpen: boolean;
  onToggleCustom: (key: string) => void;
  customDraft: Record<string, string>;
  onChangeCustomDraft: (key: string, text: string) => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        input: {
          backgroundColor: colors.inputBackground,
          borderColor: colors.border,
          borderRadius: 10,
          borderWidth: 1,
          color: colors.text,
          fontSize: typography.body,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        row: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
        },
        toggleRow: { flexDirection: "row", gap: spacing.sm },
        toggle: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          flex: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        toggleSelected: {
          backgroundColor: colors.accentMuted,
          borderColor: colors.accent,
        },
        toggleText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
          textAlign: "center",
        },
        customToggle: {
          color: colors.accent,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        external: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 10,
          borderWidth: 1,
          // Was 2, sized for a single link. The acknowledgement row below needs
          // real separation from it or the two read as one control.
          gap: spacing.sm,
          padding: spacing.sm,
        },
        externalLink: {
          color: colors.accent,
          fontSize: typography.caption,
        },
      }),
    [colors, spacing, typography],
  );

  const label = fieldLabel(field);

  // An external field is answered outside the app: the user opens the link, then
  // confirms. That confirmation is not decoration. The server refuses the entire
  // reply unless every external field carries `true`, so a link with no control
  // beside it made the form permanently unsubmittable.
  if (field.type === "external") {
    const acknowledged = answer[field.key] === true;
    return (
      <FieldShell
        description={field.description}
        label={label}
        // Unconditional, whether or not the author set `required`: the server
        // demands the acknowledgement either way.
        required={true}
      >
        <View style={styles.external}>
          <Pressable onPress={() => void Linking.openURL(field.url)}>
            <Text style={styles.externalLink}>{field.url}</Text>
          </Pressable>
          <View style={styles.toggleRow}>
            {[true, false].map((option) => (
              <Pressable
                key={String(option)}
                onPress={() => onChange(field, option)}
                style={[
                  styles.toggle,
                  acknowledged === option ? styles.toggleSelected : null,
                ]}
              >
                <Text style={styles.toggleText}>
                  {option ? "I have read this" : "Not yet"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </FieldShell>
    );
  }

  const required = field.required === true;

  if (field.type === "boolean") {
    const current = answer[field.key];
    const value =
      typeof current === "boolean" ? current : (field.default ?? false);
    return (
      <FieldShell
        description={field.description}
        label={label}
        required={required}
      >
        <View style={styles.toggleRow}>
          {[true, false].map((option) => (
            <Pressable
              key={String(option)}
              onPress={() => onChange(field, option)}
              style={[
                styles.toggle,
                value === option ? styles.toggleSelected : null,
              ]}
            >
              <Text style={styles.toggleText}>{option ? "Yes" : "No"}</Text>
            </Pressable>
          ))}
        </View>
      </FieldShell>
    );
  }

  if (isNumericField(field)) {
    const raw = answer[field.key];
    const text = raw === undefined ? "" : String(raw);
    return (
      <FieldShell
        description={field.description}
        label={label}
        required={required}
      >
        <TextInput
          keyboardType={field.type === "integer" ? "numeric" : "decimal-pad"}
          onChangeText={(next) => onChange(field, coerceNumber(next))}
          placeholder="Enter a number"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={text}
        />
      </FieldShell>
    );
  }

  const choices = fieldOptions(field);
  const allowsCustom = fieldAllowsCustom(field);

  if (field.type === "multiselect") {
    const selected = selectedValues(field, answer);
    return (
      <FieldShell
        description={field.description}
        label={label}
        required={required}
      >
        <ChoiceList
          choices={choices}
          onToggle={(value) => {
            const next = selected.includes(value)
              ? selected.filter((item) => item !== value)
              : [...selected, value];
            onChange(field, next);
          }}
          selected={selected}
        />
        {allowsCustom ? (
          customOpen ? (
            <View style={styles.row}>
              <TextInput
                autoFocus
                onChangeText={(text) => onChangeCustomDraft(field.key, text)}
                onSubmitEditing={() => {
                  const draft = (customDraft[field.key] ?? "").trim();
                  if (!draft) return;
                  onChange(field, [...new Set([...selected, draft])]);
                  onChangeCustomDraft(field.key, "");
                }}
                placeholder="Custom value"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { flex: 1 }]}
                value={customDraft[field.key] ?? ""}
              />
              <Pressable
                onPress={() => {
                  const draft = (customDraft[field.key] ?? "").trim();
                  if (!draft) return;
                  onChange(field, [...new Set([...selected, draft])]);
                  onChangeCustomDraft(field.key, "");
                }}
                style={[styles.toggle, styles.toggleSelected]}
              >
                <Text style={styles.toggleText}>Add</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => onToggleCustom(field.key)}>
              <Text style={styles.customToggle}>Custom value…</Text>
            </Pressable>
          )
        ) : null}
      </FieldShell>
    );
  }

  // string
  if (choices.length > 0) {
    const current = answer[field.key];
    const selected = typeof current === "string" ? current : "";
    return (
      <FieldShell
        description={field.description}
        label={label}
        required={required}
      >
        <ChoiceList
          choices={choices}
          onToggle={(value) => onChange(field, selected === value ? "" : value)}
          selected={selected ? [selected] : []}
        />
        {allowsCustom ? (
          customOpen ? (
            <View style={styles.row}>
              <TextInput
                autoFocus
                onChangeText={(text) => onChangeCustomDraft(field.key, text)}
                onSubmitEditing={() => {
                  const draft = (customDraft[field.key] ?? "").trim();
                  if (!draft) return;
                  onChange(field, draft);
                  onChangeCustomDraft(field.key, "");
                }}
                placeholder="Custom answer"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { flex: 1 }]}
                value={customDraft[field.key] ?? ""}
              />
              <Pressable
                onPress={() => {
                  const draft = (customDraft[field.key] ?? "").trim();
                  if (!draft) return;
                  onChange(field, draft);
                  onChangeCustomDraft(field.key, "");
                }}
                style={[styles.toggle, styles.toggleSelected]}
              >
                <Text style={styles.toggleText}>Use</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => onToggleCustom(field.key)}>
              <Text style={styles.customToggle}>Custom answer…</Text>
            </Pressable>
          )
        ) : null}
      </FieldShell>
    );
  }

  if (!isStringField(field)) {
    return null;
  }

  const current = answer[field.key];
  return (
    <FieldShell
      description={field.description}
      label={label}
      required={required}
    >
      <TextInput
        keyboardType={keyboardTypeFor(field.format)}
        maxLength={field.maxLength}
        onChangeText={(text) => onChange(field, text)}
        placeholder={field.placeholder ?? "Enter a value"}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={typeof current === "string" ? current : ""}
      />
    </FieldShell>
  );
}

/**
 * Generic renderer for an OpenCode V2 form.
 *
 * V1's banner assumed a fixed `[{ question, options, multiple, custom }]`
 * shape walked one question at a time. V2 gives an ordered, heterogeneous
 * `fields` list where each field declares its own type and optional `when`
 * clauses, so this walks `fields`, re-evaluates visibility on every change,
 * renders whichever control matches each field type, and submits a single
 * `{ fieldKey: value }` answer map.
 */
function FormBannerInner({ pending }: { pending: PendingForm }) {
  const { colors, spacing, typography } = useTheme();
  const { reply, cancel, busy, error, clearError } = useQuestion();

  const [answer, setAnswer] = useState<FormAnswer>(() =>
    initialAnswer(pending.fields),
  );
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const submitted = useRef(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        banner: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.accent,
          borderRadius: 12,
          borderWidth: 1,
          gap: spacing.sm,
          marginHorizontal: spacing.md,
          marginTop: spacing.sm,
          padding: spacing.md,
        },
        header: {
          color: colors.accent,
          fontSize: typography.caption,
          fontWeight: "700",
          textTransform: "uppercase",
        },
        fields: { gap: spacing.md },
        error: {
          color: colors.danger,
          fontSize: typography.caption,
        },
        actions: {
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: spacing.xs,
        },
        button: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          opacity: busy ? 0.5 : 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        buttonPrimary: {
          backgroundColor: colors.accentMuted,
          borderColor: colors.accent,
        },
        buttonText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        dismissText: {
          color: colors.textMuted,
          fontSize: typography.caption,
          opacity: busy ? 0.5 : 1,
        },
      }),
    [busy, colors, spacing, typography],
  );

  // Re-evaluated on every keystroke: a field's `when` clauses can depend on
  // any other field's answer.
  const fields = visibleFields(pending.fields, answer);

  const handleChange = (field: FormField, value: FormValue) => {
    setLocalError(null);
    setAnswer((previous) => ({ ...previous, [field.key]: value }));
  };

  const submit = () => {
    if (submitted.current) return;

    const missing = missingRequiredKeys(fields, answer);
    if (missing.length > 0) {
      setLocalError(
        `Please answer: ${missing
          .map((key) => fieldLabel({ key, type: "string" } as FormField))
          .join(", ")}`,
      );
      return;
    }

    const overLimit = multiselectConstraintViolations(fields, answer);
    if (overLimit.length > 0) {
      setLocalError(
        `Too many or too few selections for: ${overLimit
          .map((key) => fieldLabel({ key, type: "string" } as FormField))
          .join(", ")}`,
      );
      return;
    }

    // Only send what is currently visible and actually answered, so a field
    // hidden by a `when` clause cannot leak a stale value into the payload.
    const payload: FormAnswer = {};
    for (const field of fields) {
      const value = answer[field.key];
      if (value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      payload[field.key] = value;
    }

    submitted.current = true;
    void reply(payload).catch(() => {
      // Re-enable the form so the user can retry; the message is rendered
      // from the context's `error`.
      submitted.current = false;
    });
  };

  const handleCancel = () => {
    if (submitted.current) return;
    submitted.current = true;
    // No form-reject endpoint exists in V2, so this is `session.form.cancel`:
    // the decline is reported to the server rather than swallowed locally.
    void cancel().catch(() => {
      submitted.current = false;
    });
  };

  const message = localError ?? error;

  return (
    <View style={styles.banner}>
      <Text style={styles.header}>{pending.title || "Agent request"}</Text>

      <View style={styles.fields}>
        {fields.map((field) => (
          <FieldRenderer
            key={field.key}
            answer={answer}
            customDraft={customDraft}
            customOpen={customOpen[field.key] === true}
            field={field}
            onChange={handleChange}
            onChangeCustomDraft={(key, text) =>
              setCustomDraft((previous) => ({ ...previous, [key]: text }))
            }
            onToggleCustom={(key) =>
              setCustomOpen((previous) => ({ ...previous, [key]: true }))
            }
          />
        ))}
      </View>

      {message ? (
        <Pressable onPress={clearError}>
          <Text style={styles.error}>{message}</Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <Pressable disabled={busy} onPress={handleCancel}>
          <Text style={styles.dismissText}>Not now</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={submit}
          style={[styles.button, styles.buttonPrimary]}
        >
          <Text style={styles.buttonText}>Submit</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function QuestionBanner() {
  const { pending } = useQuestion();
  if (!pending) {
    return null;
  }
  return <FormBannerInner key={pending.id} pending={pending} />;
}
