import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Command, Plus, ChevronDown, Cpu } from "lucide-react-native";
import { useCurrentAgent, useCurrentModel, useSessions } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";

interface WorkspaceToolbarProps {
  onOpenPalette: () => void;
  onOpenSessions: () => void;
  onCreateSession: () => void;
  onOpenAgentPicker: () => void;
  onOpenModelPicker: () => void;
  compact?: boolean;
}

export function WorkspaceToolbar({
  onOpenPalette,
  onOpenSessions,
  onCreateSession,
  onOpenAgentPicker,
  onOpenModelPicker,
  compact = false,
}: WorkspaceToolbarProps) {
  const { colors, spacing, typography } = useTheme();
  const { sessionId, session, currentAgentKey, currentModel } = useConnection();
  const { data: sessions = [] } = useSessions();

  // V2 agents and models are first-class lists, so the header resolves the
  // session's current pair directly instead of reverse-lookup through a
  // provider-keyed config map that no longer exists.
  const { data: sessionAgent = null } = useCurrentAgent(sessionId);
  const { data: sessionModel = null } = useCurrentModel(sessionId);

  const recentSessions = useMemo(() => {
    const sorted = [...sessions].sort(
      (a, b) => b.time.updated - a.time.updated,
    );
    return sorted.slice(0, 3);
  }, [sessions]);

  // Fall back to the locally-tracked selection until the server answers.
  const activeAgentName = sessionAgent?.name ?? currentAgentKey ?? null;
  const activeModelLabel =
    sessionModel?.name ||
    sessionModel?.id ||
    (currentModel
      ? `${currentModel.providerId}/${currentModel.modelId}`
      : null);
  const activeAgentColor = sessionAgent?.color;

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
          alignItems: "center",
        },
        chip: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          flexShrink: 0,
          maxWidth: 140,
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        },
        chipActive: {
          borderColor: colors.accent,
        },
        chipText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        chipIcon: {
          width: 8,
          height: 8,
          borderRadius: 4,
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

  const renderAgentChip = () => {
    if (!activeAgentName) return null;
    const agentColor = activeAgentColor || colors.accent;
    return (
      <Pressable onPress={onOpenAgentPicker} style={styles.chip}>
        <View
          style={[
            styles.chipIcon,
            {
              backgroundColor: agentColor,
            },
          ]}
        />
        <Text numberOfLines={1} style={styles.chipText}>
          {activeAgentName}
        </Text>
        <ChevronDown color={colors.textMuted} size={10} />
      </Pressable>
    );
  };

  const renderModelChip = () => {
    if (!activeModelLabel) return null;
    return (
      <Pressable onPress={onOpenModelPicker} style={styles.chip}>
        <Cpu color={colors.accent} size={12} />
        <Text numberOfLines={1} style={styles.chipText}>
          {activeModelLabel}
        </Text>
        <ChevronDown color={colors.textMuted} size={10} />
      </Pressable>
    );
  };

  if (compact) {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.chips}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          <Pressable
            onPress={onOpenSessions}
            style={[styles.chip, styles.chipActive]}
          >
            <Text numberOfLines={1} style={styles.chipText}>
              {session?.title ?? "Session"}
            </Text>
          </Pressable>
          {renderAgentChip()}
          {renderModelChip()}
        </ScrollView>
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
        {renderAgentChip()}
        {renderModelChip()}
      </ScrollView>
      <Pressable onPress={onOpenPalette} style={styles.paletteButton}>
        <Command color={colors.accent} size={16} />
      </Pressable>
    </View>
  );
}
