import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { PromptPreset } from "@/types/opencode";

const AUTO_APPROVE_KEY = "@desk-escape/auto-approve-permissions";
const PROMPT_PRESETS_KEY = "@desk-escape/prompt-presets";
const PRESET_TAP_SEND_KEY = "@desk-escape/prompt-preset-tap-send";
const COLLAPSE_TOOL_CALLS_KEY = "@desk-escape/collapse-tool-calls";
const COLLAPSE_THINKING_KEY = "@desk-escape/collapse-thinking";
const AUTO_EXPAND_THINKING_DURING_STREAM_KEY =
  "@desk-escape/auto-expand-thinking-during-stream";
const SHOW_THINKING_TIMING_KEY = "@desk-escape/show-thinking-timing";
const THINKING_DEFAULT_MODE_KEY = "@desk-escape/thinking-default-mode";

export const DEFAULT_PROMPT_PRESETS: PromptPreset[] = [
  {
    id: "commit",
    label: "Create commit",
    text: "Review staged changes and create a conventional commit message, then commit.",
  },
  {
    id: "tests",
    label: "Run tests",
    text: "Run the project test suite and summarize failures with fixes.",
  },
  {
    id: "explain",
    label: "Explain file",
    text: "Explain the selected file structure, key functions, and how it fits the project.",
  },
  {
    id: "lint",
    label: "Fix lint",
    text: "Find and fix lint or type errors in the current workspace.",
  },
  {
    id: "summarize",
    label: "Summarize changes",
    text: "Summarize uncommitted changes and suggest next steps.",
  },
];

