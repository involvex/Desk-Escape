import {
  createElement,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
} from "react";

/**
 * A stand-in for `react-native-webview`.
 *
 * `react-native-webview` renders a platform view and cannot load outside a native
 * runtime, but `TerminalPanel` depends on it in two ways that *are* worth
 * testing: it injects JavaScript into the page (the theme repaint and the
 * "Run in terminal" write), and it reports socket lifecycle messages back.
 *
 * So the stub records what was injected and lets a test post the messages the real
 * page would. That is enough to pin the effect ordering that broke twice during
 * the write bridge: the sink has to be published before the drain runs.
 */

export interface WebViewStubState {
  /** Every script passed to `injectJavaScript`, in order. */
  injected: string[];
  /** The page's most recent `onMessage` handler. */
  onMessage: MessageHandler | null;
  /** How many times the page was reloaded. */
  reloadCount: number;
}

export type MessageHandler = (event: { nativeEvent: { data: string } }) => void;

export const webViewStub: WebViewStubState = {
  injected: [],
  onMessage: null,
  reloadCount: 0,
};

export function resetWebViewStub(): void {
  webViewStub.injected = [];
  webViewStub.onMessage = null;
  webViewStub.reloadCount = 0;
}

/**
 * Deliver a message the way the bundled shell would.
 *
 * Typed exactly as `TerminalPanel` parses it: a JSON string with a `type`, which
 * is what the real WebView hands over.
 */
export function postFromShell(message: {
  type: string;
  cols?: number;
  rows?: number;
  code?: number;
  message?: string;
}): void {
  webViewStub.onMessage?.({
    nativeEvent: { data: JSON.stringify(message) },
  });
}

interface WebViewStubProps {
  onMessage?: MessageHandler;
  children?: ReactNode;
  [key: string]: unknown;
}

export const WebViewStub = forwardRef<unknown, WebViewStubProps>(
  function WebViewStub({ onMessage, children, ...props }, ref) {
    webViewStub.onMessage = (onMessage as MessageHandler | undefined) ?? null;

    useImperativeHandle(ref, () => ({
      injectJavaScript: (script: string) => {
        webViewStub.injected.push(script);
      },
      reload: () => {
        webViewStub.reloadCount += 1;
      },
      goBack: () => {},
      stopLoading: () => {},
    }));

    return createElement("WebView", props, children as ReactNode);
  },
);

interface WebViewModule {
  WebView: typeof WebViewStub;
}

export const webViewStubModule: WebViewModule = { WebView: WebViewStub };
