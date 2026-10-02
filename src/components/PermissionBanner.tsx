import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePermission } from "@/context/PermissionContext";
import { useTheme } from "@/context/ThemeContext";

/**
 * Approval prompt for a pending permission request.
 *
 * V2 replaced the single `resource` string with a plural `resources` array and
 * replaced the free-form `description` with an optional `message`; both are
 * shown, plus the raw resource list when it would not fit in the message.
 */
export function PermissionBanner() {
  const { colors, spacing, typography } = useTheme();
  const { pending, respond, dismiss, busy, error, clearError } =
    usePermission();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        banner: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.warning,
          borderRadius: 12,
          borderWidth: 1,
          gap: spacing.sm,
          marginHorizontal: spacing.md,
          marginTop: spacing.sm,
          padding: spacing.md,
        },
        title: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "700",
        },
        description: {
          color: colors.textMuted,
          fontSize: typography.caption,
        },
        resourceList: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 10,
          borderWidth: 1,
          gap: 2,
          padding: spacing.sm,
        },
        resource: {
          color: colors.textMuted,
          fontFamily: typography.fontFamily,
          fontSize: typography.caption,
        },
        saveHint: {
          color: colors.textMuted,
          fontSize: typography.caption,
          fontStyle: "italic",
        },
        error: {
          color: colors.danger,
          fontSize: typography.caption,
        },
        actions: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.sm,
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
        buttonDanger: {
          borderColor: colors.danger,
        },
        buttonText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
      }),
    [busy, colors, spacing, typography],
  );

  if (!pending) {
    return null;
  }

  // `save` lists what "always" would remember; say so rather than implying the
  // button is a blanket, permanent grant.
  const saveHint =
    pending.action && pending.resources.length > 0
      ? `“Always” remembers this for ${pending.action} in this project.`
      : "“Always” remembers this choice for the project.";

  return (
    <View style={styles.banner}>
      <Text style={styles.title}>{pending.title}</Text>
      {pending.message ? (
        <Text style={styles.description}>{pending.message}</Text>
      ) : null}

      {pending.resources.length > 0 ? (
        <View style={styles.resourceList}>
          {pending.resources.map((resource) => (
            <Text key={resource} numberOfLines={3} style={styles.resource}>
              {resource}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.saveHint}>{saveHint}</Text>

      {error ? (
        <Pressable onPress={clearError}>
          <Text style={styles.error}>{error}</Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          disabled={busy}
          onPress={() => void respond("once")}
          style={[styles.button, styles.buttonPrimary]}
        >
          <Text style={styles.buttonText}>Allow once</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => void respond("always")}
          style={[styles.button, styles.buttonPrimary]}
        >
          <Text style={styles.buttonText}>Always</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => void respond("reject")}
          style={[styles.button, styles.buttonDanger]}
        >
          <Text style={styles.buttonText}>Reject</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={dismiss} style={styles.button}>
          <Text style={styles.buttonText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}
