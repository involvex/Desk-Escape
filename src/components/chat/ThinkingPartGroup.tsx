import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ChevronDown,
  ChevronRight,
  Brain,
  Copy,
  Check,
} from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";
import type { Part } from "@/types/opencode";
import {
  getThinkingBody,
  getThinkingMetadata,
  getPartStatus,
} from "./message-parts";

interface ThinkingPartGroupProps {
  parts: Part[];
  defaultCollapsed: boolean;
  autoExpandDuringStream?: boolean;
  showTiming?: boolean;
  collapseResetKey?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const ThinkingPartGroup = memo(function ThinkingPartGroupInner({
  parts,
  defaultCollapsed,
  autoExpandDuringStream = true,
  showTiming = true,
  collapseResetKey,
}: ThinkingPartGroupProps) {
  const { colors, spacing, typography } = useTheme();

  const metadata = useMemo(() => {
    const allMetadata = parts.map(getThinkingMetadata);
    const isStreaming = allMetadata.some((m) => m.isStreaming);
    const totalDuration = allMetadata.reduce((sum, m) => {
      if (m.duration != null) return sum + m.duration;
      if (m.startTime != null && m.endTime != null)
        return sum + (m.endTime - m.startTime);
      return sum;
    }, 0);
    return { isStreaming, totalDuration };
  }, [parts]);

  const combinedBody = useMemo(
    () => parts.map(getThinkingBody).filter(Boolean).join("\n\n"),
    [parts],
  );

  const status = useMemo(() => {
    const statuses = parts.map(getPartStatus).filter(Boolean);
    if (statuses.includes("running")) return "running";
    if (statuses.includes("error")) return "error";
    if (statuses.includes("completed")) return "completed";
    return undefined;
  }, [parts]);

  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);

  const [prevResetKey, setPrevResetKey] = useState(collapseResetKey);
  if (collapseResetKey !== prevResetKey) {
    setPrevResetKey(collapseResetKey);
    setManualExpanded(null);
  }

  const expanded =
    manualExpanded ??
    (autoExpandDuringStream && metadata.isStreaming) ??
    !defaultCollapsed;

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
          borderColor: "#8B5CF6",
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
          backgroundColor: "rgba(139, 92, 246, 0.08)",
        },
        labelContainer: {
          alignItems: "center",
          flex: 1,
          flexDirection: "row",
          gap: spacing.xs,
        },
        brainIcon: {
          marginRight: spacing.xs,
        },
        label: {
          color: colors.textMuted,
          flex: 1,
          fontSize: typography.caption,
        },
        labelStreaming: {
          color: "#8B5CF6",
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
        timingBadge: {
          backgroundColor: "rgba(139, 92, 246, 0.15)",
          borderRadius: 4,
          paddingHorizontal: spacing.xs,
          paddingVertical: 2,
        },
        timingText: {
          color: "#8B5CF6",
          fontSize: typography.caption - 2,
          fontWeight: "500",
        },
        partCount: {
          color: colors.textMuted,
          fontSize: typography.caption - 2,
          marginLeft: spacing.xs,
        },
        copyButton: {
          padding: spacing.xs,
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

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (
      combinedBody &&
      typeof navigator !== "undefined" &&
      navigator.clipboard
    ) {
      navigator.clipboard.writeText(combinedBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <View
      style={[
        styles.container,
        metadata.isStreaming && styles.containerStreaming,
      ]}
      accessibilityRole="summary"
      accessibilityLabel={`Thinking ${parts.length} parts ${status ?? ""}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() =>
          setManualExpanded((prev) => (prev === null ? !expanded : !prev))
        }
        style={[styles.header, metadata.isStreaming && styles.headerStreaming]}
      >
        {expanded ? (
          <ChevronDown color="#8B5CF6" size={14} />
        ) : (
          <ChevronRight color="#8B5CF6" size={14} />
        )}
        <View style={styles.labelContainer}>
          <Brain color="#8B5CF6" size={12} style={styles.brainIcon} />
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              metadata.isStreaming && styles.labelStreaming,
            ]}
          >
            {parts.length === 1
              ? "Thinking"
              : `Thinking (${parts.length} parts)`}
          </Text>
        </View>
        {showTiming && metadata.totalDuration > 0 ? (
          <View style={styles.timingBadge}>
            <Text style={styles.timingText}>
              {formatDuration(metadata.totalDuration)}
            </Text>
          </View>
        ) : null}
        {statusStyle ? <View style={[styles.statusDot, statusStyle]} /> : null}
        {combinedBody ? (
          <Pressable
            accessibilityLabel="Copy thinking"
            onPress={handleCopy}
            style={styles.copyButton}
          >
            {copied ? (
              <Check color={colors.success} size={14} />
            ) : (
              <Copy color={colors.textMuted} size={14} />
            )}
          </Pressable>
        ) : null}
      </Pressable>
      {expanded && combinedBody ? (
        <Text selectable style={styles.body}>
          {combinedBody}
        </Text>
      ) : null}
    </View>
  );
});

function areEqual(
  prev: ThinkingPartGroupProps,
  next: ThinkingPartGroupProps,
): boolean {
  return (
    prev.parts === next.parts &&
    prev.defaultCollapsed === next.defaultCollapsed &&
    prev.autoExpandDuringStream === next.autoExpandDuringStream &&
    prev.showTiming === next.showTiming &&
    prev.collapseResetKey === next.collapseResetKey
  );
}

export default memo(ThinkingPartGroup, areEqual);
