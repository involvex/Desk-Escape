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
import {
  useCurrentModel,
  useModels,
  useProviders,
  useSwitchModel,
} from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { Model } from "@/types/domain";

interface ModelPickerProps {
  onClose: () => void;
  visible: boolean;
  /**
   * Fallback highlight keys, used only until `useCurrentModel` resolves. The
   * authoritative "what is this session using" answer comes from the hook.
   */
  currentProviderId?: string | null;
  currentModelId?: string | null;
  /**
   * Optional local-state notification. The server is already switched by the
   * time this fires, so callers that only care about the server can omit it.
   */
  onSelectModel?: (providerId: string, modelId: string, model: Model) => void;
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

/**
 * V2 reports modalities as a string list on `capabilities.input` rather than
 * V1's `{ image, audio, ... }` booleans.
 */
function supportsImage(model: Model): boolean {
  return model.capabilities.input.includes("image");
}

function modelHasCapability(model: Model, filter: CapabilityFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "reasoning":
      return model.capabilities.reasoning;
    case "tools":
      return model.capabilities.toolCall;
    case "vision":
      return supportsImage(model);
    case "attachments":
      return model.capabilities.attachment;
    default:
      return true;
  }
}

/**
 * A model is selectable when the provider has it switched on and it is not
 * retired. V2 splits these into two independent fields: `enabled` is the
 * config-level toggle, `status` is the provider's own maturity label.
 */
function isSelectable(model: Model): boolean {
  return model.enabled && model.status !== "deprecated";
}

/**
 * Match a listed model against the session's current model.
 *
 * V2's `ModelInfo.id` and `ModelInfo.modelID` are separate fields, so the
 * session's reference can carry either one depending on which the server
 * recorded. Both are accepted, and the provider must agree either way.
 */
function isSameModel(
  model: Model,
  current: Model | null,
  fallbackId?: string | null,
) {
  if (current) {
    if (current.providerID !== model.providerID) return false;
    return (
      current.id === model.id ||
      (current.modelID !== undefined && current.modelID === model.modelID)
    );
  }
  if (!fallbackId) return false;
  return fallbackId === model.id || fallbackId === model.modelID;
}

