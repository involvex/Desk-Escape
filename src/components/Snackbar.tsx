import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/context/ThemeContext";

export interface SnackbarAction {
  label: string;
  onPress: () => void;
}

interface SnackbarProps {
  message: string;
  visible: boolean;
  action?: SnackbarAction;
  onDismiss: () => void;
  durationMs?: number;
}

export function Snackbar({
  message,
  visible,
  action,
  onDismiss,
  durationMs = 5000,
}: SnackbarProps) {
  const { colors, spacing, typography } = useTheme();
  const translateY = useSharedValue(100);
  const opacity = useSharedValue(0);
  const dismissedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      dismissedRef.current = false;
      translateY.value = withTiming(0, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
      opacity.value = withTiming(1, { duration: 180 });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!dismissedRef.current) {
          dismissedRef.current = true;
          onDismiss();
        }
      }, durationMs);
    } else {
      translateY.value = withTiming(100, { duration: 180 });
      opacity.value = withTiming(0, { duration: 160 });
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, durationMs, onDismiss, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const styles = StyleSheet.create({
    container: {
      bottom: spacing.lg,
      left: spacing.md,
      right: spacing.md,
      position: "absolute",
    },
    bar: {
      alignItems: "center",
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      elevation: 6,
      flexDirection: "row",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
    },
    message: {
      color: colors.text,
      flex: 1,
      fontSize: typography.body,
    },
    action: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    actionLabel: {
      color: colors.accent,
      fontSize: typography.body,
      fontWeight: "700",
    },
  });

  if (!visible && opacity.value === 0) return null;

  return (
    <Animated.View
      pointerEvents={visible ? "box-none" : "none"}
      style={[styles.container, animatedStyle]}
    >
      <View style={styles.bar}>
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>
        {action ? (
          <Pressable
            onPress={() => {
              if (timerRef.current) clearTimeout(timerRef.current);
              dismissedRef.current = true;
              action.onPress();
              onDismiss();
            }}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}
