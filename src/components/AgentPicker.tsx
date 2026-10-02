import { useCallback, useMemo } from "react";
import {
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  ScrollView,
} from "react-native";
import { ChevronDown, Check } from "lucide-react-native";
import { useAgents, useCurrentAgent, useSwitchAgent } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { Agent } from "@/types/domain";

interface AgentPickerProps {
  onClose: () => void;
  visible: boolean;
  /**
   * Fallback highlight key, used only until `useCurrentAgent` resolves. V2's
   * `AgentInfo.id` is what the hook returns as `Agent.name`.
   */
  currentAgentKey?: string | null;
  /**
   * Optional local-state notification. The server is already switched by the
   * time this fires, so callers that only care about the server can omit it.
   */
  onSelectAgent?: (agentKey: string, agent: Agent) => void;
}

/**
 * V2 agents are a flat list with an explicit `mode`, so the list is ordered
 * rather than grouped: `primary` agents are what a user drives a session with,
 * `subagent` agents are invoked by other agents, and `all` fits either.
 */
const MODE_ORDER: Record<Agent["mode"], number> = {
  primary: 0,
  all: 1,
  subagent: 2,
};

export function AgentPicker({
  onClose,
  visible,
  currentAgentKey,
  onSelectAgent,
}: AgentPickerProps) {
  const { providerType, sessionId } = useConnection();
  const { colors } = useTheme();
  const { data: agents = [], isLoading } = useAgents();
  const { data: sessionAgent = null } = useCurrentAgent(sessionId);
  const switchAgent = useSwitchAgent();

  // `hidden` agents stay out of the picker but are still callable by the
  // server, so filtering here is purely a presentation decision.
  const visibleAgents = useMemo(
    () =>
      agents
        .filter((agent) => !agent.hidden)
        .slice()
        .sort(
          (a, b) =>
            (MODE_ORDER[a.mode] ?? 3) - (MODE_ORDER[b.mode] ?? 3) ||
            a.name.localeCompare(b.name),
        ),
    [agents],
  );

  const handleSelect = useCallback(
    (agent: Agent) => {
      if (!sessionId) return;

      // V2 removed `agent` from the prompt body; the session's agent is
      // changed out-of-band via `session.switchAgent`.
      switchAgent.mutate({ agent: agent.name });
      onSelectAgent?.(agent.name, agent);
      onClose();
    },
    [sessionId, switchAgent, onSelectAgent, onClose],
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

  if (!sessionId) {
    return (
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Select Agent</Text>
          <Text style={styles.emptyText}>
            No active session. Start or pick a session to switch agents.
          </Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const activeName = sessionAgent?.name ?? currentAgentKey ?? null;
  const switchError = switchAgent.error;

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
        ) : visibleAgents.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No agents configured. Add agents in OpenCode config.
            </Text>
          </View>
        ) : (
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {visibleAgents.map((agent) => {
              const isCurrent = activeName === agent.name;
              const agentColor = agent.color || colors.accent;

              return (
                <Pressable
                  key={agent.name}
                  onPress={() => handleSelect(agent)}
                  disabled={switchAgent.isPending}
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
                        {agent.name}
                      </Text>
                      {agent.description && (
                        <Text style={styles.agentDescription}>
                          {agent.description}
                        </Text>
                      )}
                      <View style={styles.agentMeta}>
                        <Text style={styles.agentMetaText}>{agent.mode}</Text>
                        {/*
                          V2 makes `model` a `ModelRef` object rather than the
                          `"provider/model"` string V1 carried, so the parts are
                          read off the ref instead of being split.
                        */}
                        {agent.model && (
                          <>
                            <Text style={styles.agentMetaSeparator}>·</Text>
                            <Text style={styles.agentMetaText}>
                              {agent.model.providerID}/{agent.model.modelID}
                              {agent.model.variant
                                ? `#${agent.model.variant}`
                                : ""}
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

        {switchError ? (
          <Text style={styles.errorText}>
            {switchError instanceof Error
              ? switchError.message
              : "Could not switch agent."}
          </Text>
        ) : null}

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
  errorText: {
    fontSize: 12,
    color: "#CC3333",
    marginTop: 8,
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
