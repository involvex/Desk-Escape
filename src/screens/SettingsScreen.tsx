import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Trash2,
} from "lucide-react-native";
import { useOpenCodeConfig, useUpdateShell } from "@/api/hooks";
import {
  configCounts,
  configDirectories,
  configShell,
  configSources,
} from "@/api/opencode/config";
import { useBiometricLockContext } from "@/context/BiometricLockContext";
import { useOrientation } from "@/context/OrientationContext";
import {
  DEFAULT_PROMPT_PRESETS,
  TERMINAL_SHELL_OPTIONS,
  usePreferences,
} from "@/context/PreferencesContext";
import { useSessionMeta } from "@/context/SessionMetaContext";
import { useTheme } from "@/context/ThemeContext";
import { themeDefinitions } from "@/theme/palettes";
import { ensureNotificationPermissions } from "@/services/notifications";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type {
  FontScale,
  FontType,
  OrientationMode,
  PromptPreset,
} from "@/types/opencode";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

const themeOptions = Object.values(themeDefinitions).map((theme) => ({
  id: theme.name,
  label: theme.label,
}));

const orientationOptions: { id: OrientationMode; label: string }[] = [
  { id: "portrait", label: "Portrait only" },
  { id: "auto", label: "Auto-rotate" },
  { id: "landscape", label: "Landscape preferred" },
];

const fontScaleOptions: { id: FontScale; label: string }[] = [
  { id: 0.85, label: "Small" },
  { id: 1, label: "Default" },
  { id: 1.15, label: "Large" },
  { id: 1.3, label: "XL" },
];

const fontTypeOptions: { id: FontType; label: string }[] = [
  { id: "system", label: "System" },
  { id: "mono", label: "Monospace" },
];

