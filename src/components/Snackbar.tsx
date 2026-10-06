import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
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
  /**
   * Unmounts are driven by React state, never by reading `opacity.value` in the
   * component body. Reading a shared value during render is what Reanimated flags
   * in strict mode ("Reading from `value` during component render") and is the
   * root of the render loop that flapped the session header and stalled the
   * message-fetch query. Instead, the snackbar stays mounted until its hide
   * animation finishes — then this flag flips in the `withTiming` completion
   * callback (a worklet, not a render read) and the guard below unmounts it.
   * The show callback clears it again so the exit animation still runs on the
   * next hide. Because both `setState` calls are routed through `runOnJS`, they
   * execute on the JS thread (not the UI worklet thread) and the
   * react-hooks/set-state-in-effect guard stays clean — and more importantly
   * they do not trip the Worklets "Remote Function / dispatchSetState on the UI
   * Runtime" crash that a synchronous setter call from a completion callback
   * would otherwise raise.
   */
  const [unmounted, setUnmounted] = useState(false);

  useEffect(() => {
    if (visible) {
      dismissedRef.current = false;
      translateY.value = withTiming(0, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
      opacity.value = withTiming(1, { duration: 180 }, () =>
        // `withTiming`'s completion callback runs on the UI worklet thread in a
        // real runtime, so the React state setter must be handed off to the JS
        // thread via `runOnJS` — calling it directly is what raises
        // "[Worklets] Tried to synchronously call a Remote Function …
        // dispatchSetState on the UI Runtime".
        runOnJS(setUnmounted)(false),
      );
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!dismissedRef.current) {
          dismissedRef.current = true;
          onDismiss();
        }
      }, durationMs);
    } else {
      translateY.value = withTiming(100, { duration: 180 });
      opacity.value = withTiming(0, { duration: 160 }, () => {
        runOnJS(setUnmounted)(true);
      });
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

  if (!visible && unmounted) return null;

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
