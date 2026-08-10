import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChevronDown,
  LogOut,
  MoreVertical,
  Plus,
  Search,
  Settings,
} from "lucide-react-native";
import { getWorktreeName } from "@/api/client";
import { useCurrentProject, useSessionMessages } from "@/api/hooks";
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
import { ProjectPicker } from "@/components/ProjectPicker";
import { SessionPicker } from "@/components/SessionPicker";
import { TerminalPanel } from "@/components/TerminalPanel";
import { UnifiedDiff } from "@/components/UnifiedDiff";
import { useBiometricLockContext } from "@/context/BiometricLockContext";
import { useConnection } from "@/context/ConnectionContext";
import { useOrientation } from "@/context/OrientationContext";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { WorkspacePanel } from "@/types/opencode";

type Navigation = NativeStackNavigationProp<RootStackParamList, "Workspace">;

export function WorkspaceScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, spacing, typography, themeName, setThemeName } = useTheme();
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
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const authAttempted = useRef(false);

  const { width: screenWidth } = useWindowDimensions();

  const { lockState, authenticate, initialized } = useBiometricLockContext();

  useEffect(() => {
    void (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricAvailable(hasHardware && isEnrolled);
    })();
  }, []);

  useEffect(() => {
    if (
      !initialized ||
      lockState !== "locked" ||
      !biometricAvailable ||
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
  }, [initialized, lockState, authenticate, navigation, biometricAvailable]);

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
          paddingBottom: 56,
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

  const handlePanelChange = useCallback((panel: WorkspacePanel) => {
    setActivePanel(panel);
    setFileDrawerOpen(panel === "files");

    if (panel === "terminal") {
      setDiffOpen(false);
    }
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
          void selectProject(action.project.worktree);
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

  const chromeInset = 56;
  const isTablet = screenWidth >= 600;
  const useLandscapeSplit = isTablet && isLandscape && activePanel === "agent";

  const agentChat = (
    <AgentChat
      chromeInset={chromeInset}
      onCreateSession={() => void createSession()}
      onOpenPalette={() => setPaletteOpen(true)}
      onSlashDraftChange={setSlashDraft}
      scrollToMessageId={searchTargetId}
      slashDraft={slashDraft}
      onOpenAgentPicker={handleOpenAgentPicker}
      onOpenModelPicker={handleOpenModelPicker}
    />
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      {lockState === "locked" && biometricAvailable && initialized ? (
        <View style={styles.gateOverlay}>
          <ActivityIndicator size="large" color={colors.textMuted} />
          <Text style={styles.gateText}>Authenticate to access workspace</Text>
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
            <View style={styles.content}>{agentChat}</View>
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
  );
}
