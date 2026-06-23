import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Command, Plus } from "lucide-react-native";
import { useSessions } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";

interface WorkspaceToolbarProps {
  onOpenPalette: () => void;
  onOpenSessions: () => void;
  onCreateSession: () => void;
  compact?: boolean;
}

export function WorkspaceToolbar({
  onOpenPalette,
  onOpenSessions,
  onCreateSession,
  compact = false,
}: WorkspaceToolbarProps) {
  const { colors, spacing, typography } = useTheme();
  const { sessionId, session } = useConnection();
  const { data: sessions = [] } = useSessions();

  const recentSessions = useMemo(() => {
    const sorted = [...sessions].sort(
      (a, b) => b.time.updated - a.time.updated,
    );
    return sorted.slice(0, 3);
  }, [sessions]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: compact ? spacing.xs : spacing.sm,
        },
        chips: {
          flex: 1,
          flexDirection: "row",
          gap: spacing.xs,
        },
        chip: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          maxWidth: 140,
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
        },
        chipActive: {
          borderColor: colors.accent,
        },
        chipText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        paletteButton: {
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 8,
          borderWidth: 1,
          height: 32,
          justifyContent: "center",
          width: 32,
        },
        addButton: {
          alignItems: "center",
          backgroundColor: colors.accentMuted,
          borderColor: colors.accent,
          borderRadius: 999,
          borderWidth: 1,
          height: 28,
          justifyContent: "center",
          width: 28,
        },
      }),
    [colors, compact, spacing, typography],
  );

  if (compact) {
    return (
      <View style={styles.container}>
        <Pressable
          onPress={onOpenSessions}
          style={[styles.chip, styles.chipActive]}
        >
          <Text numberOfLines={1} style={styles.chipText}>
            {session?.title ?? "Session"}
          </Text>
        </Pressable>
        <Pressable onPress={onOpenPalette} style={styles.paletteButton}>
          <Command color={colors.accent} size={16} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.chips}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {recentSessions.map((item) => {
          const isActive = item.id === sessionId;
          return (
            <Pressable
              key={item.id}
              onPress={onOpenSessions}
              style={[styles.chip, isActive ? styles.chipActive : null]}
            >
              <Text numberOfLines={1} style={styles.chipText}>
                {item.title || "Untitled"}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={onCreateSession} style={styles.addButton}>
          <Plus color={colors.accent} size={14} />
        </Pressable>
      </ScrollView>
      <Pressable onPress={onOpenPalette} style={styles.paletteButton}>
        <Command color={colors.accent} size={16} />
      </Pressable>
    </View>
  );
}