export function SettingsScreen({ navigation }: Props) {
  const {
    colors,
    spacing,
    typography,
    themeName,
    setThemeName,
    fontScale,
    setFontScale,
    fontType,
    setFontType,
    syncTheme,
    setSyncTheme,
  } = useTheme();
  const { mode: orientationMode, setMode: setOrientationMode } =
    useOrientation();
  const {
    autoApprovePermissions,
    setAutoApprovePermissions,
    promptPresets,
    setPromptPresets,
    promptPresetTapToSend,
    setPromptPresetTapToSend,
    collapseToolCalls,
    setCollapseToolCalls,
    collapseThinking,
    setCollapseThinking,
    autoExpandThinkingDuringStream,
    setAutoExpandThinkingDuringStream,
    showThinkingTiming,
    setShowThinkingTiming,
    thinkingDefaultMode,
    setThinkingDefaultMode,
    terminalShell,
    setTerminalShell,
    defaultAgentKey,
    setDefaultAgentKey,
    defaultModel,
    setDefaultModel,
    hapticsEnabled,
    setHapticsEnabled,
    showCursorAgents,
    setShowCursorAgents,
  } = usePreferences();
  const { lockState, authenticate, setBiometricLockEnabled } =
    useBiometricLockContext();
  const { data: config, isLoading } = useOpenCodeConfig();
  const updateShell = useUpdateShell();
  const [shellDraft, setShellDraft] = useState<string | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState("");
  const [newPresetText, setNewPresetText] = useState("");
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplatePrompt, setNewTemplatePrompt] = useState("");
  const [hasBiometricHardware, setHasBiometricHardware] = useState(false);
  const { templates, addTemplate, deleteTemplate } = useSessionMeta();

  useEffect(() => {
    void LocalAuthentication.hasHardwareAsync().then(setHasBiometricHardware);
  }, []);

  const handleBiometricToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const success = await authenticate();
        if (success) {
          await setBiometricLockEnabled(true);
        }
      } else {
        await setBiometricLockEnabled(false);
      }
    },
    [authenticate, setBiometricLockEnabled],
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
        title: {
          color: colors.text,
          flex: 1,
          fontSize: typography.subtitle,
          fontWeight: "700",
        },
        content: {
          padding: spacing.md,
          paddingBottom: spacing.xl,
        },
        section: {
          marginBottom: spacing.lg,
        },
        sectionTitle: {
          color: colors.textMuted,
          fontSize: typography.caption,
          fontWeight: "700",
          letterSpacing: 0.6,
          marginBottom: spacing.sm,
          textTransform: "uppercase",
        },
        row: {
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: spacing.sm,
          padding: spacing.md,
        },
        rowLabel: {
          color: colors.text,
          flex: 1,
          fontSize: typography.body,
        },
        // For rows that carry a title plus a supporting line.
        rowText: {
          flex: 1,
          gap: 2,
        },
        chipRow: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.sm,
        },
        chip: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        chipActive: {
          borderColor: colors.accent,
          backgroundColor: colors.accentMuted,
        },
        chipText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        warning: {
          color: colors.warning,
          fontSize: typography.caption,
          marginBottom: spacing.sm,
        },
        jsonInput: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          color: colors.text,
          fontFamily: "monospace",
          fontSize: typography.mono,
          minHeight: 200,
          padding: spacing.md,
          textAlignVertical: "top",
        },
        saveButton: {
          alignItems: "center",
          backgroundColor: colors.accent,
          borderRadius: 12,
          marginTop: spacing.md,
          padding: spacing.md,
        },
        saveText: {
          color: colors.onAccent,
          fontSize: typography.body,
          fontWeight: "700",
        },
        meta: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: spacing.xs,
        },
        input: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          color: colors.text,
          fontSize: typography.body,
          marginBottom: spacing.sm,
          padding: spacing.md,
        },
        presetItem: {
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          marginBottom: spacing.sm,
          padding: spacing.md,
        },
        presetBody: {
          flex: 1,
        },
        presetLabel: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        presetText: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: 2,
        },
        linkButton: {
          color: colors.accent,
          fontSize: typography.caption,
          fontWeight: "600",
          marginBottom: spacing.sm,
        },
        aboutRow: {
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: spacing.sm,
          padding: spacing.md,
        },
        aboutLabel: {
          color: colors.textMuted,
          fontSize: typography.body,
        },
        aboutValue: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        repoLink: {
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          justifyContent: "center",
          marginTop: spacing.sm,
          padding: spacing.md,
        },
        repoLinkText: {
          color: colors.accent,
          fontSize: typography.body,
          fontWeight: "600",
        },
      }),
    [colors, spacing, typography],
  );

  // --- Server config ---------------------------------------------------------
  //
  // V2 dropped the old "Advanced JSON editor". `config.update` is
  // `PATCH /api/experimental/config` with the single field `{ shell }`, so
  // posting a whole config document is no longer a schema-valid request and a
  // free-form editor here could only ever fail (or, worse, silently do nothing
  // while appearing to save). `shell` is the one writable field, so that is the
  // one control, and the resolved config is exposed read-only for inspection.

  const counts = useMemo(() => configCounts(config), [config]);
  const serverShell = configShell(config);
  const shellValue = shellDraft ?? serverShell ?? "";
  const resolvedConfigJson = useMemo(
    () => (config ? JSON.stringify(config, null, 2) : ""),
    [config],
  );

  const applyShell = (next: string | null) => {
    setShellError(null);
    void updateShell
      .mutateAsync(next)
      .then(() => setShellDraft(null))
      .catch((error: unknown) => {
        setShellError(
          error instanceof Error ? error.message : "Failed to update shell.",
        );
      });
  };

  const handleSaveShell = () => {
    const trimmed = (shellDraft ?? serverShell ?? "").trim();
    applyShell(trimmed.length > 0 ? trimmed : null);
  };

  const handleClearShell = () => {
    setShellDraft("");
    applyShell(null);
  };

  const handleAddPreset = () => {
    const label = newPresetLabel.trim();
    const text = newPresetText.trim();
    if (!label || !text) {
      return;
    }

    const next: PromptPreset = {
      id: `${label.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      label,
      text,
    };
    setPromptPresets([...promptPresets, next]);
    setNewPresetLabel("");
    setNewPresetText("");
  };

  const handleRemovePreset = (id: string) => {
    setPromptPresets(promptPresets.filter((preset) => preset.id !== id));
  };

  const handleResetPresets = () => {
    setPromptPresets(DEFAULT_PROMPT_PRESETS);
  };

  const handleAddTemplate = () => {
    const name = newTemplateName.trim();
    const prompt = newTemplatePrompt.trim();
    if (!name || !prompt) {
      return;
    }
    void addTemplate({ name, prompt }).then(() => {
      setNewTemplateName("");
      setNewTemplatePrompt("");
    });
  };

  const handleNotificationPermission = () => {
    void ensureNotificationPermissions();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <ChevronLeft color={colors.text} size={22} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Appearance</Text>
            <View style={styles.chipRow}>
              {themeOptions.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setThemeName(option.id)}
                  style={[
                    styles.chip,
                    themeName === option.id ? styles.chipActive : null,
                  ]}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Follow system dark/light mode</Text>
              <Switch
                onValueChange={(value) => void setSyncTheme(value)}
                thumbColor={colors.text}
                trackColor={{
                  false: colors.border,
                  true: colors.accentMuted,
                }}
                value={syncTheme}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Font size</Text>
            <View style={styles.chipRow}>
              {fontScaleOptions.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setFontScale(option.id)}
                  style={[
                    styles.chip,
                    fontScale === option.id ? styles.chipActive : null,
                  ]}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Font type</Text>
            <View style={styles.chipRow}>
              {fontTypeOptions.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setFontType(option.id)}
                  style={[
                    styles.chip,
                    fontType === option.id ? styles.chipActive : null,
                  ]}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Orientation</Text>
            <View style={styles.chipRow}>
              {orientationOptions.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setOrientationMode(option.id)}
                  style={[
                    styles.chip,
                    orientationMode === option.id ? styles.chipActive : null,
                  ]}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Terminal shell</Text>
            <View style={styles.chipRow}>
              {TERMINAL_SHELL_OPTIONS.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setTerminalShell(option.id)}
                  style={[
                    styles.chip,
                    terminalShell === option.id ? styles.chipActive : null,
                  ]}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Default Agent</Text>
            <Text style={styles.meta}>
              Used for new sessions. Change per-session via the agent chip in
              the toolbar.
            </Text>
            {defaultAgentKey ? (
              <Pressable
                onPress={() => setDefaultAgentKey(null)}
                style={[
                  styles.row,
                  { backgroundColor: colors.surfaceElevated },
                ]}
              >
                <View
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Text style={styles.rowLabel}>
                    Current: {defaultAgentKey}
                  </Text>
                </View>
                <Text style={{ color: colors.danger }}>Clear</Text>
              </Pressable>
            ) : (
              <Text style={styles.meta}>
                No default agent set. First available agent will be used.
              </Text>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Default Model</Text>
            <Text style={styles.meta}>
              Used for new sessions. Change per-session via the model chip in
              the toolbar.
            </Text>
            {defaultModel ? (
              <Pressable
                onPress={() => setDefaultModel(null)}
                style={[
                  styles.row,
                  { backgroundColor: colors.surfaceElevated },
                ]}
              >
                <View
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Text style={styles.rowLabel}>
                    Current: {defaultModel.providerId}/{defaultModel.modelId}
                  </Text>
                </View>
                <Text style={{ color: colors.danger }}>Clear</Text>
              </Pressable>
            ) : (
              <Text style={styles.meta}>
                No default model set. First available model will be used.
              </Text>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Providers</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                Show Cursor Agents in main menu
              </Text>
              <Switch
                onValueChange={setShowCursorAgents}
                thumbColor={colors.text}
                trackColor={{ false: colors.border, true: colors.accentMuted }}
                value={showCursorAgents}
              />
            </View>
            <Text style={styles.meta}>
              Off by default — Desk Escape focuses on OpenCode. Enable to pick
              Cursor Cloud Agents from the start screen.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Agent chat</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Expand tool calls by default</Text>
              <Switch
                onValueChange={(expanded) => setCollapseToolCalls(!expanded)}
                thumbColor={colors.text}
                trackColor={{ false: colors.border, true: colors.accentMuted }}
                value={!collapseToolCalls}
              />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Haptic feedback</Text>
              <Switch
                onValueChange={setHapticsEnabled}
                thumbColor={colors.text}
                trackColor={{ false: colors.border, true: colors.accentMuted }}
                value={hapticsEnabled}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Thinking & Reasoning</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Collapse thinking by default</Text>
              <Switch
                onValueChange={setCollapseThinking}
                thumbColor={colors.text}
                trackColor={{ false: colors.border, true: colors.accentMuted }}
                value={collapseThinking}
              />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Auto-expand during streaming</Text>
              <Switch
                onValueChange={setAutoExpandThinkingDuringStream}
                thumbColor={colors.text}
                trackColor={{ false: colors.border, true: colors.accentMuted }}
                value={autoExpandThinkingDuringStream}
              />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Show timing information</Text>
              <Switch
                onValueChange={setShowThinkingTiming}
                thumbColor={colors.text}
                trackColor={{ false: colors.border, true: colors.accentMuted }}
                value={showThinkingTiming}
              />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Default mode</Text>
              <View style={styles.chipRow}>
                {(["default", "collapsed", "expanded", "auto"] as const).map(
                  (mode) => (
                    <Pressable
                      key={mode}
                      onPress={() => setThinkingDefaultMode(mode)}
                      style={[
                        styles.chip,
                        thinkingDefaultMode === mode ? styles.chipActive : null,
                      ]}
                    >
                      <Text style={styles.chipText}>
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Agent permissions</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Auto-approve all requests</Text>
              <Switch
                onValueChange={setAutoApprovePermissions}
                thumbColor={colors.text}
                trackColor={{ false: colors.border, true: colors.accentMuted }}
                value={autoApprovePermissions}
              />
            </View>
            <Pressable
              onPress={handleNotificationPermission}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>
                Enable permission notifications
              </Text>
              <ChevronRight color={colors.textMuted} size={18} />
            </Pressable>
            {/* Grants written by answering a prompt with "Always" outlive the
                session and the app install. Without a way to see and undo them
                the choice is not really the user's. */}
            <Pressable
              onPress={() => navigation.navigate("SavedPermissions")}
              style={styles.row}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Persistent grants</Text>
                <Text style={styles.meta}>
                  Review or revoke &quot;always allow&quot; choices
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={18} />
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Biometric Lock</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                {hasBiometricHardware
                  ? "Require biometric authentication"
                  : "Biometrics not available on this device"}
              </Text>
              <Switch
                disabled={!hasBiometricHardware}
                onValueChange={handleBiometricToggle}
                thumbColor={colors.text}
                trackColor={{
                  false: colors.border,
                  true: colors.accentMuted,
                }}
                value={lockState === "locked"}
              />
            </View>
            {!hasBiometricHardware ? (
              <Text style={styles.meta}>No biometric hardware detected.</Text>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Prompt presets</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                Tap preset to send immediately
              </Text>
              <Switch
                onValueChange={setPromptPresetTapToSend}
                thumbColor={colors.text}
                trackColor={{ false: colors.border, true: colors.accentMuted }}
                value={promptPresetTapToSend}
              />
            </View>
            <Pressable onPress={handleResetPresets}>
              <Text style={styles.linkButton}>Reset to defaults</Text>
            </Pressable>
            {promptPresets.map((preset) => (
              <View key={preset.id} style={styles.presetItem}>
                <View style={styles.presetBody}>
                  <Text style={styles.presetLabel}>{preset.label}</Text>
                  <Text numberOfLines={2} style={styles.presetText}>
                    {preset.text}
                  </Text>
                </View>
                <Pressable onPress={() => handleRemovePreset(preset.id)}>
                  <Trash2 color={colors.danger} size={18} />
                </Pressable>
              </View>
            ))}
            <TextInput
              onChangeText={setNewPresetLabel}
              placeholder="Preset label"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={newPresetLabel}
            />
            <TextInput
              multiline
              onChangeText={setNewPresetText}
              placeholder="Preset prompt text"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={newPresetText}
            />
            <Pressable onPress={handleAddPreset} style={styles.saveButton}>
              <Text style={styles.saveText}>Add preset</Text>
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Session templates</Text>
            <Text style={styles.meta}>
              Create a new session pre-filled with a prompt. Optional agent and
              model can be set from the workspace pickers as defaults.
            </Text>
            {templates.map((template) => (
              <View key={template.id} style={styles.presetItem}>
                <View style={styles.presetBody}>
                  <Text style={styles.presetLabel}>{template.name}</Text>
                  <Text numberOfLines={2} style={styles.presetText}>
                    {template.prompt}
                  </Text>
                </View>
                <Pressable onPress={() => void deleteTemplate(template.id)}>
                  <Trash2 color={colors.danger} size={18} />
                </Pressable>
              </View>
            ))}
            <TextInput
              onChangeText={setNewTemplateName}
              placeholder="Template name"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={newTemplateName}
            />
            <TextInput
              multiline
              onChangeText={setNewTemplatePrompt}
              placeholder="Template prompt text"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={newTemplatePrompt}
            />
            <Pressable onPress={handleAddTemplate} style={styles.saveButton}>
              <Text style={styles.saveText}>Add template</Text>
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Server config</Text>
            <Text style={styles.meta}>
              Agents: {counts.agents} · Commands: {counts.commands} · Plugins:{" "}
              {counts.plugins} · Providers: {counts.providers}
            </Text>
            <Text style={styles.meta}>
              {serverShell
                ? `Server shell: ${serverShell}`
                : "Server shell: not set (OpenCode default)"}
            </Text>
            <Text style={styles.warning}>
              OpenCode 2.x exposes one writable config field: `shell`. Agents,
              commands, providers, permissions and the plugin list are read-only
              over the API, so this app can no longer edit them.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setShellDraft}
              placeholder="Shell command, e.g. /bin/bash"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={shellValue}
            />
            {shellError ? (
              <Text style={styles.warning}>{shellError}</Text>
            ) : null}
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: spacing.md,
              }}
            >
              <Pressable
                disabled={updateShell.isPending}
                onPress={handleSaveShell}
                style={[styles.saveButton, { flex: 1, marginBottom: 0 }]}
              >
                <Text style={styles.saveText}>
                  {updateShell.isPending ? "Saving..." : "Save shell"}
                </Text>
              </Pressable>
              <Pressable
                disabled={updateShell.isPending || !serverShell}
                onPress={handleClearShell}
              >
                <Text style={styles.linkButton}>Clear</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => navigation.navigate("Plugins")}
              style={styles.row}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Plugin list</Text>
                <Text style={styles.meta}>
                  Read-only in OpenCode 2.x — view, check and update only.
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={18} />
            </Pressable>
            <Pressable
              onPress={() => setShowConfig((value) => !value)}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>Resolved config (read-only)</Text>
              <ChevronRight
                color={colors.textMuted}
                size={18}
                style={{
                  transform: [{ rotate: showConfig ? "90deg" : "0deg" }],
                }}
              />
            </Pressable>
          </View>

          {showConfig ? (
            <View style={styles.section}>
              <Text style={styles.meta}>
                Merged from{" "}
                {configSources(config).length > 0
                  ? configSources(config).join(" · ")
                  : "no config documents"}
                {configDirectories(config).length > 0
                  ? ` — searched ${configDirectories(config).join(", ")}`
                  : ""}
              </Text>
              <TextInput
                editable={false}
                multiline
                style={styles.jsonInput}
                value={resolvedConfigJson}
              />
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Version</Text>
              <Text style={styles.aboutValue}>1.0.1</Text>
            </View>
            <Pressable
              onPress={() => {
                import("expo-web-browser").then(({ openBrowserAsync }) => {
                  openBrowserAsync("https://github.com/involvex/Desk-Escape");
                });
              }}
              style={styles.repoLink}
            >
              <ExternalLink color={colors.accent} size={16} />
              <Text style={styles.repoLinkText}>View on GitHub</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
