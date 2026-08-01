import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { ProviderSession } from "@/api/providers/types";
import { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";

export function AgentPicker({
  onClose,
  visible,
}: {
  onClose: () => void;
  visible: boolean;
}) {
  const { providerType, provider, cursorConfig } = useConnection();
  const { colors, spacing, typography } = useTheme();
  const [agents, setAgents] = useState<ProviderSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    if (providerType !== "cursor" || !provider) return;
    setLoading(true);
    setError(null);
    try {
      const list = await provider.listSessions();
      setAgents(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }, [providerType, provider]);

  const handleSelect = useCallback(
    async (agent: ProviderSession) => {
      if (providerType !== "cursor" || !provider) return;
      try {
        await provider.selectSession(agent.id);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to select agent.");
      }
    },
    [providerType, provider, onClose],
  );

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.modal}>
        <Text style={styles.title}>Select Agent</Text>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : agents.length === 0 ? (
          <Text style={styles.empty}>No agents found. Create one first.</Text>
        ) : (
          <FlatList
            data={agents}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => void handleSelect(item)}
                style={styles.agentItem}
              >
                <Text style={styles.agentName}>{item.title}</Text>
                <Text style={styles.agentMeta}>
                  {item.status} · {item.updatedAt ?? ""}
                </Text>
              </Pressable>
            )}
          />
        )}

        <Pressable onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "rgba(0,0,0,0.5)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  modal: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    maxHeight: "80%",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  error: {
    color: "#CC0000",
    marginBottom: 12,
  },
  empty: {
    color: "#666666",
    marginBottom: 12,
  },
  agentItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  agentName: {
    fontSize: 16,
    fontWeight: "600",
  },
  agentMeta: {
    fontSize: 12,
    color: "#888888",
    marginTop: 4,
  },
  closeButton: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  closeText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#04111A",
  },
});
