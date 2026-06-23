import type { Project } from "@opencode-ai/sdk/client";
import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, X } from "lucide-react-native";
import { getWorktreeName } from "@/api/client";
import { useProjects } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";

interface ProjectPickerProps {
  visible: boolean;
  onClose: () => void;
}

export function ProjectPicker({ visible, onClose }: ProjectPickerProps) {
  const { colors, spacing, typography } = useTheme();
  const { activeDirectory, selectProject } = useConnection();
  const { data: projects = [], isLoading } = useProjects();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          backgroundColor: "rgba(0,0,0,0.55)",
          flex: 1,
          justifyContent: "flex-end",
        },
        sheet: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: "72%",
          paddingBottom: spacing.lg,
          paddingTop: spacing.md,
        },
        header: {
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
          paddingHorizontal: spacing.md,
          paddingBottom: spacing.md,
        },
        title: {
          color: colors.text,
          fontSize: typography.subtitle,
          fontWeight: "700",
        },
        item: {
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginBottom: spacing.sm,
          marginHorizontal: spacing.md,
          padding: spacing.md,
        },
        itemActive: {
          borderColor: colors.accent,
        },
        itemTitle: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        itemMeta: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: spacing.xs,
        },
        empty: {
          color: colors.textMuted,
          fontSize: typography.body,
          padding: spacing.lg,
          textAlign: "center",
        },
        row: {
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
        },
      }),
    [colors, spacing, typography],
  );

  const handleSelect = (project: Project) => {
    void selectProject(project.worktree).then(() => onClose());
  };

  return (
    <Modal animationType="slide" transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Switch project</Text>
            <Pressable onPress={onClose}>
              <X color={colors.textMuted} size={20} />
            </Pressable>
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <FlatList
              data={projects}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.empty}>No projects on this host.</Text>
              }
              renderItem={({ item }) => {
                const isActive = item.worktree === activeDirectory;
                return (
                  <Pressable
                    onPress={() => handleSelect(item)}
                    style={[styles.item, isActive ? styles.itemActive : null]}
                  >
                    <View style={styles.row}>
                      <Text style={styles.itemTitle}>
                        {getWorktreeName(item.worktree)}
                      </Text>
                      {isActive ? (
                        <Check color={colors.accent} size={18} />
                      ) : null}
                    </View>
                    <Text numberOfLines={2} style={styles.itemMeta}>
                      {item.worktree}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
