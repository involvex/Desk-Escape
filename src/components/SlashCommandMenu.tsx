import type { Command } from "@opencode-ai/sdk/client";
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

interface SlashCommandMenuProps {
  commands: Command[];
  query: string;
  onSelect: (command: Command) => void;
  onOpenAgentPicker?: () => void;
  onOpenModelPicker?: () => void;
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
  onOpenAgentPicker,
  onOpenModelPicker,
}: SlashCommandMenuProps) {
  const { colors, spacing, typography } = useTheme();
  const filtered = useMemo(
    () => filterSlashCommands(commands, query),
    [commands, query],
  );

  const { name } = parseSlashInput(query);
  const isAgentCommand = name === "agent";
  const isModelCommand = name === "model";

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

  if (
    !query.startsWith("/") ||
    (filtered.length === 0 && !isAgentCommand && !isModelCommand)
  ) {
    return null;
  }

  const handleItemPress = (command: Command) => {
    onSelect(command);
  };

  const handleAgentPress = () => {
    onOpenAgentPicker?.();
  };

  const handleModelPress = () => {
    onOpenModelPicker?.();
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.name}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable onPress={() => handleItemPress(item)} style={styles.item}>
            <Text style={styles.name}>/{item.name}</Text>
            {item.description ? (
              <Text style={styles.description}>{item.description}</Text>
            ) : null}
          </Pressable>
        )}
        ListFooterComponent={
          isAgentCommand || isModelCommand ? (
            <Pressable
              onPress={isAgentCommand ? handleAgentPress : handleModelPress}
              style={styles.item}
            >
              <Text style={styles.name}>
                {isAgentCommand ? "/agent" : "/model"}
              </Text>
              <Text style={styles.description}>
                {isAgentCommand
                  ? "Open agent picker to switch agent"
                  : "Open model picker to switch model"}
              </Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

export { parseSlashInput };
