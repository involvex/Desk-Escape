import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
} from "react-native";
import { ChevronDown, Check, Search, Filter } from "lucide-react-native";
import { useModels } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { Model, Provider } from "@opencode-ai/sdk/client";

interface ModelPickerProps {
  onClose: () => void;
  visible: boolean;
  currentProviderId?: string | null;
  currentModelId?: string | null;
  onSelectModel: (providerId: string, modelId: string, model: Model) => void;
}

type CapabilityFilter =
  "all" | "reasoning" | "tools" | "vision" | "attachments";

const CAPABILITY_FILTERS: {
  key: CapabilityFilter;
  label: string;
  icon: typeof Search;
}[] = [
  { key: "all", label: "All", icon: Search },
  { key: "reasoning", label: "Reasoning", icon: Filter },
  { key: "tools", label: "Tools", icon: Filter },
  { key: "vision", label: "Vision", icon: Filter },
  { key: "attachments", label: "Attachments", icon: Filter },
];

function modelHasCapability(model: Model, filter: CapabilityFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "reasoning":
      return model.capabilities.reasoning === true;
    case "tools":
      return model.capabilities.toolcall === true;
    case "vision":
      return model.capabilities.input.image === true;
    case "attachments":
      return model.capabilities.attachment === true;
    default:
      return true;
  }
}

