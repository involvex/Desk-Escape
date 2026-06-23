import { useMemo, useState } from "react";
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Command, Send } from "lucide-react-native";
import {
  useCommands,
  useExecuteCommand,
  useSendPrompt,
  useSessionMessageStream,
  useSessionMessages,
} from "@/api/hooks";
import { PromptPresetBar } from "@/components/PromptPresetBar";
import {
  parseSlashInput,
  SlashCommandMenu,
} from "@/components/SlashCommandMenu";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { MessageWithParts, Part, ToolPart } from "@/types/opencode";

interface AgentChatProps {
  chromeInset?: number;
  onOpenPalette?: () => void;
  onCreateSession?: () => void;
  slashDraft?: string;
  onSlashDraftChange?: (value: string) => void;
}

function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool";
}

function getMessageText(parts: Part[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => ("text" in part ? part.text : ""))
    .join("\n")
    .trim();
}

function formatToolLabel(part: ToolPart): string {
  const input = (part.state?.input ?? {}) as Record<string, unknown>;
  const toolName = part.tool?.toLowerCase() ?? "tool";

  switch (toolName) {
    case "read":
      return `read ${String(input.filePath ?? input.file ?? "")}`;
    case "edit":
      return `edit ${String(input.filePath ?? input.file ?? "")}`;
    case "bash":
      return `bash ${String(input.command ?? input.cmd ?? "").slice(0, 48)}`;
    default:
      return toolName;
  }
}

