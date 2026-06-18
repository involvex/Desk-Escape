import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { LogOut, MessagesSquare } from "lucide-react-native";
import { getWorktreeName } from "@/api/client";
import { useCurrentProject } from "@/api/hooks";
import { ActionPill } from "@/components/ActionPill";
import { AgentChat } from "@/components/AgentChat";
import { FileDrawer } from "@/components/FileDrawer";
import { SessionPicker } from "@/components/SessionPicker";
import {
  TerminalSheet,
  type TerminalSheetHandle,
} from "@/components/TerminalSheet";
import { UnifiedDiff } from "@/components/UnifiedDiff";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { WorkspacePanel } from "@/types/opencode";

type Navigation = NativeStackNavigationProp<RootStackParamList, "Workspace">;

const ACTION_PILL_HEIGHT = 52;

export function WorkspaceScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, project, agentActive, disconnect, config, session } =
    useConnection();
  const { data: currentProject } = useCurrentProject();
  const terminalRef = useRef<TerminalSheetHandle>(null);

  const [activePanel, setActivePanel] = useState<WorkspacePanel>("agent");
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const bottomInset =
    ACTION_PILL_HEIGHT + Math.max(insets.bottom, spacing.sm) + spacing.sm;

  const worktreeName = getWorktreeName(
    currentProject?.worktree ?? project?.worktree,
  );

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
        mainArea: {
          flex: 1,
          position: "relative",
        },
        content: {
          flex: 1,
        },
        actionPillWrap: {
          elevation: 10,
          zIndex: 10,
        },
      }),
    [colors, spacing, typography],
  );

  const handleDisconnect = useCallback(async () => {
    setActivePanel("agent");
    await disconnect();
    navigation.replace("Connection");
  }, [disconnect, navigation]);

  const handleTerminalDismiss = useCallback(() => {
    setActivePanel("agent");
  }, []);

  const handlePanelChange = useCallback((panel: WorkspacePanel) => {
    setActivePanel(panel);
    setFileDrawerOpen(panel === "files");

    if (panel === "terminal") {
      setDiffOpen(false);
    }
  }, []);

  useEffect(() => {
    if (activePanel === "terminal") {
      terminalRef.current?.present();
      return;
    }

    terminalRef.current?.dismiss();
  }, [activePanel]);

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

  const statusColor =
    status === "connected"
      ? colors.success
      : status === "connecting"
        ? colors.warning
        : colors.danger;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <View style={styles.headerTextWrap}>
          <Pressable onPress={() => setSessionPickerOpen(true)}>
            <Text style={styles.title}>{worktreeName}</Text>
            <Text style={styles.subtitle}>
              {session?.title ?? "Session"} ·{" "}
              {config?.baseUrl ?? "Disconnected"} · Agent{" "}
              {agentActive ? "active" : "idle"}
            </Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setSessionPickerOpen(true)}>
          <MessagesSquare color={colors.textMuted} size={20} />
        </Pressable>
        <Pressable onPress={() => void handleDisconnect()}>
          <LogOut color={colors.textMuted} size={20} />
        </Pressable>
      </View>

      <View style={styles.mainArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
          style={styles.content}
        >
          <GestureDetector gesture={panGesture}>
            <View style={styles.content}>
              <AgentChat bottomInset={bottomInset} />
            </View>
          </GestureDetector>
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

        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View style={styles.actionPillWrap}>
            <ActionPill
              activePanel={activePanel}
              keyboardHeight={keyboardHeight}
              onChange={handlePanelChange}
            />
          </View>
        </View>
      </View>

      <TerminalSheet ref={terminalRef} onDismiss={handleTerminalDismiss} />

      <SessionPicker
        onClose={() => setSessionPickerOpen(false)}
        visible={sessionPickerOpen}
      />
    </SafeAreaView>
  );
}
