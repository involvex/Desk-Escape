import type { Command } from "@opencode-ai/sdk/client";
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

interface SlashCommandMenuProps {
  commands: Command[];
  query: string;
  onSelect: (command: Command) => void;
}

function parseSlashInput(draft: string): { name: string; args: string } {
  const trimmed = draft.slice(1);
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { name: trimmed, args: "" };
  }
  return {
    name: trimmed.slice(0, spaceIndex),
    args: trimmed.slice(spaceIndex + 1),
  };
}

export function filterSlashCommands(
  commands: Command[],
  draft: string,
): Command[] {
  if (!draft.startsWith("/")) {
    return [];
  }

  const { name } = parseSlashInput(draft);
  if (!name) {
    return commands;
  }

  return commands.filter((command) =>
    command.name.toLowerCase().startsWith(name.toLowerCase()),
  );
}

export function SlashCommandMenu({
  commands,
  query,
  onSelect,
}: SlashCommandMenuProps) {
  const { colors, spacing, typography } = useTheme();
  const filtered = useMemo(
    () => filterSlashCommands(commands, query),
    [commands, query],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginBottom: spacing.sm,
          maxHeight: 180,
        },
        item: {
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        name: {
          color: colors.accent,
          fontSize: typography.body,
          fontWeight: "600",
        },
        description: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: 2,
        },
      }),
    [colors, spacing, typography],
  );

  if (!query.startsWith("/") || filtered.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.name}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable onPress={() => onSelect(item)} style={styles.item}>
            <Text style={styles.name}>/{item.name}</Text>
            {item.description ? (
              <Text style={styles.description}>{item.description}</Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

export { parseSlashInput };
