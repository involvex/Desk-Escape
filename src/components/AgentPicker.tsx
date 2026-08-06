import { useCallback, useMemo } from "react";
import {
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  ScrollView,
} from "react-native";
import { ChevronDown, Check } from "lucide-react-native";
import { useAgents } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { Agent } from "@opencode-ai/sdk/client";

interface AgentPickerProps {
  onClose: () => void;
  visible: boolean;
  currentAgentKey?: string | null;
  onSelectAgent: (agentKey: string, agent: Agent) => void;
}

export function AgentPicker({
  onClose,
  visible,
  currentAgentKey,
  onSelectAgent,
}: AgentPickerProps) {
  const { providerType } = useConnection();
  const { colors, spacing, typography } = useTheme();
  const { data: agents = {}, isLoading } = useAgents();

  const agentEntries = useMemo(
    () => Object.entries(agents).filter(([, v]) => v !== undefined),
    [agents],
  );

  const handleSelect = useCallback(
    (agentKey: string, agent: Agent) => {
      onSelectAgent(agentKey, agent);
      onClose();
    },
    [onSelectAgent, onClose],
  );

  if (!visible) return null;

  if (providerType !== "opencode") {
    return (
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Select Agent</Text>
          <Text style={styles.empty}>
            Agent switching is only available for OpenCode provider.
          </Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.overlay} onStartShouldSetResponder={() => true}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <Text style={styles.title}>Select Agent</Text>
          <Pressable onPress={onClose}>
            <ChevronDown color={colors.textMuted} size={24} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.loadingText}>Loading agents...</Text>
          </View>
        ) : agentEntries.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No agents configured. Add agents in OpenCode config.
            </Text>
          </View>
        ) : (
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {agentEntries.map(([key, agent]) => {
              const isCurrent = key === currentAgentKey;
              const agentColor = agent.color || colors.accent;

              return (
                <Pressable
                  key={key}
                  onPress={() => handleSelect(key, agent)}
                  style={[
                    styles.agentItem,
                    isCurrent && styles.agentItemCurrent,
                    { borderLeftColor: agentColor },
                  ]}
                >
                  <View style={styles.agentMain}>
                    <View
                      style={[
                        styles.agentColorDot,
                        { backgroundColor: agentColor },
                      ]}
                    />
                    <View style={styles.agentInfo}>
                      <Text
                        style={[
                          styles.agentName,
                          isCurrent && styles.agentNameCurrent,
                        ]}
                      >
                        {agent.name || key}
                      </Text>
                      {agent.description && (
                        <Text style={styles.agentDescription}>
                          {agent.description}
                        </Text>
                      )}
                      <View style={styles.agentMeta}>
                        <Text style={styles.agentMetaText}>
                          {agent.mode || "primary"}
                        </Text>
                        {agent.model && (
                          <>
                            <Text style={styles.agentMetaSeparator}>·</Text>
                            <Text style={styles.agentMetaText}>
                              {agent.model.providerID}/{agent.model.modelID}
                            </Text>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                  {isCurrent && <Check color={agentColor} size={20} />}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <Pressable onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "rgba(0,0,0,0.5)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 0,
  },
  modal: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: "85%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#04111A",
  },
  loading: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#888888",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 14,
    color: "#888888",
    textAlign: "center",
  },
  list: {
    maxHeight: 400,
  },
  agentItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
    borderLeftWidth: 4,
    borderLeftColor: "transparent",
    borderRadius: 8,
  },
  agentItemCurrent: {
    backgroundColor: "#F8F9FA",
    borderLeftColor: "inherit",
  },
  agentMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  agentColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  agentInfo: {
    flex: 1,
    minWidth: 0,
  },
  agentName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#04111A",
  },
  agentNameCurrent: {
    fontWeight: "700",
  },
  agentDescription: {
    fontSize: 13,
    color: "#666666",
    marginTop: 2,
  },
  agentMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 4,
  },
  agentMetaText: {
    fontSize: 12,
    color: "#888888",
  },
  agentMetaSeparator: {
    color: "#CCCCCC",
  },
  closeButton: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#F0F0F0",
    borderRadius: 12,
  },
  closeText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#04111A",
  },
});