export function ModelPicker({
  onClose,
  visible,
  currentProviderId,
  currentModelId,
  onSelectModel,
}: ModelPickerProps) {
  const { providerType } = useConnection();
  const { colors } = useTheme();
  const { data: providers = {}, isLoading } = useModels();
  const [searchQuery, setSearchQuery] = useState("");
  const [capabilityFilter, setCapabilityFilter] =
    useState<CapabilityFilter>("all");

  const filteredModels = useMemo(() => {
    const result: {
      providerId: string;
      provider: Provider;
      modelId: string;
      model: Model;
    }[] = [];

    for (const [providerId, provider] of Object.entries(providers)) {
      if (!provider.models) continue;

      for (const [modelId, model] of Object.entries(provider.models)) {
        if (model.status === "deprecated") continue;

        const matchesSearch =
          model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          modelId.toLowerCase().includes(searchQuery.toLowerCase()) ||
          provider.name.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesCapability = modelHasCapability(model, capabilityFilter);

        if (matchesSearch && matchesCapability) {
          result.push({ providerId, provider, modelId, model });
        }
      }
    }

    return result;
  }, [providers, searchQuery, capabilityFilter]);

  const handleSelect = useCallback(
    (providerId: string, modelId: string, model: Model) => {
      onSelectModel(providerId, modelId, model);
      onClose();
    },
    [onSelectModel, onClose],
  );

  const groupedByProvider = useMemo(() => {
    const groups: Record<
      string,
      { provider: Provider; models: typeof filteredModels }
    > = {};
    for (const item of filteredModels) {
      let group = groups[item.providerId];
      if (!group) {
        group = { provider: item.provider, models: [] };
        groups[item.providerId] = group;
      }
      group.models.push(item);
    }
    return groups;
  }, [filteredModels]);

  if (!visible) return null;

  const isOpenCode = providerType === "opencode";

  return (
    <View style={styles.overlay} onStartShouldSetResponder={() => true}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <Text style={styles.title}>Select Model</Text>
          <Pressable onPress={onClose}>
            <ChevronDown color={colors.textMuted} size={24} />
          </Pressable>
        </View>

        {!isOpenCode ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Model switching is only available for OpenCode provider.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.searchBar}>
              <TextInput
                placeholder="Search models..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={styles.searchInput}
              />
              <Search
                color={colors.textMuted}
                size={20}
                style={styles.searchIcon}
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
              contentContainerStyle={styles.filterContainer}
            >
              {CAPABILITY_FILTERS.map((filter) => (
                <Pressable
                  key={filter.key}
                  onPress={() => setCapabilityFilter(filter.key)}
                  style={[
                    styles.filterChip,
                    capabilityFilter === filter.key && styles.filterChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      capabilityFilter === filter.key &&
                        styles.filterChipTextActive,
                    ]}
                  >
                    {filter.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} size="large" />
                <Text style={styles.loadingText}>Loading models...</Text>
              </View>
            ) : filteredModels.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {searchQuery || capabilityFilter !== "all"
                    ? "No models match your filters."
                    : "No models configured. Add providers in OpenCode config."}
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.list}
                showsVerticalScrollIndicator={false}
              >
                {Object.entries(groupedByProvider).map(
                  ([providerId, group]) => (
                    <View key={providerId} style={styles.providerGroup}>
                      <Text style={styles.providerLabel}>
                        {group.provider.name || providerId}
                      </Text>
                      {group.models.map(({ modelId, model }) => {
                        const isCurrent =
                          providerId === currentProviderId &&
                          modelId === currentModelId;

                        return (
                          <Pressable
                            key={modelId}
                            onPress={() =>
                              handleSelect(providerId, modelId, model)
                            }
                            style={[
                              styles.modelItem,
                              isCurrent && styles.modelItemCurrent,
                            ]}
                          >
                            <View style={styles.modelMain}>
                              <View style={styles.modelInfo}>
                                <Text
                                  style={[
                                    styles.modelName,
                                    isCurrent && styles.modelNameCurrent,
                                  ]}
                                >
                                  {model.name || modelId}
                                </Text>
                                <View style={styles.modelMeta}>
                                  <Text style={styles.modelMetaText}>
                                    Context:{" "}
                                    {formatContextLimit(model.limit.context)}
                                  </Text>
                                  <Text style={styles.modelMetaSeparator}>
                                    ·
                                  </Text>
                                  <Text style={styles.modelMetaText}>
                                    ${model.cost.input.toFixed(2)}/1M in
                                  </Text>
                                  <Text style={styles.modelMetaSeparator}>
                                    ·
                                  </Text>
                                  <Text style={styles.modelMetaText}>
                                    ${model.cost.output.toFixed(2)}/1M out
                                  </Text>
                                </View>
                                <View style={styles.modelCapabilities}>
                                  {model.capabilities.reasoning && (
                                    <View style={styles.capabilityBadge}>
                                      <Text style={styles.capabilityText}>
                                        Reasoning
                                      </Text>
                                    </View>
                                  )}
                                  {model.capabilities.toolcall && (
                                    <View style={styles.capabilityBadge}>
                                      <Text style={styles.capabilityText}>
                                        Tools
                                      </Text>
                                    </View>
                                  )}
                                  {model.capabilities.input.image && (
                                    <View style={styles.capabilityBadge}>
                                      <Text style={styles.capabilityText}>
                                        Vision
                                      </Text>
                                    </View>
                                  )}
                                  {model.capabilities.attachment && (
                                    <View style={styles.capabilityBadge}>
                                      <Text style={styles.capabilityText}>
                                        Attachments
                                      </Text>
                                    </View>
                                  )}
                                  {model.capabilities.temperature && (
                                    <View style={styles.capabilityBadge}>
                                      <Text style={styles.capabilityText}>
                                        Temperature
                                      </Text>
                                    </View>
                                  )}
                                </View>
                              </View>
                            </View>
                            {isCurrent && (
                              <Check color={colors.accent} size={20} />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  ),
                )}
              </ScrollView>
            )}
          </>
        )}

        <Pressable onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatContextLimit(limit: number): string {
  if (limit >= 1000000) {
    return `${(limit / 1000000).toFixed(1)}M`;
  }
  if (limit >= 1000) {
    return `${(limit / 1000).toFixed(0)}K`;
  }
  return String(limit);
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
    maxHeight: "90%",
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F9FA",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#04111A",
    paddingRight: 8,
  },
  searchIcon: {
    position: "absolute",
    right: 16,
  },
  filterScroll: {
    marginBottom: 12,
  },
  filterContainer: {
    gap: 8,
    paddingHorizontal: 4,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F0F0F0",
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  filterChipActive: {
    backgroundColor: "#04111A",
    borderColor: "#04111A",
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333333",
  },
  filterChipTextActive: {
    color: "#FFFFFF",
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
    maxHeight: 450,
  },
  providerGroup: {
    marginBottom: 16,
  },
  providerLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#888888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  modelItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#FAFAFA",
    borderWidth: 1,
    borderColor: "#F0F0F0",
    marginBottom: 6,
  },
  modelItemCurrent: {
    backgroundColor: "#F0F4FF",
    borderColor: "#D0D8FF",
  },
  modelMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  modelInfo: {
    flex: 1,
    minWidth: 0,
  },
  modelName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#04111A",
  },
  modelNameCurrent: {
    fontWeight: "700",
    color: "#1A1A2E",
  },
  modelMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 4,
    gap: 4,
  },
  modelMetaText: {
    fontSize: 11,
    color: "#888888",
  },
  modelMetaSeparator: {
    color: "#CCCCCC",
  },
  modelCapabilities: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    gap: 6,
  },
  capabilityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#E8E8E8",
  },
  capabilityText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#555555",
    textTransform: "uppercase",
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
