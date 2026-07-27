import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CollapsiblePartGroup } from "@/components/chat/CollapsiblePartGroup";
import { ThinkingPartGroup } from "@/components/chat/ThinkingPartGroup";
import {
  getMessageText,
  getPartLabel,
  getPartStatus,
  getToolBody,
  isCollapsiblePart,
  isToolPart,
  isThinkingPart,
  getThinkingMetadata,
} from "@/components/chat/message-parts";
import { usePreferences } from "@/context/PreferencesContext";
import { useTheme } from "@/context/ThemeContext";
import type { MessageWithParts, Part } from "@/types/opencode";

interface ChatMessageBubbleProps {
  message: MessageWithParts;
  defaultCollapsed: boolean;
  thinkingDefaultCollapsed: boolean;
  collapseResetKey: string;
}

function groupConsecutiveThinkingParts(parts: Part[]): Part[][] {
  const groups: Part[][] = [];
  let currentGroup: Part[] = [];

  for (const part of parts) {
    if (isThinkingPart(part)) {
      currentGroup.push(part);
    } else {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

export function ChatMessageBubble({
  message,
  defaultCollapsed,
  thinkingDefaultCollapsed,
  collapseResetKey,
}: ChatMessageBubbleProps) {
  const { colors, spacing, typography } = useTheme();
  const { autoExpandThinkingDuringStream, showThinkingTiming } =
    usePreferences();
  const isUser = message.info.role === "user";
  const text = getMessageText(message.parts);

  const collapsibleParts = useMemo(
    () => (isUser ? [] : message.parts.filter(isCollapsiblePart)),
    [isUser, message.parts],
  );

  const thinkingGroups = useMemo(
    () => groupConsecutiveThinkingParts(collapsibleParts),
    [collapsibleParts],
  );

  const toolParts = useMemo(
    () => collapsibleParts.filter(isToolPart),
    [collapsibleParts],
  );

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
      {thinkingGroups.map((group, index) => {
        const firstPart = group[0];
        if (!firstPart) return null;
        return (
          <ThinkingPartGroup
            key={`thinking-${firstPart.id}-${collapseResetKey}`}
            parts={group}
            defaultCollapsed={thinkingDefaultCollapsed}
            autoExpandDuringStream={autoExpandThinkingDuringStream}
            showTiming={showThinkingTiming}
            collapseResetKey={collapseResetKey}
          />
        );
      })}
      {toolParts.map((part) => {
        const body = getToolBody(part);
        const metadata = getThinkingMetadata(part);
        return (
          <CollapsiblePartGroup
            key={`${part.id}-${collapseResetKey}`}
            body={body || undefined}
            defaultCollapsed={defaultCollapsed}
            label={getPartLabel(part)}
            status={getPartStatus(part)}
            partType="tool"
            duration={metadata.duration}
            isStreaming={metadata.isStreaming}
          />
        );
      })}
    </View>
  );
}
