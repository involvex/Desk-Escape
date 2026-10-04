import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  ChevronDown,
  BarChart3,
  LogOut,
  MoreVertical,
  Plus,
  Search,
  Settings,
  Share2,
  Undo2,
} from "lucide-react-native";
import { getWorktreeName } from "@/api/client";
import { toOpenCodeError } from "@/api/opencode/errors";
import { useCurrentProject, useSessionMessages } from "@/api/hooks";
import { useClearRevert, useCommitRevert, useStageRevert } from "@/api/revert";
import {
  canStartRevert,
  initialRevertState,
  latestRevertTargetId,
  revertReducer,
} from "@/api/session-revert";
import { AgentChat } from "@/components/AgentChat";
import { AgentPicker } from "@/components/AgentPicker";
import { ModelPicker } from "@/components/ModelPicker";
import {
  CommandPalette,
  themeCycleOrder,
  type PaletteAction,
} from "@/components/CommandPalette";
import { FileDrawer } from "@/components/FileDrawer";
import { MessageSearchBar } from "@/components/MessageSearchBar";
import { LandscapeFileRail } from "@/components/LandscapeFileRail";
import { BottomNavigation } from "@/components/BottomNavigation";
import { OfflineQueueIndicator } from "@/components/OfflineQueueIndicator";
import { PermissionBanner } from "@/components/PermissionBanner";
import { QuestionBanner } from "@/components/QuestionBanner";
import { ProjectPicker } from "@/components/ProjectPicker";
import { RevertBanner } from "@/components/RevertBanner";
import { SessionPicker } from "@/components/SessionPicker";
import { TerminalPanel } from "@/components/TerminalPanel";
import { UnifiedDiff } from "@/components/UnifiedDiff";
import { useBiometricLockContext } from "@/context/BiometricLockContext";
import { useConnection } from "@/context/ConnectionContext";
import { useOrientation } from "@/context/OrientationContext";
import { TerminalBridgeProvider } from "@/context/TerminalBridgeContext";
import { useTheme } from "@/context/ThemeContext";
import { useHaptics } from "@/hooks/useHaptics";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { WorkspacePanel } from "@/types/opencode";
import { shareSessionMarkdown } from "@/utils/export-session";

type Navigation = NativeStackNavigationProp<RootStackParamList, "Workspace">;

