import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
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
  useInterruptSession,
  useSendPrompt,
  useSessionMessageStream,
  useSessionMessages,
} from "@/api/hooks";
import { useForkSession } from "@/api/fork";
import { forkOffer } from "@/api/session-fork";
import { toOpenCodeError } from "@/api/opencode/errors";
import { useHaptics } from "@/hooks/useHaptics";
import { AttachmentChips } from "@/components/AttachmentChips";
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
import { useTerminalBridge } from "@/context/TerminalBridgeContext";
import { useTheme } from "@/context/ThemeContext";
import { readFromClipboard } from "@/utils/clipboard";
import type { MessageWithParts } from "@/types/opencode";

interface AgentChatProps {
  chromeInset?: number;
  insets?: { bottom: number };
  onOpenPalette?: () => void;
  onCreateSession?: () => void;
  slashDraft?: string;
  onSlashDraftChange?: (value: string) => void;
  scrollToMessageId?: string | null;
  onOpenAgentPicker?: () => void;
  onOpenModelPicker?: () => void;
  /**
   * Bring the terminal panel up. "Run" writes to the shell, and the shell is
   * usually not mounted — the panel unmounts on every tab switch — so the write is
   * queued and replayed when the shell connects. Without this the command would
   * run invisibly, off-screen.
   */
  onShowTerminal?: () => void;
}

const INITIAL_SCROLL_METRICS: ChatScrollMetrics = {
  contentHeight: 0,
  layoutHeight: 0,
  offsetY: 0,
};

