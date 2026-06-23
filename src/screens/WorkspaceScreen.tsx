import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChevronDown,
  LogOut,
  MoreVertical,
  Settings,
} from "lucide-react-native";
import { getWorktreeName } from "@/api/client";
import { useCurrentProject } from "@/api/hooks";
import { AgentChat } from "@/components/AgentChat";
import {
  CommandPalette,
  themeCycleOrder,
  type PaletteAction,
} from "@/components/CommandPalette";
import { FileDrawer } from "@/components/FileDrawer";
import { PanelTabs } from "@/components/PanelTabs";
import { ProjectPicker } from "@/components/ProjectPicker";
import { SessionPicker } from "@/components/SessionPicker";
import { TerminalPanel } from "@/components/TerminalPanel";
import { UnifiedDiff } from "@/components/UnifiedDiff";
import { WorkspaceToolbar } from "@/components/WorkspaceToolbar";
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
  } = useConnection();
  const { data: currentProject } = useCurrentProject();
  const [activePanel, setActivePanel] = useState<WorkspacePanel>("agent");
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [slashDraft, setSlashDraft] = useState("");

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
          paddingVertical: spacing.sm,
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
          marginTop: 2,
        },
        statusDot: {
          borderRadius: 999,
          height: 8,
          width: 8,
        },
        content: {
          flex: 1,
        },
        overflowMenu: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          position: "absolute",
          right: spacing.md,
          top: 52,
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

  const statusColor =
    status === "connected"
      ? colors.success
      : status === "connecting"
        ? colors.warning
        : colors.danger;

  const showToolbar = activePanel === "agent";

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <View style={styles.headerTextWrap}>
          <Pressable onPress={() => setProjectPickerOpen(true)}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{worktreeName}</Text>
              <ChevronDown color={colors.textMuted} size={16} />
            </View>
            <Text style={styles.subtitle}>
              {session?.title ?? "Session"} · Agent{" "}
              {agentActive ? "active" : "idle"}
            </Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setOverflowOpen((current) => !current)}>
          <MoreVertical color={colors.textMuted} size={20} />
        </Pressable>
      </View>

      {overflowOpen ? (
        <View style={styles.overflowMenu}>
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

      <PanelTabs activePanel={activePanel} onChange={handlePanelChange} />

      {showToolbar ? (
        <WorkspaceToolbar
          compact={isLandscape}
          onCreateSession={() => void createSession()}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSessions={() => setSessionPickerOpen(true)}
        />
      ) : null}

      <View style={styles.content}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
          style={styles.content}
        >
          {activePanel === "terminal" ? (
            <TerminalPanel />
          ) : (
            <GestureDetector gesture={panGesture}>
              <View style={styles.content}>
                <AgentChat
                  onOpenPalette={() => setPaletteOpen(true)}
                  onCreateSession={() => void createSession()}
                  slashDraft={slashDraft}
                  onSlashDraftChange={setSlashDraft}
                />
              </View>
            </GestureDetector>
          )}
        </KeyboardAvoidingView>

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
    </SafeAreaView>
  );
}
