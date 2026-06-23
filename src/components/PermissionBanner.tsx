import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePermission } from "@/context/PermissionContext";
import { useTheme } from "@/context/ThemeContext";

export function PermissionBanner() {
  const { colors, spacing, typography } = useTheme();
  const { pending, respond, dismiss } = usePermission();

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
    [colors, spacing, typography],
  );

  if (!pending) {
    return null;
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.title}>{pending.title}</Text>
      {pending.description ? (
        <Text style={styles.description}>{pending.description}</Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={() => void respond("once")}
          style={[styles.button, styles.buttonPrimary]}
        >
          <Text style={styles.buttonText}>Allow once</Text>
        </Pressable>
        <Pressable
          onPress={() => void respond("always")}
          style={[styles.button, styles.buttonPrimary]}
        >
          <Text style={styles.buttonText}>Always</Text>
        </Pressable>
        <Pressable
          onPress={() => void respond("reject")}
          style={[styles.button, styles.buttonDanger]}
        >
          <Text style={styles.buttonText}>Reject</Text>
        </Pressable>
        <Pressable onPress={dismiss} style={styles.button}>
          <Text style={styles.buttonText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}
