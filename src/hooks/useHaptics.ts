import { useCallback } from "react";
import * as Haptics from "expo-haptics";
import { usePreferences } from "@/context/PreferencesContext";

export function useHaptics() {
  const { hapticsEnabled } = usePreferences();

  const trigger = useCallback(
    (type: "light" | "medium" | "heavy" | "success" | "warning" | "error") => {
      if (!hapticsEnabled) return;
      switch (type) {
        case "light":
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        case "medium":
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;
        case "heavy":
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          break;
        case "success":
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        case "warning":
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          break;
        case "error":
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          break;
      }
    },
    [hapticsEnabled],
  );

  return { trigger };
}
