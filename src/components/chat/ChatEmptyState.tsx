import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

interface EmptyActionProps {
  label: string;
  onPress: () => void;
  tone?: "default" | "accent";
}

function EmptyAction({ label, onPress, tone = "default" }: EmptyActionProps) {
  const { colors, spacing, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        button: {
          backgroundColor: tone === "accent" ? colors.accent : colors.surface,
          borderColor: tone === "accent" ? colors.accent : colors.border,
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        buttonText: {
          color: tone === "accent" ? colors.onAccent : colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
      }),
    [colors, spacing, tone, typography],
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export interface ChatEmptyStateProps {
  /** Server/transport message when the transcript could not be loaded. */
  error: string | null;
  hintCommand: string;
  isRetrying?: boolean;
  onCreateSession?: () => void;
  onOpenPalette?: () => void;
  onRetry: () => void;
  onTryHint: () => void;
}

/**
 * The transcript placeholder.
 *
 * Lives outside the (inverted) message list on purpose: anything rendered
 * through `FlatList`'s `ListEmptyComponent` inherits the list's `scaleY: -1`
 * and comes out upside down. Keeping it a sibling also gives failures somewhere
 * to surface — a rejected query used to render this same placeholder, so a
 * broken fetch was indistinguishable from an empty session.
 */
export function ChatEmptyState({
  error,
  hintCommand,
  isRetrying = false,
  onCreateSession,
  onOpenPalette,
  onRetry,
  onTryHint,
}: ChatEmptyStateProps) {
  const { colors, spacing, typography } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          alignItems: "center",
          gap: spacing.md,
          maxWidth: 420,
          paddingHorizontal: spacing.lg,
        },
        title: {
          color: colors.text,
          fontSize: typography.subtitle,
          fontWeight: "700",
          textAlign: "center",
        },
        text: {
          color: colors.textMuted,
          fontSize: typography.body,
          textAlign: "center",
        },
        actions: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.sm,
          justifyContent: "center",
        },
        retry: {
          backgroundColor: colors.accent,
          borderRadius: 999,
          opacity: isRetrying ? 0.6 : 1,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
        },
        retryText: {
          color: colors.onAccent,
          fontSize: typography.caption,
          fontWeight: "700",
        },
      }),
    [colors, isRetrying, spacing, typography],
  );

  if (error) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Couldn&apos;t load this transcript</Text>
        <Text style={styles.text}>{error}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={isRetrying}
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryText}>
            {isRetrying ? "Retrying…" : "Retry"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>
        Ask the agent to inspect, edit, or run commands. Try /{hintCommand} or
        open the command palette.
      </Text>
      <View style={styles.actions}>
        {onCreateSession ? (
          <EmptyAction label="New session" onPress={onCreateSession} />
        ) : null}
        {onOpenPalette ? (
          <EmptyAction label="Command palette" onPress={onOpenPalette} />
        ) : null}
        <EmptyAction label={`Try /${hintCommand}`} onPress={onTryHint} />
      </View>
    </View>
  );
}
