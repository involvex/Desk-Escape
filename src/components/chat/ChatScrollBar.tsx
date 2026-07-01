import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import type { FlatList } from "react-native";
import {
  type ChatScrollMetrics,
  SCROLL_EDGE_THRESHOLD,
} from "@/components/chat/ChatScrollControls";
import { useTheme } from "@/context/ThemeContext";
import type { MessageWithParts } from "@/types/opencode";

/* eslint-disable react-hooks/refs -- scrollbar drag handlers read latest scroll metrics from refs */

const MIN_THUMB_HEIGHT = 32;
const FADE_DELAY_MS = 1500;

interface ChatScrollBarProps {
  listRef: React.RefObject<FlatList<MessageWithParts> | null>;
  scrollMetrics: ChatScrollMetrics;
  onScrollOffset: (offset: number) => void;
}

export function ChatScrollBar({
  listRef,
  scrollMetrics,
  onScrollOffset,
}: ChatScrollBarProps) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartOffsetRef = useRef(0);
  const trackHeightRef = useRef(0);
  const metricsRef = useRef(scrollMetrics);

  const { contentHeight, layoutHeight, offsetY } = scrollMetrics;
  const scrollable = contentHeight > layoutHeight + 16;
  const maxScroll = Math.max(contentHeight - layoutHeight, 1);
  const thumbHeight = Math.max(
    MIN_THUMB_HEIGHT,
    (layoutHeight / contentHeight) * layoutHeight,
  );
  const maxThumbTravel = Math.max(layoutHeight - thumbHeight, 1);
  const thumbTop =
    scrollable && maxScroll > 0 ? (offsetY / maxScroll) * maxThumbTravel : 0;

  useEffect(() => {
    metricsRef.current = scrollMetrics;
  }, [scrollMetrics]);

  const revealBar = useCallback(() => {
    // Reanimated shared values are intentionally mutated on the UI thread.
    // eslint-disable-next-line react-hooks/immutability
    opacity.value = withTiming(1, { duration: 120 });
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
    }
    fadeTimerRef.current = setTimeout(() => {
      opacity.value = withDelay(
        FADE_DELAY_MS,
        withTiming(0, { duration: 300 }),
      );
    }, 0);
  }, [opacity]);

  useEffect(() => {
    if (scrollable && offsetY > SCROLL_EDGE_THRESHOLD) {
      revealBar();
    }
  }, [offsetY, revealBar, scrollable]);

  useEffect(
    () => () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
      }
    },
    [],
  );

  const scrollToOffset = useCallback(
    (offset: number) => {
      const clamped = Math.max(0, Math.min(offset, maxScroll));
      listRef.current?.scrollToOffset({ offset: clamped, animated: false });
      onScrollOffset(clamped);
    },
    [listRef, maxScroll, onScrollOffset],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          revealBar();
          dragStartOffsetRef.current = metricsRef.current.offsetY;
          trackHeightRef.current = metricsRef.current.layoutHeight;
        },
        onPanResponderMove: (_event, gestureState) => {
          const metrics = metricsRef.current;
          const scrollRange = Math.max(
            metrics.contentHeight - metrics.layoutHeight,
            1,
          );
          const thumbSize = Math.max(
            MIN_THUMB_HEIGHT,
            (metrics.layoutHeight / metrics.contentHeight) *
              metrics.layoutHeight,
          );
          const thumbTrack = Math.max(metrics.layoutHeight - thumbSize, 1);
          const deltaRatio = gestureState.dy / thumbTrack;
          const nextOffset =
            dragStartOffsetRef.current + deltaRatio * scrollRange;
          scrollToOffset(nextOffset);
        },
      }),
    [revealBar, scrollToOffset],
  );

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    trackHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const styles = useMemo(
    () =>
      StyleSheet.create({
        track: {
          backgroundColor: "rgba(255,255,255,0.06)",
          borderRadius: 4,
          bottom: 0,
          position: "absolute",
          right: 4,
          top: 0,
          width: 6,
        },
        thumb: {
          backgroundColor: colors.accent,
          borderRadius: 4,
          left: 0,
          opacity: 0.85,
          position: "absolute",
          right: 0,
        },
      }),
    [colors.accent],
  );

  if (!scrollable) {
    return null;
  }

  return (
    <Animated.View
      onLayout={handleTrackLayout}
      pointerEvents="box-none"
      style={[styles.track, animatedStyle]}
    >
      <View
        {...panResponder.panHandlers}
        style={[
          styles.thumb,
          {
            height: thumbHeight,
            top: thumbTop,
          },
        ]}
      />
    </Animated.View>
  );
}