export function WorkspaceScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, spacing, typography, themeName, setThemeName } = useTheme();
  const { trigger: haptic } = useHaptics();
  const { isLandscape } = useOrientation();
  const {
    status,
    project,
    agentActive,
    disconnect,
    session,
    selectSession,
    selectProject,
    createSession,
    currentAgentKey,
    currentModel,
    setCurrentAgent,
    setCurrentModel,
  } = useConnection();
  const { data: currentProject } = useCurrentProject();
  const { data: messages = [] } = useSessionMessages(session?.id ?? null);
  const [activePanel, setActivePanel] = useState<WorkspacePanel>("agent");
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [slashDraft, setSlashDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTargetId, setSearchTargetId] = useState<string | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [revertState, dispatchRevert] = useReducer(
    revertReducer,
    initialRevertState,
  );
  const authAttempted = useRef(false);

  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const {
    lockState,
    authenticate,
    initialized,
    appActive,
    biometricAvailable,
  } = useBiometricLockContext();

  // --- Undo / revert -------------------------------------------------------
  //
  // `session.revert.*` is two-phase and the second phase is irreversible: it
  // rewinds the conversation *and* rewrites files on disk. So staging happens
  // first and shows what the server reports, and only a separate tap commits.

  const sessionId = session?.id ?? null;
  const revertTargetId = useMemo(
    () => latestRevertTargetId(messages),
    [messages],
  );
  const stageRevertMutation = useStageRevert(sessionId);
  const commitRevertMutation = useCommitRevert(sessionId);
  const clearRevertMutation = useClearRevert(sessionId);

  // Switching sessions must abandon any staged revert: the staging belongs to the
  // previous session, and carrying it over would offer to revert the wrong
  // conversation.
  useEffect(() => {
    dispatchRevert({ type: "reset" });
  }, [sessionId]);

  const handleStartRevert = useCallback(() => {
    if (!revertTargetId) {
      return;
    }
    dispatchRevert({ type: "stage" });
    stageRevertMutation.mutate(
      { messageId: revertTargetId, files: true },
      {
        onSuccess: (summary) => dispatchRevert({ type: "staged", summary }),
        onError: (error) =>
          dispatchRevert({
            type: "stage-failed",
            error: toOpenCodeError(error).message,
          }),
      },
    );
  }, [revertTargetId, stageRevertMutation]);

  const handleCommitRevert = useCallback(() => {
    dispatchRevert({ type: "commit" });
    commitRevertMutation.mutate(undefined, {
      onSuccess: () => dispatchRevert({ type: "committed" }),
      // Back to `staged`, not idle: the server still holds the staging, so the
      // user keeps the option to retry or to abandon it.
      onError: (error) =>
        dispatchRevert({
          type: "commit-failed",
          error: toOpenCodeError(error).message,
        }),
    });
  }, [commitRevertMutation]);

  const handleClearRevert = useCallback(() => {
    dispatchRevert({ type: "clear" });
    clearRevertMutation.mutate(undefined, {
      onError: (error) =>
        dispatchRevert({
          type: "commit-failed",
          error: toOpenCodeError(error).message,
        }),
    });
  }, [clearRevertMutation]);

  useEffect(() => {
    if (
      !initialized ||
      lockState !== "locked" ||
      !biometricAvailable ||
      // Prompt only once the app is foregrounded. Re-locking on background makes
      // `lockState` "locked" while nothing is on screen, and a biometric prompt
      // raised from the background fails on iOS - which read as a failed unlock
      // and bounced the user to Connection.
      !appActive ||
      authAttempted.current
    ) {
      return;
    }

    authAttempted.current = true;

    void authenticate().then((success) => {
      authAttempted.current = false;
      if (!success) {
        navigation.reset({ index: 0, routes: [{ name: "Connection" }] });
      }
    });
  }, [
    initialized,
    lockState,
    authenticate,
    navigation,
    biometricAvailable,
    appActive,
  ]);

  const worktreeName = getWorktreeName(
    currentProject?.worktree ?? project?.worktree,
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: {
          backgroundColor: colors.background,
          flex: 1,
        },
        header: {
          alignItems: "center",
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        headerTextWrap: {
          flex: 1,
        },
        titleRow: {
          alignItems: "center",
          flexDirection: "row",
          gap: 4,
        },
        title: {
          color: colors.text,
          fontSize: typography.subtitle,
          fontWeight: "700",
        },
        subtitle: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: 1,
        },
        statusDot: {
          borderRadius: 999,
          height: 6,
          width: 6,
        },
        content: {
          flex: 1,
        },
        flexFill: {
          flex: 1,
        },
        landscapeRow: {
          flex: 1,
          flexDirection: "row",
        },
        landscapeRail: {
          maxWidth: 240,
          minWidth: 180,
          width: "28%",
        },
        landscapeMain: {
          flex: 1,
        },
        overflowMenu: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          position: "absolute",
          right: spacing.md,
          top: 44,
          zIndex: 20,
        },
        overflowItem: {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        overflowText: {
          color: colors.text,
          fontSize: typography.body,
        },
        gateOverlay: {
          backgroundColor: colors.background,
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.md,
        },
        gateText: {
          color: colors.textMuted,
          fontSize: typography.body,
        },
      }),
    [colors, spacing, typography],
  );

  const handleDisconnect = useCallback(async () => {
    setActivePanel("agent");
    await disconnect();
    navigation.replace("Connection");
  }, [disconnect, navigation]);

  const handleExportSession = useCallback(async () => {
    if (!session) return;
    try {
      await shareSessionMarkdown(session, messages);
    } catch (error) {
      console.error("Failed to export session:", error);
    }
  }, [messages, session]);

  const handlePanelChange = useCallback(
    (panel: WorkspacePanel) => {
      setActivePanel(panel);
      setFileDrawerOpen(panel === "files");
      haptic("light");

      if (panel === "terminal") {
        setDiffOpen(false);
      }
    },
    [haptic],
  );

  /**
   * "Run" in the chat wrote to the shell, which is not on screen.
   *
   * Reusing `handlePanelChange` rather than a bare `setActivePanel` also closes the
   * diff: a code block and the diff it came from should not both be claiming the
   * screen. No haptic — `runInTerminal` already fires one for the tap, and two
   * buzzes for one action reads as a double-tap.
   */
  const handleShowTerminal = useCallback(() => {
    setActivePanel("terminal");
    setFileDrawerOpen(false);
    setDiffOpen(false);
  }, []);

  const onPanEnd = useCallback((translationX: number) => {
    if (translationX > 80) {
      setFileDrawerOpen(true);
      setActivePanel("files");
    } else if (translationX < -80) {
      setDiffOpen(true);
    }
  }, []);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .onEnd((event) => {
          runOnJS(onPanEnd)(event.translationX);
        }),
    [onPanEnd],
  );

  const handlePaletteAction = useCallback(
    (action: PaletteAction) => {
      switch (action.type) {
        case "session":
          void selectSession(action.session.id);
          break;
        case "project":
          if (action.project.worktree) {
            void selectProject(action.project.worktree);
          }
          break;
        case "command":
          setActivePanel("agent");
          setSlashDraft(`/${action.command.name} `);
          break;
        case "app":
          switch (action.id) {
            case "new-session":
              void createSession();
              break;
            case "settings":
              navigation.navigate("Settings");
              break;
            case "plugins":
              navigation.navigate("Plugins");
              break;
            case "theme": {
              const index = themeCycleOrder.indexOf(themeName);
              const next =
                themeCycleOrder[(index + 1) % themeCycleOrder.length] ??
                "oled-black";
              setThemeName(next);
              break;
            }
            case "disconnect":
              void handleDisconnect();
              break;
          }
          break;
      }
    },
    [
      createSession,
      handleDisconnect,
      navigation,
      selectProject,
      selectSession,
      setThemeName,
      themeName,
    ],
  );

  const handleOpenAgentPicker = useCallback(() => {
    setAgentPickerOpen(true);
  }, []);

  const handleCloseAgentPicker = useCallback(() => {
    setAgentPickerOpen(false);
  }, []);

  const handleSelectAgent = useCallback(
    (agentKey: string, agent: { name?: string; color?: string }) => {
      setCurrentAgent(agentKey);
      setAgentPickerOpen(false);
    },
    [setCurrentAgent],
  );

  const handleOpenModelPicker = useCallback(() => {
    setModelPickerOpen(true);
  }, []);

  const handleCloseModelPicker = useCallback(() => {
    setModelPickerOpen(false);
  }, []);

  const handleSelectModel = useCallback(
    (providerId: string, modelId: string, model: { name?: string }) => {
      setCurrentModel(providerId, modelId);
      setModelPickerOpen(false);
    },
    [setCurrentModel],
  );

  const statusColor =
    status === "connected"
      ? colors.success
      : status === "connecting" || status === "reconnecting"
        ? colors.warning
        : colors.danger;

  const chromeInset = 56 + insets.bottom;
  const isTablet = screenWidth >= 600;
  const useLandscapeSplit = isTablet && isLandscape && activePanel === "agent";

  const agentChat = (
    <AgentChat
      chromeInset={chromeInset}
      insets={insets}
      onCreateSession={() => void createSession()}
      onOpenPalette={() => setPaletteOpen(true)}
      onSlashDraftChange={setSlashDraft}
      scrollToMessageId={searchTargetId}
      slashDraft={slashDraft}
      onOpenAgentPicker={handleOpenAgentPicker}
      onOpenModelPicker={handleOpenModelPicker}
      onShowTerminal={handleShowTerminal}
    />
  );

  return (
    <TerminalBridgeProvider>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
        {lockState === "locked" && biometricAvailable && initialized ? (
          <View style={styles.gateOverlay}>
            <ActivityIndicator size="large" color={colors.textMuted} />
            <Text style={styles.gateText}>
              Authenticate to access workspace
            </Text>
          </View>
        ) : null}
        <View style={styles.header}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View style={styles.headerTextWrap}>
            <Pressable onPress={() => setProjectPickerOpen(true)}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{worktreeName}</Text>
                <ChevronDown color={colors.textMuted} size={16} />
              </View>
            </Pressable>
            <Pressable onPress={() => setSessionPickerOpen(true)}>
              <Text style={styles.subtitle}>
                {status === "reconnecting"
                  ? "Reconnecting..."
                  : `${session?.title ?? "Session"} · Agent ${agentActive ? "active" : "idle"}`}
              </Text>
            </Pressable>
          </View>
          <Pressable onPress={() => setOverflowOpen((current) => !current)}>
            <MoreVertical color={colors.textMuted} size={20} />
          </Pressable>
        </View>

        <OfflineQueueIndicator />

        {overflowOpen ? (
          <View style={styles.overflowMenu}>
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                void createSession();
              }}
              style={styles.overflowItem}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Plus color={colors.textMuted} size={16} />
                <Text style={styles.overflowText}>New session</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                setSessionPickerOpen(true);
              }}
              style={styles.overflowItem}
            >
              <Text style={styles.overflowText}>Sessions</Text>
            </Pressable>
            {session ? (
              <Pressable
                onPress={() => {
                  setOverflowOpen(false);
                  void handleExportSession();
                }}
                style={styles.overflowItem}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Share2 color={colors.textMuted} size={16} />
                  <Text style={styles.overflowText}>Export session</Text>
                </View>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                navigation.navigate("Stats");
              }}
              style={styles.overflowItem}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <BarChart3 color={colors.textMuted} size={16} />
                <Text style={styles.overflowText}>Usage &amp; cost</Text>
              </View>
            </Pressable>
            {session && canStartRevert(messages, revertState) ? (
              <Pressable
                onPress={() => {
                  setOverflowOpen(false);
                  handleStartRevert();
                }}
                style={styles.overflowItem}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Undo2 color={colors.textMuted} size={16} />
                  <Text style={styles.overflowText}>Undo last turn</Text>
                </View>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                setSearchOpen(true);
              }}
              style={styles.overflowItem}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Search color={colors.textMuted} size={16} />
                <Text style={styles.overflowText}>Search messages</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                setPaletteOpen(true);
              }}
              style={styles.overflowItem}
            >
              <Text style={styles.overflowText}>Command palette</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                navigation.navigate("Settings");
              }}
              style={styles.overflowItem}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Settings color={colors.textMuted} size={16} />
                <Text style={styles.overflowText}>Settings</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                void handleDisconnect();
              }}
              style={styles.overflowItem}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <LogOut color={colors.textMuted} size={16} />
                <Text style={styles.overflowText}>Disconnect</Text>
              </View>
            </Pressable>
          </View>
        ) : null}

        <PermissionBanner />
        <QuestionBanner />
        <RevertBanner
          hasTarget={revertTargetId !== null}
          onClear={handleClearRevert}
          onCommit={handleCommitRevert}
          state={revertState}
        />

        <View style={styles.content}>
          {activePanel === "terminal" ? (
            <TerminalPanel />
          ) : useLandscapeSplit ? (
            <View style={styles.landscapeRow}>
              <View style={styles.landscapeRail}>
                <LandscapeFileRail />
              </View>
              <View style={styles.landscapeMain}>
                <GestureDetector gesture={panGesture}>
                  {agentChat}
                </GestureDetector>
              </View>
            </View>
          ) : (
            <GestureDetector gesture={panGesture}>
              <View style={styles.flexFill}>{agentChat}</View>
            </GestureDetector>
          )}

          <FileDrawer
            onClose={() => {
              setFileDrawerOpen(false);
              if (activePanel === "files") {
                setActivePanel("agent");
              }
            }}
            visible={fileDrawerOpen}
          />
          <UnifiedDiff onClose={() => setDiffOpen(false)} visible={diffOpen} />
        </View>

        <BottomNavigation
          activePanel={activePanel}
          onChange={handlePanelChange}
          showMore
          onMorePress={() => setOverflowOpen((current) => !current)}
        />

        <SessionPicker
          onClose={() => setSessionPickerOpen(false)}
          visible={sessionPickerOpen}
        />
        <ProjectPicker
          onClose={() => setProjectPickerOpen(false)}
          visible={projectPickerOpen}
        />
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onSelectAction={handlePaletteAction}
          visible={paletteOpen}
        />
        <MessageSearchBar
          visible={searchOpen}
          onClose={() => setSearchOpen(false)}
          messages={messages}
          onSelectMessage={(messageId) => setSearchTargetId(messageId)}
        />
        <AgentPicker
          onClose={handleCloseAgentPicker}
          visible={agentPickerOpen}
          currentAgentKey={currentAgentKey}
          onSelectAgent={handleSelectAgent}
        />
        <ModelPicker
          onClose={handleCloseModelPicker}
          visible={modelPickerOpen}
          currentProviderId={currentModel?.providerId ?? null}
          currentModelId={currentModel?.modelId ?? null}
          onSelectModel={handleSelectModel}
        />
      </SafeAreaView>
    </TerminalBridgeProvider>
  );
}
