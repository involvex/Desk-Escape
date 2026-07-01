import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";

interface CollapsiblePartGroupProps {
  label: string;
  body?: string;
  defaultCollapsed: boolean;
  status?: "running" | "completed" | "error";
}

export function CollapsiblePartGroup({
  label,
  body,
  defaultCollapsed,
  status,
}: CollapsiblePartGroupProps) {
  const { colors, spacing, typography } = useTheme();
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderColor: colors.border,
          borderRadius: 10,
          borderWidth: 1,
          marginTop: spacing.xs,
          overflow: "hidden",
        },
        header: {
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          flexDirection: "row",
          gap: spacing.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        label: {
          color: colors.textMuted,
          flex: 1,
          fontSize: typography.caption,
        },
        body: {
          borderTopColor: colors.border,
          borderTopWidth: 1,
          color: colors.text,
          fontFamily: "monospace",
          fontSize: typography.mono,
          lineHeight: 18,
          padding: spacing.sm,
        },
        statusDot: {
          borderRadius: 4,
          height: 8,
          width: 8,
        },
        statusRunning: {
          backgroundColor: colors.warning,
        },
        statusCompleted: {
          backgroundColor: colors.success,
        },
        statusError: {
          backgroundColor: colors.danger,
        },
      }),
    [colors, spacing, typography],
  );

  const statusStyle =
    status === "running"
      ? styles.statusRunning
      : status === "error"
        ? styles.statusError
        : status === "completed"
          ? styles.statusCompleted
          : null;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        {expanded ? (
          <ChevronDown color={colors.textMuted} size={14} />
        ) : (
          <ChevronRight color={colors.textMuted} size={14} />
        )}
        <Text numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        {statusStyle ? <View style={[styles.statusDot, statusStyle]} /> : null}
      </Pressable>
      {expanded && body ? (
        <Text selectable style={styles.body}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}
