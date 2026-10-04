/**
 * A stand-in for `expo-clipboard`.
 *
 * `expo-clipboard` reaches `expo-modules-core`, which imports the real
 * `react-native` and dies on `TurboModuleRegistry`. Mocking it in the preload is
 * the same substitution as the WebView's.
 *
 * Deliberately faked at the *native write* rather than at `@/utils/clipboard`: the
 * helper's whole reason for existing is that it reports success only when the write
 * landed, and mocking the helper would leave that untested. Here the helper is real
 * and a test can make the write fail.
 */

let writes: string[] = [];

/** What `getStringAsync` returns. Empty by default, like a cleared pasteboard. */
let stored = "";

let failure: Error | null = null;

export const clipboardStubModule = {
  async setStringAsync(text: string): Promise<void> {
    writes.push(text);
    if (failure) {
      throw failure;
    }
    stored = text;
  },
  async getStringAsync(): Promise<string> {
    if (failure) {
      throw failure;
    }
    return stored;
  },
};

/** Everything written since the last reset, in order. */
export function clipboardWrites(): readonly string[] {
  return writes;
}

/**
 * Write to the stub directly, bypassing the component under test.
 *
 * Used to leave a mark the next mount's reset has to clear — a leak check needs
 * something to leak.
 */
export async function writeToClipboard(text: string): Promise<void> {
  await clipboardStubModule.setStringAsync(text);
}

/** Make the next read and write fail, as a denied or unavailable pasteboard would. */
export function setClipboardFailure(error: Error | null): void {
  failure = error;
}

/** Put something on the pasteboard for `getStringAsync` to return. */
export function setClipboardValue(value: string): void {
  stored = value;
}

/** Clear the log, the stored value and any forced failure. */
export function resetClipboard(): void {
  writes = [];
  stored = "";
  failure = null;
}
