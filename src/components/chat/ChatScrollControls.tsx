import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";

export interface ChatScrollMetrics {
  contentHeight: number;
  layoutHeight: number;
  offsetY: number;
}

export const SCROLL_EDGE_THRESHOLD = 80;

interface ChatScrollControlsProps {
  scrollMetrics: ChatScrollMetrics;
  onScrollToTop: () => void;
  onScrollToBottom: () => void;
  sessionCollapseMode: "default" | "collapsed" | "expanded";
  onToggleCollapseMode: () => void;
}

export function ChatScrollControls({
  scrollMetrics,
  onScrollToTop,
  onScrollToBottom,
  sessionCollapseMode,
  onToggleCollapseMode,
}: ChatScrollControlsProps) {
  const { colors, spacing, typography } = useTheme();
  const { contentHeight, layoutHeight, offsetY } = scrollMetrics;

  const showTop =
    contentHeight > layoutHeight && offsetY > SCROLL_EDGE_THRESHOLD;
  const showBottom =
    contentHeight > layoutHeight &&
    offsetY + layoutHeight < contentHeight - SCROLL_EDGE_THRESHOLD;

  const collapseLabel =
    sessionCollapseMode === "collapsed"
      ? "Expand all"
      : sessionCollapseMode === "expanded"
        ? "Reset collapse"
        : "Collapse all";

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          alignItems: "flex-end",
          bottom: 8,
          gap: spacing.xs,
          position: "absolute",
          right: spacing.sm,
        },
        fab: {
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          height: 36,
          justifyContent: "center",
          width: 36,
        },
        collapseButton: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          marginBottom: spacing.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: 6,
        },
        collapseText: {
          color: colors.textMuted,
          fontSize: typography.caption,
          fontWeight: "600",
        },
      }),
    [colors, spacing, typography],
  );

  return (
    <View pointerEvents="box-none" style={styles.container}>
      <Pressable onPress={onToggleCollapseMode} style={styles.collapseButton}>
        <Text style={styles.collapseText}>{collapseLabel}</Text>
      </Pressable>
      {showTop ? (
        <Pressable
          accessibilityLabel="Scroll to top"
          onPress={onScrollToTop}
          style={styles.fab}
        >
          <ChevronUp color={colors.text} size={18} />
        </Pressable>
      ) : null}
      {showBottom ? (
        <Pressable
          accessibilityLabel="Scroll to bottom"
          onPress={onScrollToBottom}
          style={styles.fab}
        >
          <ChevronDown color={colors.text} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}
