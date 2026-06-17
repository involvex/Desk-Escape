import type { Session } from "@opencode-ai/sdk/client";
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
import { Plus, X } from "lucide-react-native";
import { useSessions } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";

interface SessionPickerProps {
  visible: boolean;
  onClose: () => void;
}

function formatSessionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function SessionPicker({ visible, onClose }: SessionPickerProps) {
  const { colors, spacing, typography } = useTheme();
  const { sessionId, selectSession, createSession } = useConnection();
  const { data: sessions = [], isLoading, refetch } = useSessions();

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
        createButton: {
          alignItems: "center",
          backgroundColor: colors.accentMuted,
          borderColor: colors.accent,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          justifyContent: "center",
          marginBottom: spacing.md,
          marginHorizontal: spacing.md,
          padding: spacing.md,
        },
        createText: {
          color: colors.accent,
          fontSize: typography.body,
          fontWeight: "600",
        },
        empty: {
          color: colors.textMuted,
          fontSize: typography.body,
          padding: spacing.lg,
          textAlign: "center",
        },
      }),
    [colors, spacing, typography],
  );

  const handleSelect = (session: Session) => {
    void selectSession(session.id).then(() => onClose());
  };

  const handleCreate = () => {
    void createSession().then(() => {
      void refetch();
      onClose();
    });
  };

  return (
    <Modal animationType="slide" transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Sessions</Text>
            <Pressable onPress={onClose}>
              <X color={colors.textMuted} size={20} />
            </Pressable>
          </View>

          <Pressable onPress={handleCreate} style={styles.createButton}>
            <Plus color={colors.accent} size={18} />
            <Text style={styles.createText}>New session</Text>
          </Pressable>

          {isLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.empty}>No sessions on this host yet.</Text>
              }
              renderItem={({ item }) => {
                const isActive = item.id === sessionId;
                return (
                  <Pressable
                    onPress={() => handleSelect(item)}
                    style={[styles.item, isActive ? styles.itemActive : null]}
                  >
                    <Text style={styles.itemTitle}>
                      {item.title || "Untitled session"}
                    </Text>
                    <Text style={styles.itemMeta}>
                      Updated {formatSessionTime(item.time.updated)}
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