export function AgentChat({
  chromeInset = 0,
  insets,
  onOpenPalette,
  onCreateSession,
  slashDraft,
  onSlashDraftChange,
  scrollToMessageId,
  onOpenAgentPicker,
  onOpenModelPicker,
  onShowTerminal,
}: AgentChatProps) {
  const { colors, spacing, typography } = useTheme();
  const { collapseToolCalls, collapseThinking, thinkingDefaultMode } =
    usePreferences();
  const { trigger: haptic } = useHaptics();
  const { runInTerminal } = useTerminalBridge();
  const {
    sessionId,
    contextAttachments,
    clearContextAttachments,
    removeContextAttachment,
    enqueueMessage,
    status,
    addContextAttachment,
    agentActive,
    selectSession,
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
  const interruptSession = useInterruptSession(sessionId);
  const forkSession = useForkSession(sessionId);
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
          gap: spacing.sm,
          paddingBottom: spacing.md,
          paddingRight: spacing.sm,
        },
        listContentEmpty: {
          flexGrow: 1,
          justifyContent: "center",
        },
        composerWrap: {},
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
        stopButton: {
          alignItems: "center",
          backgroundColor: colors.danger,
          borderRadius: 999,
          height: 40,
          justifyContent: "center",
          paddingHorizontal: spacing.md,
        },
        stopButtonDisabled: {
          opacity: 0.6,
        },
        stopButtonText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "700",
        },
        pasteButton: {
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          height: 40,
          justifyContent: "center",
          paddingHorizontal: spacing.md,
        },
        pasteButtonText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
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

  const scrollToEndIfNearBottom = useCallback(
    (metrics?: ChatScrollMetrics) => {
      const m = metrics ?? scrollMetricsRef.current;
      if (isNearBottom(m)) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: true });
        });
      }
    },
    [isNearBottom],
  );

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
      const next = {
        contentHeight: height,
        layoutHeight: scrollMetricsRef.current.layoutHeight,
        offsetY: scrollMetricsRef.current.offsetY,
      };
      scrollMetricsRef.current = next;
      setScrollMetrics(next);
      scrollToEndIfNearBottom(next);
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

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
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
      haptic("light");

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
      haptic,
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

  /**
   * "Run" on a code block.
   *
   * This used to call `session.command` with the code as the *command name*,
   * which is why the button never worked: `session.command` runs named slash
   * commands, so a code block asked the server to find a command named `npm
   * test`. The code now goes to the shell instead, queued if no socket is up.
   */
  const handleRunCommand = useCallback(
    (command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return;
      haptic("light");
      runInTerminal(trimmed);
      // Queueing is not enough on its own — the user asked for this to run, and
      // they are looking at the chat.
      onShowTerminal?.();
    },
    [haptic, onShowTerminal, runInTerminal],
  );

  /**
   * Branch the conversation from a message, then go to the branch.
   *
   * Switching is the point. A fork that left the user in the original conversation
   * would read as nothing having happened, and the new session would only be
   * discoverable by going looking for it in the picker.
   *
   * The error is reported rather than swallowed: the fork failed and the user is
   * still looking at the conversation they asked to leave, so silently doing
   * nothing is the one outcome they could not distinguish from a dropped tap.
   */
  const handleFork = useCallback(
    (messageId: string) => {
      void forkSession.mutateAsync({ messageId }).then(
        (created) => selectSession(created.id),
        (error: unknown) => {
          Alert.alert("Could not fork", toOpenCodeError(error).message);
        },
      );
    },
    [forkSession, selectSession],
  );

  const renderItem = ({ item }: { item: MessageWithParts }) => {
    // Defensive: skip messages without required structure
    if (!item?.info?.id) {
      return null;
    }
    // `null` for the first message and for anything no longer in the list — the
    // same decision the bubble shows, taken from the same function, so the sheet
    // can never offer a fork the pure module considers meaningless.
    const fork = forkOffer(validMessages, item.info.id);
    return (
      <ChatMessageBubble
        collapseResetKey={collapseResetKey}
        defaultCollapsed={defaultCollapsed}
        forkSummary={fork?.summary}
        onFork={fork ? handleFork : undefined}
        thinkingDefaultCollapsed={thinkingDefaultCollapsed}
        message={item}
        onRunCommand={handleRunCommand}
      />
    );
  };

  const isEmpty = !isLoading && validMessages.length === 0;
  const isPending = sendPrompt.isPending || executeCommand.isPending;

  // `agentActive` is driven by the event stream (`isAgentBusyEvent`), so it stays
  // true for the whole turn - unlike `isPending`, which only covers the HTTP call
  // that queued the prompt. That is what makes Stop meaningful.
  const isStopping = interruptSession.isPending;

  const handleStop = useCallback(() => {
    void interruptSession.mutateAsync().catch(() => {
      // Swallowed deliberately: the busy flag is cleared by the authoritative
      // idle event, and a failed stop must not become an unhandled rejection.
    });
  }, [interruptSession]);

  const stopLabel = isStopping ? "Stopping…" : "Stop";

  return (
    <View style={styles.container}>
      <AttachmentChips
        attachments={contextAttachments}
        onClearAll={clearContextAttachments}
        onRemove={removeContextAttachment}
      />

      <View style={styles.listWrap}>
        <FlatList
          ref={listRef}
          contentContainerStyle={[
            styles.listContent,
            isEmpty ? styles.listContentEmpty : null,
          ]}
          data={validMessages}
          inverted
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

      <KeyboardAvoidingView
        keyboardVerticalOffset={
          Platform.OS === "ios" ? 0 : (insets?.bottom ?? 0)
        }
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.composerWrap}
      >
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
            onPress={async () => {
              const raw = await readFromClipboard();
              if (!raw) return;
              const trimmed = raw.trim();
              // Skip short single-line prose; there is nothing useful to attach.
              if (
                trimmed.length <= 50 &&
                !trimmed.includes("\n") &&
                !trimmed.includes("```")
              ) {
                return;
              }
              const looksLikeCode =
                /^(function|class|const|let|var|import|export|def|async|await)\b/.test(
                  trimmed,
                ) ||
                trimmed.includes("\n") ||
                trimmed.includes("```");
              if (!looksLikeCode) return;
              Alert.alert(
                "Paste as context?",
                "Clipboard contains code. Add as context attachment?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Add",
                    onPress: () => {
                      addContextAttachment("clipboard");
                    },
                  },
                ],
              );
            }}
            style={styles.pasteButton}
          >
            <Text style={styles.pasteButtonText}>Paste</Text>
          </Pressable>
          {/* While the agent is mid-turn, send is replaced by Stop: one primary action
              at a time, and a runaway turn can always be halted from here. */}
          {agentActive ? (
            <Pressable
              accessibilityLabel="Stop the agent"
              accessibilityRole="button"
              accessibilityState={{ busy: isStopping }}
              disabled={isStopping}
              onPress={handleStop}
              style={[
                styles.stopButton,
                isStopping && styles.stopButtonDisabled,
              ]}
            >
              <Text style={styles.stopButtonText}>{stopLabel}</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="Send message"
              accessibilityRole="button"
              accessibilityState={{ disabled: isPending }}
              disabled={isPending}
              onPress={handleSend}
              style={styles.sendButton}
            >
              {draft.startsWith("/") ? (
                <Command color={colors.onAccent} size={18} />
              ) : (
                <Send color={colors.onAccent} size={18} />
              )}
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
