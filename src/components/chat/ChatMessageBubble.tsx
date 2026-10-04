import { memo, useMemo } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { CollapsiblePartGroup } from "@/components/chat/CollapsiblePartGroup";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
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
import { copyToClipboard } from "@/utils/clipboard";
import type { MessageWithParts, ChatPart } from "@/types/domain";

interface ChatMessageBubbleProps {
  message: MessageWithParts;
  defaultCollapsed: boolean;
  thinkingDefaultCollapsed: boolean;
  collapseResetKey: string;
  onRunCommand?: (command: string) => void;
  /**
   * Branch the conversation from this message.
   *
   * Absent — rather than present-and-inert — when the message cannot be branched
   * from, which is what keeps the action out of the sheet entirely. The bubble does
   * not decide that: `forkOffer` does, from the conversation the bubble is not given.
   */
  onFork?: (messageId: string) => void;
  /**
   * What the branch keeps and leaves behind, shown above the buttons.
   *
   * Required whenever `onFork` is set, and it is the reason the branch goes through
   * a sheet at all: which side of the cut each message lands on is a reading of the
   * API's `before` parameter, and saying it before the fork exists is what keeps a
   * wrong reading cheap.
   */
  forkSummary?: string;
}

function groupConsecutiveThinkingParts(parts: ChatPart[]): ChatPart[][] {
  const groups: ChatPart[][] = [];
  let currentGroup: ChatPart[] = [];

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

export const ChatMessageBubble = memo(function ChatMessageBubbleInner({
  message,
  defaultCollapsed,
  thinkingDefaultCollapsed,
  collapseResetKey,
  onRunCommand,
  onFork,
  forkSummary,
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

  const copyText = async () => {
    if (!text) return;
    // Only confirm when the clipboard write actually landed.
    if (await copyToClipboard(text)) {
      Alert.alert("Copied", "Message copied to clipboard");
    }
  };

  /**
   * Long press opens what can be done to this message, rather than doing one of them.
   *
   * Copy used to happen directly on long press, which left nowhere to put anything
   * else: a second action needs a choice, and a long press that silently picks one
   * of two is how a user copies a message when they meant to branch it. A sheet is
   * also the only place the fork's summary can be read before it runs.
   */
  /**
   * What a long press offers on this message.
   *
   * Built once per render and used for two decisions: whether the bubble responds to
   * the gesture at all, and what the sheet contains. Deriving both from one list is
   * what stops them disagreeing — a `hasActions` flag written out separately is a
   * second copy of the same rule, and the copy that drifts opens an alert whose only
   * button is Cancel.
   */
  const actions: { text: string; onPress?: () => void; style?: "cancel" }[] =
    [];

  // User messages have no Copy entry: their text is the prompt the user just typed
  // and still has in the composer.
  if (!isUser && text) {
    actions.push({ text: "Copy", onPress: () => void copyText() });
  }

  if (onFork && forkSummary) {
    actions.push({
      text: "Fork from here",
      onPress: () => onFork(message.info.id),
    });
  }

  const handleLongPress = () => {
    Alert.alert("Message", forkSummary, [
      ...actions,
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <Pressable
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.assistantBubble,
      ]}
      onLongPress={actions.length > 0 ? handleLongPress : undefined}
    >
      <Text style={styles.role}>{message.info.role}</Text>
      {text ? (
        isUser ? (
          <Text style={styles.messageText}>{text}</Text>
        ) : (
          <MarkdownRenderer
            content={text}
            onRunCommand={onRunCommand}
            defaultCollapsed
          />
        )
      ) : null}
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
    </Pressable>
  );
}, areEqual);

function areEqual(
  prev: ChatMessageBubbleProps,
  next: ChatMessageBubbleProps,
): boolean {
  return (
    prev.message.info.id === next.message.info.id &&
    prev.message.parts === next.message.parts &&
    prev.defaultCollapsed === next.defaultCollapsed &&
    prev.thinkingDefaultCollapsed === next.thinkingDefaultCollapsed &&
    prev.collapseResetKey === next.collapseResetKey &&
    prev.onRunCommand === next.onRunCommand &&
    // Identity, not truthiness: `handleFork` is one stable callback, and which
    // messages carry it is the fork point. Comparing the truthiness instead would
    // make every bubble re-render whenever the list grew, because "forkable" would
    // go from false to true across the whole list at once.
    prev.onFork === next.onFork &&
    prev.forkSummary === next.forkSummary
  );
}
