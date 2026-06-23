import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FolderOpen, MessageSquare, Terminal } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";
import type { WorkspacePanel } from "@/types/opencode";

interface PanelTabsProps {
  activePanel: WorkspacePanel;
  onChange: (panel: WorkspacePanel) => void;
}

const panels: {
  id: WorkspacePanel;
  label: string;
  icon: typeof FolderOpen;
}[] = [
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "agent", label: "Agent", icon: MessageSquare },
  { id: "terminal", label: "Terminal", icon: Terminal },
];

export function PanelTabs({ activePanel, onChange }: PanelTabsProps) {
  const { colors, spacing, typography } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: spacing.xs,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        item: {
          alignItems: "center",
          borderRadius: 10,
          flex: 1,
          flexDirection: "row",
          gap: 6,
          justifyContent: "center",
          paddingVertical: spacing.sm,
        },
        itemActive: {
          backgroundColor: colors.accentMuted,
        },
        label: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
      }),
    [colors, spacing, typography],
  );

  return (
    <View style={styles.container}>
      {panels.map((panel) => {
        const Icon = panel.icon;
        const isActive = activePanel === panel.id;

        return (
          <Pressable
            key={panel.id}
            onPress={() => onChange(panel.id)}
            style={[styles.item, isActive ? styles.itemActive : null]}
          >
            <Icon
              color={isActive ? colors.accent : colors.textMuted}
              size={16}
            />
            <Text style={styles.label}>{panel.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
