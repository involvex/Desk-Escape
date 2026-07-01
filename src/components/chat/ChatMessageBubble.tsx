import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CollapsiblePartGroup } from "@/components/chat/CollapsiblePartGroup";
import {
  getMessageText,
  getPartLabel,
  getPartStatus,
  getThinkingBody,
  getToolBody,
  isCollapsiblePart,
  isToolPart,
} from "@/components/chat/message-parts";
import { useTheme } from "@/context/ThemeContext";
import type { MessageWithParts } from "@/types/opencode";

interface ChatMessageBubbleProps {
  message: MessageWithParts;
  defaultCollapsed: boolean;
  collapseResetKey: string;
}

export function ChatMessageBubble({
  message,
  defaultCollapsed,
  collapseResetKey,
}: ChatMessageBubbleProps) {
  const { colors, spacing, typography } = useTheme();
  const isUser = message.info.role === "user";
  const text = getMessageText(message.parts);
  const collapsibleParts = isUser
    ? []
    : message.parts.filter(isCollapsiblePart);

  const styles = useMemo(
    () =>
      StyleSheet.create({
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
      }),
    [colors, spacing, typography],
  );

  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.assistantBubble,
      ]}
    >
      <Text style={styles.role}>{message.info.role}</Text>
      {text ? <Text style={styles.messageText}>{text}</Text> : null}
      {collapsibleParts.map((part) => {
        const body = isToolPart(part)
          ? getToolBody(part)
          : getThinkingBody(part);

        return (
          <CollapsiblePartGroup
            key={`${part.id}-${collapseResetKey}`}
            body={body || undefined}
            defaultCollapsed={defaultCollapsed}
            label={getPartLabel(part)}
            status={getPartStatus(part)}
          />
        );
      })}
    </View>
  );
}
