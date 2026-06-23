import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { usePreferences } from "@/context/PreferencesContext";
import { useTheme } from "@/context/ThemeContext";

interface PromptPresetBarProps {
  onSelect: (text: string, sendImmediately: boolean) => void;
}

export function PromptPresetBar({ onSelect }: PromptPresetBarProps) {
  const { colors, spacing, typography } = useTheme();
  const { promptPresets, promptPresetTapToSend } = usePreferences();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          marginBottom: spacing.sm,
        },
        chip: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          marginRight: spacing.xs,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        chipText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
      }),
    [colors, spacing, typography],
  );

  if (promptPresets.length === 0) {
    return null;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
    >
      {promptPresets.map((preset) => (
        <Pressable
          key={preset.id}
          onPress={() => onSelect(preset.text, promptPresetTapToSend)}
          style={styles.chip}
        >
          <Text style={styles.chipText}>{preset.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
