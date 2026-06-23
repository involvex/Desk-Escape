import type { Command, Project, Session } from "@opencode-ai/sdk/client";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Search, X } from "lucide-react-native";
import { getWorktreeName } from "@/api/client";
import { useCommands, useProjects, useSessions } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { ThemeName } from "@/types/opencode";

export type PaletteAction =
  | { type: "session"; session: Session }
  | { type: "project"; project: Project }
  | { type: "command"; command: Command }
  | { type: "app"; id: string; label: string };

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  onSelectAction: (action: PaletteAction) => void;
}

function matchesQuery(text: string, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return text.toLowerCase().includes(normalized);
}

export function CommandPalette({
  visible,
  onClose,
  onSelectAction,
}: CommandPaletteProps) {
  const { colors, spacing, typography } = useTheme();
  const { sessionId } = useConnection();
  const { data: sessions = [] } = useSessions();
  const { data: projects = [] } = useProjects();
  const { data: commands = [] } = useCommands();
  const [query, setQuery] = useState("");

  const appActions: PaletteAction[] = useMemo(
    () => [
      { type: "app", id: "new-session", label: "New session" },
      { type: "app", id: "settings", label: "Settings" },
      { type: "app", id: "plugins", label: "Plugin manager" },
      { type: "app", id: "theme", label: "Cycle theme" },
      { type: "app", id: "disconnect", label: "Disconnect" },
    ],
    [],
  );

  const items = useMemo(() => {
    const result: PaletteAction[] = [];

    for (const session of sessions) {
      const label = session.title || "Untitled session";
      if (matchesQuery(label, query) || matchesQuery(session.id, query)) {
        result.push({ type: "session", session });
      }
    }

    for (const project of projects) {
      const label = getWorktreeName(project.worktree);
      if (matchesQuery(label, query) || matchesQuery(project.worktree, query)) {
        result.push({ type: "project", project });
      }
    }

    for (const command of commands) {
      const label = `/${command.name}`;
      if (
        matchesQuery(label, query) ||
        matchesQuery(command.description ?? "", query)
      ) {
        result.push({ type: "command", command });
      }
    }

    for (const action of appActions) {
      if (action.type === "app" && matchesQuery(action.label, query)) {
        result.push(action);
      }
    }

    return result;
  }, [appActions, commands, projects, query, sessions]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          backgroundColor: "rgba(0,0,0,0.6)",
          flex: 1,
          paddingTop: spacing.xl * 2,
        },
        sheet: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 16,
          borderWidth: 1,
          flex: 1,
          marginHorizontal: spacing.md,
          marginBottom: spacing.lg,
          overflow: "hidden",
        },
        header: {
          alignItems: "center",
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          padding: spacing.md,
        },
        input: {
          color: colors.text,
          flex: 1,
          fontSize: typography.body,
        },
        item: {
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
        },
        itemTitle: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        itemMeta: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: 2,
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

  const getLabel = (item: PaletteAction): string => {
    switch (item.type) {
      case "session":
        return item.session.title || "Untitled session";
      case "project":
        return getWorktreeName(item.project.worktree);
      case "command":
        return `/${item.command.name}`;
      case "app":
        return item.label;
    }
  };

  const getMeta = (item: PaletteAction): string => {
    switch (item.type) {
      case "session":
        return item.session.id === sessionId ? "Active session" : "Session";
      case "project":
        return item.project.worktree;
      case "command":
        return item.command.description ?? "Slash command";
      case "app":
        return "App action";
    }
  };

  const handleSelect = (item: PaletteAction) => {
    setQuery("");
    onSelectAction(item);
    onClose();
  };

  return (
    <Modal animationType="fade" transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <Search color={colors.textMuted} size={18} />
            <TextInput
              autoFocus
              onChangeText={setQuery}
              placeholder="Search sessions, projects, commands..."
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={query}
            />
            <Pressable onPress={onClose}>
              <X color={colors.textMuted} size={18} />
            </Pressable>
          </View>

          <FlatList
            data={items}
            keyExtractor={(item, index) => {
              switch (item.type) {
                case "session":
                  return `session-${item.session.id}`;
                case "project":
                  return `project-${item.project.id}`;
                case "command":
                  return `command-${item.command.name}`;
                case "app":
                  return `app-${item.id}`;
                default:
                  return `item-${index}`;
              }
            }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>
                No matches for &ldquo;{query}&rdquo;.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable onPress={() => handleSelect(item)} style={styles.item}>
                <Text style={styles.itemTitle}>{getLabel(item)}</Text>
                <Text numberOfLines={2} style={styles.itemMeta}>
                  {getMeta(item)}
                </Text>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const themeCycleOrder: ThemeName[] = [
  "oled-black",
  "dev-dark",
  "dev-light",
  "midnight-purple",
  "solarized-dark",
  "nord",
  "high-contrast",
];
