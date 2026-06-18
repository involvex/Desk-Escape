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
import { Send } from "lucide-react-native";
import {
  useSendPrompt,
  useSessionMessageStream,
  useSessionMessages,
} from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { MessageWithParts, Part, ToolPart } from "@/types/opencode";

interface AgentChatProps {
  bottomInset?: number;
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

export function AgentChat({ bottomInset = 0 }: AgentChatProps) {
  const { colors, spacing, typography } = useTheme();
  const { sessionId, contextAttachments } = useConnection();
  const { data: messages = [], isLoading } = useSessionMessages(sessionId);
  const sendPrompt = useSendPrompt(sessionId);
  const [draft, setDraft] = useState("");

  useSessionMessageStream(sessionId);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          paddingBottom: bottomInset,
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
        composer: {
          alignItems: "flex-end",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 16,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          marginBottom: spacing.sm,
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
        emptyText: {
          color: colors.textMuted,
          fontSize: typography.body,
          textAlign: "center",
        },
      }),
    [bottomInset, colors, spacing, typography],
  );

  const handleSend = () => {
    const text = draft.trim();
    if (!text || sendPrompt.isPending) {
      return;
    }

    setDraft("");
    Keyboard.dismiss();
    void sendPrompt.mutateAsync(text);
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

  return (
    <View style={styles.container}>
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
            <Text style={styles.emptyText}>
              Ask the agent to inspect, edit, or run commands on your host
              workspace.
            </Text>
          )
        }
        renderItem={renderItem}
        style={styles.list}
      />

      <View style={styles.composer}>
        <TextInput
          multiline
          onChangeText={setDraft}
          placeholder="Message the agent..."
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={draft}
        />
        <Pressable
          disabled={sendPrompt.isPending}
          onPress={handleSend}
          style={styles.sendButton}
        >
          <Send color="#04111A" size={18} />
        </Pressable>
      </View>
    </View>
  );
}
