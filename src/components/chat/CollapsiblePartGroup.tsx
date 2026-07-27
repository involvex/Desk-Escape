import { useEffect, useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";

export type PartType =
  | "reasoning"
  | "tool"
  | "step-start"
  | "step-finish"
  | "agent"
  | "subtask"
  | "retry"
  | "compaction"
  | "snapshot"
  | "patch";

interface CollapsiblePartGroupProps {
  label: string;
  body?: string;
  defaultCollapsed: boolean;
  status?: "running" | "completed" | "error";
  partType?: PartType;
  duration?: number | null;
  isStreaming?: boolean;
}

const PART_TYPE_COLORS: Record<PartType, string> = {
  reasoning: "#8B5CF6",
  tool: "#3B82F6",
  "step-start": "#10B981",
  "step-finish": "#10B981",
  agent: "#F59E0B",
  subtask: "#EC4899",
  retry: "#EF4444",
  compaction: "#6B7280",
  snapshot: "#06B6D4",
  patch: "#8B5CF6",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function CollapsiblePartGroup({
  label,
  body,
  defaultCollapsed,
  status,
  partType = "reasoning",
  duration,
  isStreaming = false,
}: CollapsiblePartGroupProps) {
  const { colors, spacing, typography } = useTheme();
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const [pulseAnim] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (isStreaming) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.5,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isStreaming, pulseAnim]);

  const typeColor = PART_TYPE_COLORS[partType] ?? colors.textMuted;

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
        containerStreaming: {
          borderColor: typeColor,
        },
        header: {
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          flexDirection: "row",
          gap: spacing.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        headerStreaming: {
          backgroundColor: `${typeColor}15`,
        },
        label: {
          color: colors.textMuted,
          flex: 1,
          fontSize: typography.caption,
        },
        labelStreaming: {
          color: typeColor,
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
        typeIndicator: {
          borderRadius: 3,
          height: 6,
          width: 6,
          backgroundColor: typeColor,
        },
        timingBadge: {
          backgroundColor: `${typeColor}20`,
          borderRadius: 4,
          paddingHorizontal: spacing.xs,
          paddingVertical: 2,
        },
        timingText: {
          color: typeColor,
          fontSize: typography.caption - 2,
          fontWeight: "500",
        },
      }),
    [colors, spacing, typography, typeColor],
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
    <View
      style={[styles.container, isStreaming && styles.containerStreaming]}
      accessibilityRole="summary"
      accessibilityLabel={`${label} ${status ?? ""}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={[styles.header, isStreaming && styles.headerStreaming]}
      >
        {expanded ? (
          <ChevronDown color={typeColor} size={14} />
        ) : (
          <ChevronRight color={typeColor} size={14} />
        )}
        <View style={styles.typeIndicator} />
        <Text
          numberOfLines={1}
          style={[styles.label, isStreaming && styles.labelStreaming]}
        >
          {label}
        </Text>
        {duration != null && duration > 0 ? (
          <View style={styles.timingBadge}>
            <Text style={styles.timingText}>{formatDuration(duration)}</Text>
          </View>
        ) : null}
        {statusStyle ? (
          <Animated.View
            style={[
              styles.statusDot,
              statusStyle,
              isStreaming && { opacity: pulseAnim },
            ]}
          />
        ) : null}
      </Pressable>
      {expanded && body ? (
        <Text selectable style={styles.body}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}