export function ModelPicker({
  onClose,
  visible,
  currentProviderId,
  currentModelId,
  onSelectModel,
}: ModelPickerProps) {
  const { providerType, sessionId } = useConnection();
  const { colors } = useTheme();
  const { data: models = [], isLoading } = useModels();
  const { data: providers = [] } = useProviders();
  const { data: sessionModel = null } = useCurrentModel(sessionId);
  const switchModel = useSwitchModel();
  const [searchQuery, setSearchQuery] = useState("");
  const [capabilityFilter, setCapabilityFilter] =
    useState<CapabilityFilter>("all");

  // Provider display names, so the group headers are not just raw ids.
  const providerNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const provider of providers) {
      names.set(provider.id, provider.name || provider.id);
    }
    return names;
  }, [providers]);

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return models.filter((model) => {
      if (!isSelectable(model)) return false;

      if (query) {
        const haystack = [
          model.name,
          model.id,
          model.modelID ?? "",
          model.providerID,
          model.family ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return modelHasCapability(model, capabilityFilter);
    });
  }, [models, searchQuery, capabilityFilter]);

  const groupedByProvider = useMemo(() => {
    const groups = new Map<string, { label: string; models: Model[] }>();
    for (const model of filteredModels) {
      let group = groups.get(model.providerID);
      if (!group) {
        group = {
          label: providerNames.get(model.providerID) ?? model.providerID,
          models: [],
        };
        groups.set(model.providerID, group);
      }
      group.models.push(model);
    }
    // Sort groups by label; sort within a group by name so the list is stable
    // regardless of the order the server returned.
    return [...groups.entries()]
      .map(([providerId, group]) => ({
        providerId,
        ...group,
        models: [...group.models].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredModels, providerNames]);

  const handleSelect = useCallback(
    (model: Model) => {
      if (!sessionId) return;

      // V2 removed `model` from the prompt body: the session's model is
      // changed out-of-band and picked up by the next turn.
      switchModel.mutate({ model });
      onSelectModel?.(model.providerID, model.id, model);
      onClose();
    },
    [sessionId, switchModel, onSelectModel, onClose],
  );

  if (!visible) return null;

  const isOpenCode = providerType === "opencode";
  const switchError = switchModel.error;

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
        ) : !sessionId ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No active session. Start or pick a session to switch models.
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
                {groupedByProvider.map(
                  ({ providerId, label, models: group }) => (
                    <View key={providerId} style={styles.providerGroup}>
                      <Text style={styles.providerLabel}>{label}</Text>
                      {group.map((model) => {
                        // Prefer the server's answer; the props only cover the
                        // window before `useCurrentModel` has resolved.
                        const isCurrent = sessionModel
                          ? isSameModel(model, sessionModel)
                          : currentProviderId
                            ? model.providerID === currentProviderId &&
                              isSameModel(model, null, currentModelId)
                            : false;

                        return (
                          <Pressable
                            key={`${model.providerID}/${model.id}`}
                            onPress={() => handleSelect(model)}
                            disabled={switchModel.isPending}
                            style={[
                              styles.modelItem,
                              isCurrent && styles.modelItemCurrent,
                            ]}
                          >
                            <View style={styles.modelInfo}>
                              <Text
                                style={[
                                  styles.modelName,
                                  isCurrent && styles.modelNameCurrent,
                                ]}
                              >
                                {model.name || model.id}
                              </Text>
                              <View style={styles.modelMeta}>
                                <Text style={styles.modelMetaText}>
                                  Context:{" "}
                                  {formatContextLimit(model.limit.context)}
                                </Text>
                                {model.limit.output ? (
                                  <>
                                    <Text style={styles.modelMetaSeparator}>
                                      ·
                                    </Text>
                                    <Text style={styles.modelMetaText}>
                                      Out:{" "}
                                      {formatContextLimit(model.limit.output)}
                                    </Text>
                                  </>
                                ) : null}
                                <Text style={styles.modelMetaSeparator}>·</Text>
                                <Text style={styles.modelMetaText}>
                                  {formatCost(model.cost.input)}/1M in
                                </Text>
                                <Text style={styles.modelMetaSeparator}>·</Text>
                                <Text style={styles.modelMetaText}>
                                  {formatCost(model.cost.output)}/1M out
                                </Text>
                              </View>
                              <View style={styles.modelCapabilities}>
                                {model.status !== "active" && (
                                  <View
                                    style={[
                                      styles.capabilityBadge,
                                      styles.statusBadge,
                                    ]}
                                  >
                                    <Text style={styles.statusText}>
                                      {model.status}
                                    </Text>
                                  </View>
                                )}
                                {model.capabilities.reasoning && (
                                  <View style={styles.capabilityBadge}>
                                    <Text style={styles.capabilityText}>
                                      Reasoning
                                    </Text>
                                  </View>
                                )}
                                {model.capabilities.toolCall && (
                                  <View style={styles.capabilityBadge}>
                                    <Text style={styles.capabilityText}>
                                      Tools
                                    </Text>
                                  </View>
                                )}
                                {supportsImage(model) && (
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
                                {model.variants?.length ? (
                                  <View style={styles.capabilityBadge}>
                                    <Text style={styles.capabilityText}>
                                      {model.variants.length} variant
                                      {model.variants.length === 1 ? "" : "s"}
                                    </Text>
                                  </View>
                                ) : null}
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

            {switchError ? (
              <Text style={styles.errorText}>
                {switchError instanceof Error
                  ? switchError.message
                  : "Could not switch model."}
              </Text>
            ) : null}
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

/** V2 cost is USD per 1M tokens; free tiers report 0 and read better as text. */
function formatCost(perMillion: number): string {
  if (!perMillion) return "free";
  return `$${perMillion.toFixed(2)}`;
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
  errorText: {
    fontSize: 12,
    color: "#CC3333",
    marginTop: 8,
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
  statusBadge: {
    backgroundColor: "#FDF0D5",
  },
  capabilityText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#555555",
    textTransform: "uppercase",
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8A6100",
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