export function AgentChat({
  chromeInset = 0,
  onOpenPalette,
  onCreateSession,
  slashDraft,
  onSlashDraftChange,
}: AgentChatProps) {
  const { colors, spacing, typography } = useTheme();
  const { sessionId, contextAttachments } = useConnection();
  const { data: messages = [], isLoading } = useSessionMessages(sessionId);
  const { data: commands = [] } = useCommands();
  const sendPrompt = useSendPrompt(sessionId);
  const executeCommand = useExecuteCommand(sessionId);
  const [localDraft, setLocalDraft] = useState("");
  const isControlled = onSlashDraftChange !== undefined;
  const draft = isControlled ? (slashDraft ?? "") : localDraft;
  const setDraft = isControlled ? onSlashDraftChange : setLocalDraft;

  useSessionMessageStream(sessionId);

  const hintCommand = commands[0]?.name ?? "help";

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
        },
        list: {
          flex: 1,
        },
        listContent: {
          flexGrow: 1,
          gap: spacing.sm,
          paddingBottom: spacing.md,
        },
        listContentEmpty: {
          flexGrow: 1,
          justifyContent: "center",
        },
        bubble: {
          borderRadius: 14,
          borderWidth: 1,
          maxWidth: "92%",
          padding: spacing.md,
        },
        userBubble: {
          alignSelf: "flex-end",
          backgroundColor: colors.accentMuted,
          borderColor: colors.accent,
        },
        assistantBubble: {
          alignSelf: "flex-start",
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        role: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginBottom: spacing.xs,
          textTransform: "uppercase",
        },
        messageText: {
          color: colors.text,
          fontSize: typography.body,
          lineHeight: 20,
        },
        toolBadge: {
          alignSelf: "flex-start",
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          marginTop: spacing.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
        },
        toolText: {
          color: colors.textMuted,
          fontSize: typography.caption,
        },
        composerWrap: {
          paddingBottom: spacing.sm,
        },
        composer: {
          alignItems: "flex-end",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 16,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          padding: spacing.sm,
        },
        input: {
          color: colors.text,
          flex: 1,
          fontSize: typography.body,
          maxHeight: 120,
          minHeight: 40,
          paddingHorizontal: spacing.sm,
          paddingTop: spacing.sm,
        },
        sendButton: {
          alignItems: "center",
          backgroundColor: colors.accent,
          borderRadius: 999,
          height: 40,
          justifyContent: "center",
          width: 40,
        },
        attachments: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.xs,
          marginBottom: spacing.sm,
        },
        attachmentChip: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
        },
        attachmentText: {
          color: colors.textMuted,
          fontSize: typography.caption,
        },
        emptyWrap: {
          alignItems: "center",
          gap: spacing.md,
          paddingHorizontal: spacing.lg,
        },
        emptyText: {
          color: colors.textMuted,
          fontSize: typography.body,
          textAlign: "center",
        },
        emptyActions: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.sm,
          justifyContent: "center",
        },
        emptyButton: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        emptyButtonText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
      }),
    [colors, spacing, typography],
  );

  const submitText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sendPrompt.isPending || executeCommand.isPending) {
      return;
    }

    setDraft("");
    Keyboard.dismiss();

    if (trimmed.startsWith("/")) {
      const { name, args } = parseSlashInput(trimmed);
      if (!name) {
        return;
      }
      void executeCommand.mutateAsync({ command: name, arguments: args });
      return;
    }

    void sendPrompt.mutateAsync(trimmed);
  };

  const handleSend = () => {
    submitText(draft);
  };

  const handlePresetSelect = (text: string, sendImmediately: boolean) => {
    if (sendImmediately) {
      submitText(text);
      return;
    }
    setDraft(text);
  };

  const handleSlashSelect = (command: { name: string }) => {
    setDraft(`/${command.name} `);
  };

  const renderItem = ({ item }: { item: MessageWithParts }) => {
    const isUser = item.info.role === "user";
    const text = getMessageText(item.parts);
    const toolParts = item.parts.filter(isToolPart);

    return (
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        <Text style={styles.role}>{item.info.role}</Text>
        {text ? <Text style={styles.messageText}>{text}</Text> : null}
        {toolParts.map((part) => (
          <View key={part.id} style={styles.toolBadge}>
            <Text style={styles.toolText}>{formatToolLabel(part)}</Text>
          </View>
        ))}
      </View>
    );
  };

  const isEmpty = !isLoading && messages.length === 0;
  const isPending = sendPrompt.isPending || executeCommand.isPending;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={chromeInset}
      style={styles.container}
    >
      {contextAttachments.length > 0 ? (
        <View style={styles.attachments}>
          {contextAttachments.map((attachment) => (
            <View key={attachment.id} style={styles.attachmentChip}>
              <Text style={styles.attachmentText}>{attachment.path}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <FlatList
        contentContainerStyle={[
          styles.listContent,
          isEmpty ? styles.listContentEmpty : null,
        ]}
        data={messages}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.info.id}
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                Ask the agent to inspect, edit, or run commands. Try /
                {hintCommand} or open the command palette.
              </Text>
              <View style={styles.emptyActions}>
                {onCreateSession ? (
                  <Pressable
                    onPress={onCreateSession}
                    style={styles.emptyButton}
                  >
                    <Text style={styles.emptyButtonText}>New session</Text>
                  </Pressable>
                ) : null}
                {onOpenPalette ? (
                  <Pressable onPress={onOpenPalette} style={styles.emptyButton}>
                    <Text style={styles.emptyButtonText}>Command palette</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => setDraft(`/${hintCommand} `)}
                  style={styles.emptyButton}
                >
                  <Text style={styles.emptyButtonText}>Try /{hintCommand}</Text>
                </Pressable>
              </View>
            </View>
          )
        }
        renderItem={renderItem}
        style={styles.list}
      />

      <View style={styles.composerWrap}>
        <SlashCommandMenu
          commands={commands}
          onSelect={handleSlashSelect}
          query={draft}
        />
        <PromptPresetBar onSelect={handlePresetSelect} />
        <View style={styles.composer}>
          <TextInput
            multiline
            onChangeText={setDraft}
            placeholder="Message or /command..."
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={draft}
          />
          <Pressable
            disabled={isPending}
            onPress={handleSend}
            style={styles.sendButton}
          >
            {draft.startsWith("/") ? (
              <Command color="#04111A" size={18} />
            ) : (
              <Send color="#04111A" size={18} />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