interface PreferencesContextValue {
  autoApprovePermissions: boolean;
  setAutoApprovePermissions: (enabled: boolean) => void;
  promptPresets: PromptPreset[];
  setPromptPresets: (presets: PromptPreset[]) => void;
  promptPresetTapToSend: boolean;
  setPromptPresetTapToSend: (enabled: boolean) => void;
  collapseToolCalls: boolean;
  setCollapseToolCalls: (collapsed: boolean) => void;
  collapseThinking: boolean;
  setCollapseThinking: (collapsed: boolean) => void;
  autoExpandThinkingDuringStream: boolean;
  setAutoExpandThinkingDuringStream: (enabled: boolean) => void;
  showThinkingTiming: boolean;
  setShowThinkingTiming: (enabled: boolean) => void;
  thinkingDefaultMode: "default" | "collapsed" | "expanded" | "auto";
  setThinkingDefaultMode: (
    mode: "default" | "collapsed" | "expanded" | "auto",
  ) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined,
);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [autoApprovePermissions, setAutoApprovePermissionsState] =
    useState(false);
  const [promptPresets, setPromptPresetsState] = useState<PromptPreset[]>(
    DEFAULT_PROMPT_PRESETS,
  );
  const [promptPresetTapToSend, setPromptPresetTapToSendState] =
    useState(false);
  const [collapseToolCalls, setCollapseToolCallsState] = useState(true);
  const [collapseThinking, setCollapseThinkingState] = useState(true);
  const [
    autoExpandThinkingDuringStream,
    setAutoExpandThinkingDuringStreamState,
  ] = useState(true);
  const [showThinkingTiming, setShowThinkingTimingState] = useState(true);
  const [thinkingDefaultMode, setThinkingDefaultModeState] = useState<
    "default" | "collapsed" | "expanded" | "auto"
  >("default");

  useEffect(() => {
    void (async () => {
      const [
        autoApprove,
        presets,
        tapSend,
        collapseTools,
        collapseThinking,
        autoExpand,
        showTiming,
        defaultMode,
      ] = await Promise.all([
        AsyncStorage.getItem(AUTO_APPROVE_KEY),
        AsyncStorage.getItem(PROMPT_PRESETS_KEY),
        AsyncStorage.getItem(PRESET_TAP_SEND_KEY),
        AsyncStorage.getItem(COLLAPSE_TOOL_CALLS_KEY),
        AsyncStorage.getItem(COLLAPSE_THINKING_KEY),
        AsyncStorage.getItem(AUTO_EXPAND_THINKING_DURING_STREAM_KEY),
        AsyncStorage.getItem(SHOW_THINKING_TIMING_KEY),
        AsyncStorage.getItem(THINKING_DEFAULT_MODE_KEY),
      ]);

      if (autoApprove === "true") {
        setAutoApprovePermissionsState(true);
      }
      if (presets) {
        try {
          setPromptPresetsState(JSON.parse(presets) as PromptPreset[]);
        } catch {
          // Keep defaults.
        }
      }
      if (tapSend === "true") {
        setPromptPresetTapToSendState(true);
      }
      if (collapseTools === "false") {
        setCollapseToolCallsState(false);
      }
      if (collapseThinking === "false") {
        setCollapseThinkingState(false);
      }
      if (autoExpand === "false") {
        setAutoExpandThinkingDuringStreamState(false);
      }
      if (showTiming === "false") {
        setShowThinkingTimingState(false);
      }
      if (defaultMode === "collapsed") {
        setThinkingDefaultModeState("collapsed");
      } else if (defaultMode === "expanded") {
        setThinkingDefaultModeState("expanded");
      } else if (defaultMode === "auto") {
        setThinkingDefaultModeState("auto");
      }
    })();
  }, []);

  const setAutoApprovePermissions = useCallback((enabled: boolean) => {
    setAutoApprovePermissionsState(enabled);
    void AsyncStorage.setItem(AUTO_APPROVE_KEY, String(enabled));
  }, []);

  const setPromptPresets = useCallback((presets: PromptPreset[]) => {
    setPromptPresetsState(presets);
    void AsyncStorage.setItem(PROMPT_PRESETS_KEY, JSON.stringify(presets));
  }, []);

  const setPromptPresetTapToSend = useCallback((enabled: boolean) => {
    setPromptPresetTapToSendState(enabled);
    void AsyncStorage.setItem(PRESET_TAP_SEND_KEY, String(enabled));
  }, []);

  const setCollapseToolCalls = useCallback((collapsed: boolean) => {
    setCollapseToolCallsState(collapsed);
    void AsyncStorage.setItem(COLLAPSE_TOOL_CALLS_KEY, String(collapsed));
  }, []);

  const setCollapseThinking = useCallback((collapsed: boolean) => {
    setCollapseThinkingState(collapsed);
    void AsyncStorage.setItem(COLLAPSE_THINKING_KEY, String(collapsed));
  }, []);

  const setAutoExpandThinkingDuringStream = useCallback((enabled: boolean) => {
    setAutoExpandThinkingDuringStreamState(enabled);
    void AsyncStorage.setItem(
      AUTO_EXPAND_THINKING_DURING_STREAM_KEY,
      String(enabled),
    );
  }, []);

  const setShowThinkingTiming = useCallback((enabled: boolean) => {
    setShowThinkingTimingState(enabled);
    void AsyncStorage.setItem(SHOW_THINKING_TIMING_KEY, String(enabled));
  }, []);

  const setThinkingDefaultMode = useCallback(
    (mode: "default" | "collapsed" | "expanded" | "auto") => {
      setThinkingDefaultModeState(mode);
      void AsyncStorage.setItem(THINKING_DEFAULT_MODE_KEY, mode);
    },
    [],
  );

  return (
    <PreferencesContext.Provider
      value={{
        autoApprovePermissions,
        setAutoApprovePermissions,
        promptPresets,
        setPromptPresets,
        promptPresetTapToSend,
        setPromptPresetTapToSend,
        collapseToolCalls,
        setCollapseToolCalls,
        collapseThinking,
        setCollapseThinking,
        autoExpandThinkingDuringStream,
        setAutoExpandThinkingDuringStream,
        showThinkingTiming,
        setShowThinkingTiming,
        thinkingDefaultMode,
        setThinkingDefaultMode,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within PreferencesProvider.");
  }
  return context;
}
