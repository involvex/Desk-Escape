import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/context/ThemeContext";
import type { ContextAttachment } from "@/types/opencode";

/**
 * The files staged to be sent with the next prompt.
 *
 * ## Why this is its own component
 *
 * It was forty lines of JSX and seven styles inside `AgentChat`, which is a
 * 700-line file with a FlatList, a composer, a slash-command menu and a scroll
 * bar. Extracted, it is a component whose entire behaviour is three rules — one
 * chip per file, remove by id, clear-all only once there is more than one thing to
 * clear — and those rules are now testable without standing up the composer.
 *
 * ## Why the remove target is the id and not the path
 *
 * The label is the path, because that is what the user reads. The callback takes
 * the id, because the path is not unique: the same file can be attached from two
 * directories, and `removeContextAttachment` keys on id. A remove keyed on the
 * label would drop whichever entry happened to match.
 */

interface AttachmentChipsProps {
  /** The staged files, in the order they were added. */
  attachments: readonly ContextAttachment[];
  /** Detach one file. Called with the attachment's `id`. */
  onRemove: (id: string) => void;
  /** Detach every file at once. */
  onClearAll: () => void;
}

export function AttachmentChips({
  attachments,
  onRemove,
  onClearAll,
}: AttachmentChipsProps) {
  const { colors, spacing, typography } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.xs,
          marginBottom: spacing.sm,
        },
        chip: {
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.xs,
          // `100%` rather than a fixed width: a deep path would otherwise be
          // clipped mid-word instead of truncated with an ellipsis.
          maxWidth: "100%",
          paddingLeft: spacing.sm,
          paddingRight: 2,
          paddingVertical: 4,
        },
        label: {
          color: colors.textMuted,
          flexShrink: 1,
          fontSize: typography.caption,
        },
        remove: {
          alignItems: "center",
          borderRadius: 999,
          height: 24,
          justifyContent: "center",
          width: 24,
        },
        removeGlyph: {
          color: colors.textMuted,
          fontSize: typography.caption + 2,
          fontWeight: "700",
          lineHeight: typography.caption + 4,
        },
        clearAll: {
          alignSelf: "flex-start",
          paddingHorizontal: spacing.xs,
          paddingVertical: 2,
        },
        clearAllLabel: {
          color: colors.accent,
          fontSize: typography.caption,
          fontWeight: "600",
        },
      }),
    [colors, spacing, typography],
  );

  if (attachments.length === 0) {
    return null;
  }

  return (
    <View style={styles.row}>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={styles.chip}>
          <Text numberOfLines={1} style={styles.label}>
            {attachment.path}
          </Text>
          <Pressable
            accessibilityLabel={`Remove ${attachment.path}`}
            accessibilityRole="button"
            accessibilityState={{ selected: false }}
            hitSlop={8}
            onPress={() => onRemove(attachment.id)}
            style={styles.remove}
          >
            <Text style={styles.removeGlyph}>×</Text>
          </Pressable>
        </View>
      ))}
      {/* One file needs no "clear all" — the chip's own cross already does it, and
          a second control that does the same thing is one more thing to mis-tap. */}
      {attachments.length > 1 ? (
        <Pressable
          accessibilityLabel="Clear all attachments"
          accessibilityRole="button"
          onPress={onClearAll}
          style={styles.clearAll}
        >
          <Text style={styles.clearAllLabel}>Clear all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
