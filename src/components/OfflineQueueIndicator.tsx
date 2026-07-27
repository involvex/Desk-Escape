import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";

export function OfflineQueueIndicator() {
  const { queuedMessages, clearQueuedMessages } = useConnection();
  const { colors } = useTheme();

  if (queuedMessages.length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.warning }]}>
      <Text style={[styles.text, { color: colors.background }]}>
        {queuedMessages.length} queued
      </Text>
      <TouchableOpacity
        onPress={() => void clearQueuedMessages()}
        accessibilityLabel="Clear queued messages"
        accessibilityRole="button"
      >
        <Text style={[styles.clear, { color: colors.background }]}>Clear</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
  },
  clear: {
    fontSize: 13,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
