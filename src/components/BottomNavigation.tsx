import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  FileText,
  MessageSquare,
  Terminal,
  GitCompare,
  MoreHorizontal,
} from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";
import type { WorkspacePanel } from "@/types/opencode";

interface BottomNavigationProps {
  activePanel: WorkspacePanel;
  onChange: (panel: WorkspacePanel) => void;
  showMore?: boolean;
  onMorePress?: () => void;
}

const PANELS: {
  id: WorkspacePanel;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
}[] = [
  { id: "agent", label: "Agent", icon: MessageSquare },
  { id: "files", label: "Files", icon: FileText },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "diff", label: "Diff", icon: GitCompare },
];

export function BottomNavigation({
  activePanel,
  onChange,
  showMore = false,
  onMorePress,
}: BottomNavigationProps) {
  const { colors, spacing, typography } = useTheme();
  const activeIndex = PANELS.findIndex((p) => p.id === activePanel);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.surfaceElevated,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          flexDirection: "row",
          height: 56,
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
        },
        tab: {
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
          minHeight: 56,
          paddingVertical: spacing.xs,
        },
        tabActive: {
          backgroundColor: colors.accentMuted,
        },
        label: {
          color: colors.textMuted,
          fontSize: typography.caption,
        },
        labelActive: {
          color: colors.accent,
          fontWeight: "600",
        },
        moreTab: {
          backgroundColor: colors.surface,
          borderLeftColor: colors.border,
          borderLeftWidth: 1,
        },
        indicator: {
          backgroundColor: colors.accent,
          height: 3,
          position: "absolute",
          top: 0,
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
        },
      }),
    [colors, spacing, typography],
  );

  const tabWidth = 1 / PANELS.length;
  const indicatorLeft = activeIndex * tabWidth * 100;

  return (
    <View style={styles.container}>
      {PANELS.map((panel, index) => {
        const isActive = panel.id === activePanel;
        const Icon = panel.icon;
        return (
          <Pressable
            key={panel.id}
            onPress={() => onChange(panel.id)}
            style={[
              styles.tab,
              isActive && styles.tabActive,
              index === PANELS.length - 1 && styles.moreTab,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={panel.label}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          >
            <Icon
              color={isActive ? colors.accent : colors.textMuted}
              size={22}
            />
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {panel.label}
            </Text>
          </Pressable>
        );
      })}
      {showMore && onMorePress ? (
        <Pressable
          onPress={onMorePress}
          style={[styles.tab, styles.moreTab]}
          accessibilityRole="button"
          accessibilityLabel="More options"
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        >
          <MoreHorizontal color={colors.accent} size={22} />
          <Text style={[styles.label, styles.labelActive]}>More</Text>
        </Pressable>
      ) : null}
      <View
        style={[
          styles.indicator,
          { left: `${indicatorLeft}%`, width: `${tabWidth * 100}%` },
        ]}
      />
    </View>
  );
}
