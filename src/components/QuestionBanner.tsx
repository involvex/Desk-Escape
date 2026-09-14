import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuestion } from "@/context/QuestionContext";
import { useTheme } from "@/context/ThemeContext";
import type { PendingQuestion } from "@/api/questions";

function QuestionBannerInner({ pending }: { pending: PendingQuestion }) {
  const { colors, spacing, typography } = useTheme();
  const { reply, reject } = useQuestion();
  const [answers, setAnswers] = useState<string[][]>(() =>
    pending.questions.map(() => []),
  );
  const [current, setCurrent] = useState(0);
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const replied = useRef(false);

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
        question: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
          lineHeight: 22,
        },
        option: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 10,
          borderWidth: 1,
          padding: spacing.sm,
        },
        optionSelected: {
          borderColor: colors.accent,
          backgroundColor: colors.accentMuted,
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
        customInput: {
          backgroundColor: colors.inputBackground,
          borderColor: colors.border,
          borderRadius: 10,
          borderWidth: 1,
          color: colors.text,
          flex: 1,
          fontSize: typography.body,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        customRow: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
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
        },
      }),
    [colors, spacing, typography],
  );

  const q = pending.questions[current];
  if (!q) {
    return null;
  }

  const submit = (nextAnswers: string[][]) => {
    if (replied.current) return;
    replied.current = true;
    void reply(nextAnswers);
  };

  const handleReject = () => {
    if (replied.current) return;
    replied.current = true;
    void reject();
  };

  const toggleOption = (label: string) => {
    setAnswers((prev) => {
      const copy = [...prev];
      const selected = copy[current] || [];
      if (q.multiple) {
        copy[current] = selected.includes(label)
          ? selected.filter((item) => item !== label)
          : [...selected, label];
      } else {
        copy[current] = [label];
        if (pending.questions.length === 1) {
          setTimeout(() => submit(copy), 100);
        }
      }
      return copy;
    });
  };

  const submitCustom = () => {
    if (!custom.trim()) return;
    const copy = [...answers];
    copy[current] = [custom.trim()];
    setAnswers(copy);
    setCustom("");
    setShowCustom(false);
    if (pending.questions.length === 1) {
      submit(copy);
    }
  };

  return (
    <View style={styles.banner}>
      <Text style={styles.header}>{q.header || "Agent question"}</Text>
      <Text style={styles.question}>{q.question}</Text>

      {q.options.map((opt) => {
        const selected = (answers[current] || []).includes(opt.label);
        return (
          <Pressable
            key={opt.label}
            onPress={() => toggleOption(opt.label)}
            style={[styles.option, selected ? styles.optionSelected : null]}
          >
            <Text style={styles.optionLabel}>{opt.label}</Text>
            {opt.description ? (
              <Text style={styles.optionDesc}>{opt.description}</Text>
            ) : null}
          </Pressable>
        );
      })}

      {q.custom !== false ? (
        showCustom ? (
          <View style={styles.customRow}>
            <TextInput
              autoFocus
              onChangeText={setCustom}
              onSubmitEditing={submitCustom}
              placeholder="Custom answer"
              placeholderTextColor={colors.textMuted}
              style={styles.customInput}
              value={custom}
            />
            <Pressable
              onPress={submitCustom}
              style={[styles.button, styles.buttonPrimary]}
            >
              <Text style={styles.buttonText}>Send</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setShowCustom(true)} style={styles.option}>
            <Text style={styles.optionLabel}>Custom answer…</Text>
          </Pressable>
        )
      ) : null}

      <View style={styles.actions}>
        <Pressable onPress={handleReject}>
          <Text style={styles.dismissText}>Reject</Text>
        </Pressable>
        {pending.questions.length > 1 || q.multiple ? (
          <Pressable
            onPress={() => {
              if (current < pending.questions.length - 1) {
                setCurrent(current + 1);
              } else {
                submit(answers);
              }
            }}
            style={[styles.button, styles.buttonPrimary]}
          >
            <Text style={styles.buttonText}>
              {current < pending.questions.length - 1 ? "Next" : "Submit"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function QuestionBanner() {
  const { pending } = useQuestion();
  if (!pending) {
    return null;
  }
  return <QuestionBannerInner key={pending.id} pending={pending} />;
}
