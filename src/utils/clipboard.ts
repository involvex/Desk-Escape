import * as Clipboard from "expo-clipboard";

/**
 * Clipboard access for React Native.
 *
 * `navigator.clipboard` is the DOM Clipboard API and does not exist under
 * Hermes, so it is unusable here. `expo-clipboard` is the supported path and
 * works on native and web alike.
 *
 * Every helper returns a boolean so callers can gate their success UI on an
 * actual write. Reporting "Copied" when the write silently failed is worse than
 * showing no feedback at all.
 */

/** Copies `text`, resolving `true` only when the write actually succeeded. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

/** Reads the clipboard, or `null` when it is empty or unreadable. */
export async function readFromClipboard(): Promise<string | null> {
  try {
    const value = await Clipboard.getStringAsync();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** How long a transient "Copied" confirmation stays visible. */
export const COPY_FEEDBACK_MS = 1500;
