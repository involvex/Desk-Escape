import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PromptPreset } from "@/types/opencode";

const AUTO_APPROVE_KEY = "@desk-escape/auto-approve-permissions";
const PROMPT_PRESETS_KEY = "@desk-escape/prompt-presets";
const PRESET_TAP_SEND_KEY = "@desk-escape/prompt-preset-tap-send";

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
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined,
);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [autoApprovePermissions, setAutoApproveState] = useState(false);
  const [promptPresets, setPromptPresetsState] = useState<PromptPreset[]>(
    DEFAULT_PROMPT_PRESETS,
  );
  const [promptPresetTapToSend, setPromptPresetTapToSendState] =
    useState(false);

  useEffect(() => {
    void (async () => {
      const [autoApprove, presets, tapSend] = await Promise.all([
        AsyncStorage.getItem(AUTO_APPROVE_KEY),
        AsyncStorage.getItem(PROMPT_PRESETS_KEY),
        AsyncStorage.getItem(PRESET_TAP_SEND_KEY),
      ]);

      if (autoApprove === "true") {
        setAutoApproveState(true);
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
    })();
  }, []);

  const setAutoApprovePermissions = useCallback((enabled: boolean) => {
    setAutoApproveState(enabled);
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

  const value = useMemo(
    () => ({
      autoApprovePermissions,
      setAutoApprovePermissions,
      promptPresets,
      setPromptPresets,
      promptPresetTapToSend,
      setPromptPresetTapToSend,
    }),
    [
      autoApprovePermissions,
      promptPresetTapToSend,
      promptPresets,
      setAutoApprovePermissions,
      setPromptPresetTapToSend,
      setPromptPresets,
    ],
  );

  return (
    <PreferencesContext.Provider value={value}>
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
