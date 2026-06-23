import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react-native";
import { useOpenCodeConfig, useUpdateConfig } from "@/api/hooks";
import { useOrientation } from "@/context/OrientationContext";
import {
  DEFAULT_PROMPT_PRESETS,
  usePreferences,
} from "@/context/PreferencesContext";
import { themeDefinitions, useTheme } from "@/context/ThemeContext";
import { ensureNotificationPermissions } from "@/services/notifications";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type {
  FontScale,
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

export function SettingsScreen({ navigation }: Props) {
  const {
    colors,
    spacing,
    typography,
    themeName,
    setThemeName,
    fontScale,
    setFontScale,
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
  } = usePreferences();
  const { data: config, isLoading } = useOpenCodeConfig();
  const updateConfig = useUpdateConfig();
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState("");
  const [newPresetText, setNewPresetText] = useState("");

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
          flex: 1,
          padding: spacing.md,
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
          color: "#04111A",
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
      }),
    [colors, spacing, typography],
  );

  const handleOpenAdvanced = () => {
    if (config) {
      setJsonDraft(JSON.stringify(config, null, 2));
    }
    setShowAdvanced(true);
  };

  const handleSaveJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as Record<string, unknown>;
      setJsonError(null);
      Alert.alert(
        "Update server config?",
        "This updates OpenCode globally on the connected host.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            style: "destructive",
            onPress: () => {
              void updateConfig.mutateAsync(
                parsed as Parameters<typeof updateConfig.mutateAsync>[0],
              );
            },
          },
        ],
      );
    } catch {
      setJsonError("Invalid JSON.");
    }
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
            <Text style={styles.sectionTitle}>Server config</Text>
            <Text style={styles.meta}>
              Agents: {Object.keys(config?.agent ?? {}).length} · Commands:{" "}
              {Object.keys(config?.command ?? {}).length} · Plugins:{" "}
              {(config?.plugin ?? []).length}
            </Text>
            <Pressable
              onPress={() => navigation.navigate("Plugins")}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>Plugin manager</Text>
              <ChevronRight color={colors.textMuted} size={18} />
            </Pressable>
            <Pressable onPress={handleOpenAdvanced} style={styles.row}>
              <Text style={styles.rowLabel}>Advanced JSON editor</Text>
              <ChevronRight color={colors.textMuted} size={18} />
            </Pressable>
          </View>

          {showAdvanced ? (
            <View style={styles.section}>
              <Text style={styles.warning}>
                Changes apply to the OpenCode server globally. A reload may be
                required for plugins.
              </Text>
              <TextInput
                multiline
                onChangeText={setJsonDraft}
                style={styles.jsonInput}
                value={jsonDraft}
              />
              {jsonError ? (
                <Text style={styles.warning}>{jsonError}</Text>
              ) : null}
              <Pressable
                disabled={updateConfig.isPending}
                onPress={handleSaveJson}
                style={styles.saveButton}
              >
                <Text style={styles.saveText}>
                  {updateConfig.isPending ? "Saving..." : "Save config"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
