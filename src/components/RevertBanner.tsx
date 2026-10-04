import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Undo2 } from "lucide-react-native";

import { revertConfirmationText, type RevertState } from "@/api/session-revert";
import { useTheme } from "@/context/ThemeContext";

/**
 * Banner for an undo in progress.
 *
 * The two-phase `session.revert` API is what makes this safe to show: the server
 * reports the consequences in `stage`, and nothing has been destroyed until
 * `commit`. So the banner leads with what the server said will change, names the
 * files, and makes "keep" as easy to reach as "revert".
 *
 * The copy is deliberately blunt about irreversibility. A revert that silently
 * rewrites three source files reads very differently from one that only trims
 * the transcript, and the difference is the user's to decide with full
 * information — not the app's to decide for them.
 */
interface RevertBannerProps {
  state: RevertState;
  onCommit: () => void;
  onClear: () => void;
  /** Whether there is anything to undo, so the idle state stays hidden. */
  hasTarget: boolean;
}

export function RevertBanner({
  state,
  onCommit,
  onClear,
  hasTarget,
}: RevertBannerProps) {
  const { colors, spacing, typography } = useTheme();

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
        heading: {
          alignItems: "center",
          color: colors.text,
          flexDirection: "row",
          fontSize: typography.body,
          fontWeight: "700",
          gap: spacing.xs,
        },
        detail: {
          color: colors.textMuted,
          fontFamily: typography.fontFamily,
          fontSize: typography.caption,
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
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        buttonDestructive: {
          borderColor: colors.danger,
        },
        buttonText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        buttonTextDestructive: {
          color: colors.danger,
        },
      }),
    [colors, spacing, typography],
  );

  // Nothing staged and nothing in flight: stay out of the way entirely.
  if (state.phase === "idle" && !hasTarget) {
    return null;
  }

  const busy = state.phase === "staging" || state.phase === "committing";

  if (state.phase === "idle") {
    return (
      <View style={styles.banner}>
        <Text style={styles.heading}>
          <Undo2 color={colors.textMuted} size={16} />
          Undo the last turn?
        </Text>
        <Text style={styles.detail}>
          Stages what would be rolled back first — you can still change your
          mind before anything is written.
        </Text>
        {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.heading}>
        {busy ? (
          <ActivityIndicator color={colors.textMuted} size={14} />
        ) : (
          <Undo2 color={colors.warning} size={16} />
        )}
        {state.phase === "staging"
          ? "Checking what to undo…"
          : state.phase === "committing"
            ? "Reverting…"
            : "Ready to undo"}
      </Text>

      {state.summary ? (
        <Text style={styles.detail}>
          {revertConfirmationText(state.summary)}
        </Text>
      ) : null}

      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}

      {state.phase === "staged" ? (
        <View style={styles.actions}>
          <Pressable
            onPress={onCommit}
            style={[styles.button, styles.buttonDestructive]}
          >
            <Text style={[styles.buttonText, styles.buttonTextDestructive]}>
              Revert
            </Text>
          </Pressable>
          <Pressable onPress={onClear} style={styles.button}>
            <Text style={styles.buttonText}>Keep</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
