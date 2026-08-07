import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Keyboard,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";
import {
  ChatScrollControls,
  type ChatScrollMetrics,
  SCROLL_EDGE_THRESHOLD,
} from "@/components/chat/ChatScrollControls";
import { ChatScrollBar } from "@/components/chat/ChatScrollBar";
import { PromptPresetBar } from "@/components/PromptPresetBar";
import {
  parseSlashInput,
  SlashCommandMenu,
} from "@/components/SlashCommandMenu";
import { useConnection } from "@/context/ConnectionContext";
import { usePreferences } from "@/context/PreferencesContext";
import { useTheme } from "@/context/ThemeContext";
import type { MessageWithParts } from "@/types/opencode";

interface AgentChatProps {
  chromeInset?: number;
  onOpenPalette?: () => void;
  onCreateSession?: () => void;
  slashDraft?: string;
  onSlashDraftChange?: (value: string) => void;
  scrollToMessageId?: string | null;
  onOpenAgentPicker?: () => void;
  onOpenModelPicker?: () => void;
}

const INITIAL_SCROLL_METRICS: ChatScrollMetrics = {
  contentHeight: 0,
  layoutHeight: 0,
  offsetY: 0,
};

export function AgentChat({
  chromeInset = 0,
  onOpenPalette,
  onCreateSession,
  slashDraft,
  onSlashDraftChange,
  scrollToMessageId,
  onOpenAgentPicker,
  onOpenModelPicker,
}: AgentChatProps) {
  const { colors, spacing, typography } = useTheme();
  const { collapseToolCalls, collapseThinking, thinkingDefaultMode } =
    usePreferences();
  const {
    sessionId,
    contextAttachments,
    clearContextAttachments,
    enqueueMessage,
    status,
  } = useConnection();
  const { data: messages = [], isLoading } = useSessionMessages(sessionId);

  // Filter out any malformed messages
  const validMessages = useMemo(
    () => messages.filter((m) => m?.info?.id),
    [messages],
  );

  const { data: commands = [] } = useCommands();
  const sendPrompt = useSendPrompt(sessionId);
  const executeCommand = useExecuteCommand(sessionId);
  const [localDraft, setLocalDraft] = useState("");
  const [scrollMetrics, setScrollMetrics] = useState<ChatScrollMetrics>(
    INITIAL_SCROLL_METRICS,
  );
  const [sessionCollapseMode, setSessionCollapseMode] = useState<
    "default" | "collapsed" | "expanded"
  >("default");
  const listRef = useRef<FlatList<MessageWithParts>>(null);
  const scrollMetricsRef = useRef(scrollMetrics);

  useEffect(() => {
    scrollMetricsRef.current = scrollMetrics;
  }, [scrollMetrics]);
  const isControlled = onSlashDraftChange !== undefined;
  const draft = isControlled ? (slashDraft ?? "") : localDraft;
  const setDraft = isControlled ? onSlashDraftChange : setLocalDraft;

  useSessionMessageStream(sessionId);

  const hintCommand = commands[0]?.name ?? "help";
  const lastMessageId = validMessages.at(-1)?.info.id;

  const defaultCollapsed =
    sessionCollapseMode === "collapsed"
      ? true
      : sessionCollapseMode === "expanded"
        ? false
        : collapseToolCalls;

  const thinkingDefaultCollapsed =
    sessionCollapseMode === "collapsed"
      ? true
      : sessionCollapseMode === "expanded"
        ? false
        : thinkingDefaultMode === "collapsed"
          ? true
          : thinkingDefaultMode === "expanded"
            ? false
            : thinkingDefaultMode === "auto"
              ? false
              : collapseThinking;

  const collapseResetKey = `${sessionCollapseMode}-${collapseToolCalls}-${thinkingDefaultMode}`;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
        },
        listWrap: {
          flex: 1,
          position: "relative",
        },
        list: {
          flex: 1,
        },
        listContent: {
          flexGrow: 1,
          gap: spacing.sm,
          paddingBottom: spacing.md,
          paddingRight: spacing.sm,
        },
        listContentEmpty: {
          flexGrow: 1,
          justifyContent: "center",
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

  const isNearBottom = useCallback((metrics: ChatScrollMetrics) => {
    const { contentHeight, layoutHeight, offsetY } = metrics;
    if (contentHeight <= layoutHeight) {
      return true;
    }
    return offsetY + layoutHeight >= contentHeight - SCROLL_EDGE_THRESHOLD;
  }, []);

  const scrollToEndIfNearBottom = useCallback(() => {
    if (isNearBottom(scrollMetricsRef.current)) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [isNearBottom]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      setScrollMetrics({
        contentHeight: contentSize.height,
        layoutHeight: layoutMeasurement.height,
        offsetY: contentOffset.y,
      });
    },
    [],
  );

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      const next = { ...scrollMetricsRef.current, contentHeight: height };
      scrollMetricsRef.current = next;
      setScrollMetrics(next);
      scrollToEndIfNearBottom();
    },
    [scrollToEndIfNearBottom],
  );

  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    const layoutHeight = event.nativeEvent.layout.height;
    setScrollMetrics((current) => ({
      ...current,
      layoutHeight,
    }));
  }, []);

  const handleScrollOffset = useCallback((offset: number) => {
    setScrollMetrics((current) => ({ ...current, offsetY: offset }));
  }, []);

  const onScrollToIndexFailed = useCallback((info: { index: number }) => {
    // Fall back to scrollToOffset when getItemLayout is not available
    // Use a rough estimate: average ~200px per message
    const estimatedOffset = info.index * 200;
    const maxOffset = Math.max(
      scrollMetricsRef.current.contentHeight -
        scrollMetricsRef.current.layoutHeight,
      0,
    );
    listRef.current?.scrollToOffset({
      offset: Math.min(estimatedOffset, maxOffset),
      animated: true,
    });
  }, []);

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const handleToggleCollapseMode = useCallback(() => {
    setSessionCollapseMode((mode) => {
      if (mode === "default") {
        return "collapsed";
      }
      if (mode === "collapsed") {
        return "expanded";
      }
      return "default";
    });
  }, []);

  useEffect(() => {
    if (!lastMessageId || !listRef.current) {
      return;
    }
    scrollToEndIfNearBottom();
  }, [lastMessageId, scrollToEndIfNearBottom]);

  useEffect(() => {
    if (!scrollToMessageId || !listRef.current) return;
    const index = validMessages.findIndex(
      (m) => m.info.id === scrollToMessageId,
    );
    if (index === -1) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.3,
      });
    });
  }, [scrollToMessageId, validMessages]);

  const submitText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendPrompt.isPending || executeCommand.isPending) {
        return;
      }

      setDraft("");
      Keyboard.dismiss();

      if (status !== "connected") {
        const attachmentPayload = contextAttachments.map((a) => ({
          path: a.path,
          name: a.path.split("/").pop() ?? a.path,
        }));
        void enqueueMessage(trimmed, attachmentPayload);
        clearContextAttachments();
        return;
      }

      if (trimmed.startsWith("/")) {
        const { name, args } = parseSlashInput(trimmed);
        if (!name) {
          return;
        }
        void executeCommand.mutateAsync({ command: name, arguments: args });
        return;
      }

      void sendPrompt.mutateAsync(trimmed);
    },
    [
      status,
      enqueueMessage,
      contextAttachments,
      clearContextAttachments,
      sendPrompt,
      executeCommand,
      setDraft,
    ],
  );

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

  const handleRunCommand = useCallback(
    (command: string) => {
      if (!sessionId || !command.trim()) return;
      void executeCommand.mutateAsync({ command: command.trim() });
    },
    [executeCommand, sessionId],
  );

  const renderItem = ({ item }: { item: MessageWithParts }) => {
    // Defensive: skip messages without required structure
    if (!item?.info?.id) {
      return null;
    }
    return (
      <ChatMessageBubble
        collapseResetKey={collapseResetKey}
        defaultCollapsed={defaultCollapsed}
        thinkingDefaultCollapsed={thinkingDefaultCollapsed}
        message={item}
        onRunCommand={handleRunCommand}
      />
    );
  };

  const isEmpty = !isLoading && validMessages.length === 0;
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

      <View style={styles.listWrap}>
        <FlatList
          ref={listRef}
          contentContainerStyle={[
            styles.listContent,
            isEmpty ? styles.listContentEmpty : null,
          ]}
          data={validMessages}
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
                    <Pressable
                      onPress={onOpenPalette}
                      style={styles.emptyButton}
                    >
                      <Text style={styles.emptyButtonText}>
                        Command palette
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => setDraft(`/${hintCommand} `)}
                    style={styles.emptyButton}
                  >
                    <Text style={styles.emptyButtonText}>
                      Try /{hintCommand}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )
          }
          onContentSizeChange={handleContentSizeChange}
          onLayout={handleListLayout}
          onScroll={handleScroll}
          onScrollToIndexFailed={onScrollToIndexFailed}
          renderItem={renderItem}
          scrollEventThrottle={16}
          style={styles.list}
        />
        <ChatScrollBar
          listRef={listRef}
          onScrollOffset={handleScrollOffset}
          scrollMetrics={scrollMetrics}
        />
        <ChatScrollControls
          onScrollToBottom={scrollToBottom}
          onScrollToTop={scrollToTop}
          onToggleCollapseMode={handleToggleCollapseMode}
          scrollMetrics={scrollMetrics}
          sessionCollapseMode={sessionCollapseMode}
        />
      </View>

      <View style={styles.composerWrap}>
        <SlashCommandMenu
          commands={commands}
          onSelect={handleSlashSelect}
          query={draft}
          onOpenAgentPicker={onOpenAgentPicker}
          onOpenModelPicker={onOpenModelPicker}
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
