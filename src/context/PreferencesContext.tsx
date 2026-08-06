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
const TERMINAL_SHELL_KEY = "@desk-escape/terminal-shell";
const DEFAULT_AGENT_KEY = "@desk-escape/default-agent";
const DEFAULT_MODEL_KEY = "@desk-escape/default-model";

export type TerminalShell = "auto" | "pwsh" | "bash" | "zsh" | "fish" | "cmd";

export const TERMINAL_SHELL_OPTIONS: { id: TerminalShell; label: string }[] = [
  { id: "auto", label: "Auto (detect)" },
  { id: "bash", label: "Bash" },
  { id: "zsh", label: "Zsh" },
  { id: "fish", label: "Fish" },
  { id: "pwsh", label: "PowerShell" },
  { id: "cmd", label: "CMD" },
];

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
  terminalShell: TerminalShell;
  setTerminalShell: (shell: TerminalShell) => void;
  // Default agent/model for new sessions
  defaultAgentKey: string | null;
  setDefaultAgentKey: (agentKey: string | null) => void;
  defaultModel: { providerId: string; modelId: string } | null;
  setDefaultModel: (
    model: { providerId: string; modelId: string } | null,
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
  const [terminalShell, setTerminalShellState] =
    useState<TerminalShell>("auto");
  const [defaultAgentKey, setDefaultAgentKeyState] = useState<string | null>(
    null,
  );
  const [defaultModel, setDefaultModelState] = useState<{
    providerId: string;
    modelId: string;
  } | null>(null);

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
        savedShell,
        savedAgent,
        savedModel,
      ] = await Promise.all([
        AsyncStorage.getItem(AUTO_APPROVE_KEY),
        AsyncStorage.getItem(PROMPT_PRESETS_KEY),
        AsyncStorage.getItem(PRESET_TAP_SEND_KEY),
        AsyncStorage.getItem(COLLAPSE_TOOL_CALLS_KEY),
        AsyncStorage.getItem(COLLAPSE_THINKING_KEY),
        AsyncStorage.getItem(AUTO_EXPAND_THINKING_DURING_STREAM_KEY),
        AsyncStorage.getItem(SHOW_THINKING_TIMING_KEY),
        AsyncStorage.getItem(THINKING_DEFAULT_MODE_KEY),
        AsyncStorage.getItem(TERMINAL_SHELL_KEY),
        AsyncStorage.getItem(DEFAULT_AGENT_KEY),
        AsyncStorage.getItem(DEFAULT_MODEL_KEY),
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
      if (
        savedShell === "pwsh" ||
        savedShell === "bash" ||
        savedShell === "zsh" ||
        savedShell === "fish" ||
        savedShell === "cmd"
      ) {
        setTerminalShellState(savedShell);
      }
      if (savedAgent) {
        setDefaultAgentKeyState(savedAgent);
      }
      if (savedModel) {
        try {
          setDefaultModelState(JSON.parse(savedModel));
        } catch {
          // Ignore invalid model
        }
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

  const setTerminalShell = useCallback((shell: TerminalShell) => {
    setTerminalShellState(shell);
    void AsyncStorage.setItem(TERMINAL_SHELL_KEY, shell);
  }, []);

  const setDefaultAgentKey = useCallback((agentKey: string | null) => {
    setDefaultAgentKeyState(agentKey);
    if (agentKey) {
      void AsyncStorage.setItem(DEFAULT_AGENT_KEY, agentKey);
    } else {
      void AsyncStorage.removeItem(DEFAULT_AGENT_KEY);
    }
  }, []);

  const setDefaultModel = useCallback(
    (model: { providerId: string; modelId: string } | null) => {
      setDefaultModelState(model);
      if (model) {
        void AsyncStorage.setItem(DEFAULT_MODEL_KEY, JSON.stringify(model));
      } else {
        void AsyncStorage.removeItem(DEFAULT_MODEL_KEY);
      }
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
        terminalShell,
        setTerminalShell,
        defaultAgentKey,
        setDefaultAgentKey,
        defaultModel,
        setDefaultModel,
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
