/**
 * The component-test harness: render under `bun:test` with the contexts a screen
 * depends on already provided.
 *
 * Built on `test-renderer`, a `react-reconciler`-based renderer that supports
 * React 19 without Jest (React Native's own testing path now uses it too).
 * React Native's own testing library is not usable here because it requires a
 * Jest environment; see `react-native-stub.ts` for the full reasoning.
 *
 * The contexts come from `context-holds.ts`, whose module mocks are registered in
 * the preload. This file only fills in values — calling `mock.module` from here
 * would be too late and would break module resolution for `react-native`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root, type TestInstance } from "test-renderer";

import type { ThemeName } from "@/types/opencode";
import {
  resetTestContext,
  setTestContext,
  type PermissionState,
  type TestConnection,
} from "@/testing/context-holds";
import {
  seedColdStart,
  setNotificationPermissionStatus,
  type ResponseParts,
} from "@/testing/notifications-stub";

export { act, createRoot };
export type { TestInstance };
export { takeAlertCalls } from "@/testing/react-native-stub";

/**
 * A query client that fails fast.
 *
 * The default `QueryClient` retries three times with a backoff, which would make
 * an error-path test take seconds — and pass for the wrong reason if a retry
 * eventually succeeded. Retries are off, so "the screen showed an error" means the
 * query actually failed.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderOptions {
  /** Theme name from `palettes.ts`. Defaults to `dev-dark`. */
  theme?: ThemeName;
  /** Connection values for `useConnection()`. */
  connection?: Partial<TestConnection>;
  /**
   * The resolved project for `useCurrentProject()`. Pass `null` for "not resolved
   * yet" — several screens hold a resolving state until it has an id.
   */
  project?: unknown;
  /** What `usePermission()` reports, for the approval banner. */
  permission?: Partial<PermissionState>;
  /**
   * A notification response waiting to be found, as a **cold start** would leave it.
   *
   * An option rather than a `seedColdStart` call before mounting, because `mount`
   * resets every slot — including the notification one — so a value set beforehand is
   * wiped before the component under test ever runs. That reset is the right default
   * (nothing should leak between tests), which leaves an option as the only way to say
   * "the user tapped a notification before JavaScript existed": it becomes part of the
   * world the mount creates rather than something a test has to win a race against.
   */
  notificationResponse?: ResponseParts | null;
  /**
   * What `Notifications.getPermissionsAsync()` reports.
   *
   * An option for the same reason as `notificationResponse`: `mount` resets every slot,
   * so a status set before mounting is gone by the time the component runs. Defaults
   * to granted, which is the ordinary path — a test about permissions has to say so.
   */
  notificationPermissionStatus?: "granted" | "denied" | "undetermined";
  /** Pass one pre-seeded with `setQueryData` to drive a query's result. */
  queryClient?: QueryClient;
}

/** Queries and interactions available on a mounted tree. */
export interface MountedTree {
  /** Every host node, root first. */
  all: () => TestInstance[];
  /** Every node of a given host type, e.g. `Text` or `Pressable`. */
  byType: (type: string) => TestInstance[];
  /** Every `Text` node whose rendered text contains `needle`. */
  byText: (needle: string) => TestInstance[];
  /** Flattened text of every `Text` node, newline-separated. */
  text: () => string;
  /** The first node of a host type, or throws listing what was rendered. */
  find: (type: string) => TestInstance;
  /** Fire `onPress` on a node. */
  press: (node: TestInstance) => Promise<void>;
  /**
   * Run `fn` inside `act`, so state updates it causes are flushed before the next
   * assertion.
   *
   * For the stimuli that do not come from a press: an SSE event arriving, a
   * notification being tapped, a WebSocket frame, a timer. Each of those is the
   * outside world reaching into the tree, and each produces a `setState` — outside
   * `act` that update is still applied but not flushed, so the assertion reads stale
   * state and fails with a value that looks like a product bug rather than a harness
   * one. The `act(...)` warning it also logs is the same problem stated out loud.
   *
   * Named `act` rather than something task-shaped so it reads as what it is: the
   * harness's own primitive, not a way to fake a press.
   */
  act: (fn: () => void | Promise<void>) => Promise<void>;
  /** Press the nearest ancestor with an `onPress` of a node matching `label`. */
  pressText: (label: string) => Promise<void>;
  /**
   * Press the control whose own label is *exactly* `label`.
   *
   * `pressText` matches on substrings, which is right for finding a control by a
   * phrase in its caption but wrong when the same words appear in body copy. The
   * approval banner is the case in point: its button reads "Always" and the hint
   * above it reads "“Always” remembers this choice for the project." — a substring
   * search finds the prose first and then fails, because prose has no `onPress`.
   */
  pressExact: (label: string) => Promise<void>;
  /**
   * Press the control carrying `accessibilityLabel`.
   *
   * Icon-only buttons have no text to match — a back chevron, a close cross — and
   * naming them by their accessibility label is both how the app exposes them to
   * screen readers and how a test should reach them.
   */
  pressAccessibility: (label: string) => Promise<void>;
  /** Let queued promises settle inside `act`. */
  flush: () => Promise<void>;
  unmount: () => void;
  queryClient: QueryClient;
}

export interface RenderResult extends MountedTree {
  /**
   * Re-render the tree, optionally against new context values.
   *
   * The element is rebuilt rather than reused, so React actually re-renders and
   * any memo depending on the context sees the new value. Needed for theme changes,
   * which a fresh `mount` cannot express — that would be a new tree, not a change
   * to this one.
   *
   * Only works when the tree was mounted from a factory. React skips a subtree whose
   * element it has already seen, and cloning the outermost element does not help —
   * the bailout happens on the identical child.
   */
  rerender: (options?: RenderOptions) => Promise<void>;
}

/**
 * Queries and interactions over a mounted tree.
 *
 * Failures name what *was* rendered. A screen test that cannot find its button
 * should say so without the reader having to re-derive it from the component.
 *
 * `rerender` is added by `mount` rather than here, so this describes a mounted tree
 * on its own.
 */
function accessors(root: Root, queryClient: QueryClient): MountedTree {
  const queryAll = (): TestInstance[] =>
    root.container.queryAll(() => true, { includeSelf: true });

  const textOf = (node: TestInstance): string => {
    const direct = node.props.children;
    if (typeof direct === "string" || typeof direct === "number") {
      return String(direct);
    }
    return node.children
      .map((child) => (typeof child === "string" ? child : textOf(child)))
      .join("");
  };

  const text = () =>
    queryAll()
      .filter((node) => node.type === "Text")
      .map(textOf)
      .join("\n");

  const byType = (type: string) => queryAll().filter((n) => n.type === type);

  const byText = (needle: string) =>
    queryAll().filter(
      (node) => node.type === "Text" && textOf(node).includes(needle),
    );

  const find = (type: string) => {
    const found = byType(type);
    if (found.length === 0) {
      const available = [
        ...new Set(queryAll().map((node) => node.type || "(root)")),
      ];
      throw new Error(
        `No <${type}> rendered. Available host types: ${available.join(", ")}\n` +
          `Rendered text:\n${text()}`,
      );
    }
    return found[0]!;
  };

  const invoke = async (handler: unknown) => {
    await act(async () => {
      (handler as () => void | Promise<void>)();
    });
  };

  const press = async (node: TestInstance) => {
    if (typeof node.props.onPress !== "function") {
      throw new Error(
        `<${node.type}> has no onPress. Host types present: ` +
          [...new Set(queryAll().map((n) => n.type))].join(", "),
      );
    }
    await invoke(node.props.onPress);
  };

  const run = async (fn: () => void | Promise<void>) => {
    await invoke(fn);
  };

  /**
   * Walk up from a text node to the control that owns it.
   *
   * The pressable is an ancestor of the label, not the label itself, so the two are
   * always found together — one implementation for both text matchers, which keeps
   * their failure messages pointing at the same thing.
   */
  const pressNearestAncestor = async (
    label: string,
    matches: readonly TestInstance[],
  ) => {
    if (matches.length === 0) {
      throw new Error(
        `Nothing to press matching "${label}".\nRendered text:\n${text()}`,
      );
    }
    let node: TestInstance | null = matches[0]!;
    while (node && typeof node.props.onPress !== "function") {
      node = node.parent;
    }
    if (!node) {
      throw new Error(`Found "${label}" but no ancestor carries an onPress.`);
    }
    await invoke(node.props.onPress);
  };

  const pressText = async (label: string) => {
    await pressNearestAncestor(label, byText(label));
  };

  const pressExact = async (label: string) => {
    await pressNearestAncestor(
      label,
      queryAll().filter(
        (node) => node.type === "Text" && textOf(node) === label,
      ),
    );
  };

  const pressAccessibility = async (label: string) => {
    const node = queryAll().find(
      (candidate) => candidate.props.accessibilityLabel === label,
    );
    if (!node) {
      const labels = [
        ...new Set(
          queryAll()
            .map((candidate) => candidate.props.accessibilityLabel)
            .filter((value): value is string => typeof value === "string"),
        ),
      ];
      throw new Error(
        `No control labelled "${label}". Labels present: ${
          labels.join(", ") || "(none)"
        }`,
      );
    }
    if (typeof node.props.onPress !== "function") {
      throw new Error(`Control labelled "${label}" has no onPress.`);
    }
    await invoke(node.props.onPress);
  };

  return {
    all: queryAll,
    byType,
    byText,
    text,
    find,
    press,
    act: run,
    pressText,
    pressExact,
    pressAccessibility,
    flush: async () => {
      // Real event-loop turns, not microtasks. A query fetch resolves through
      // several microtasks and at least one macrotask before React Query re-renders
      // with the result; draining microtasks alone leaves the screen in its
      // pending state and every data assertion fails for a reason that has nothing
      // to do with the screen.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    unmount: () => act(() => root.unmount()),
    queryClient,
  };
}

/** Mount a tree inside the query provider and the app's context mocks. */
async function mount(
  /** Rebuilt on each render; see `rerender`. */
  build: () => ReactNode,
  options: RenderOptions,
  queryClient: QueryClient,
): Promise<RenderResult> {
  // Reset first: the context slots are module-level, so without this a test that
  // set `activeDirectory: null` would leak into the next file in the run — and the
  // failure lands in an unrelated test, which is close to impossible to diagnose.
  resetTestContext();
  setTestContext(options);
  // After the reset, and before the render, so the component's mount-time read finds
  // it. The alternative — seeding before calling `mount` — is wiped by the reset above.
  if (options.notificationResponse) {
    seedColdStart(options.notificationResponse);
  }
  if (options.notificationPermissionStatus) {
    setNotificationPermissionStatus(options.notificationPermissionStatus);
  }
  let root!: Root;
  await act(async () => {
    root = createRoot({ textComponentTypes: ["Text", "FlatList"] });
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, build()),
    );
  });

  const result = accessors(root, queryClient);

  return {
    ...result,
    rerender: async (next: RenderOptions = options) => {
      // Merged over the mount options so a partial `rerender({ theme })` does not
      // silently drop the connection this test set up.
      setTestContext({ ...options, ...next });
      // A rebuilt element, not the same one: React would otherwise bail out and
      // skip the render the caller asked for.
      await act(async () => {
        root.render(
          createElement(QueryClientProvider, { client: queryClient }, build()),
        );
      });
      await result.flush();
    },
  };
}

/**
 * Render an element, merging `options.props` into its props.
 *
 * `Text` is declared a text-capable host type: without it React rejects text nodes
 * outside a text container, which is what React Native does and is worth keeping.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions & { props?: Record<string, unknown> } = {},
): Promise<RenderResult> {
  const { props = {}, ...rest } = options;
  const queryClient = rest.queryClient ?? createTestQueryClient();
  // React 19 types `ReactElement["props"]` as `unknown`, so the element's own props
  // have to be narrowed before they can be merged with the overrides.
  const merged: Record<string, unknown> = {
    ...(ui.props as Record<string, unknown>),
    ...props,
  };
  return mount(() => createElement(ui.type, merged), rest, queryClient);
}

/**
 * Mount arbitrary children — for driving a provider or the bridge directly rather
 * than a screen.
 *
 * Pass a *factory* if the test needs `rerender`. React bails out of a subtree whose
 * element it has already seen, and cloning the outermost element does not help —
 * the bailout happens on the identical child. Only rebuilding the tree reaches the
 * components underneath.
 */
export function renderWithContext(
  build: ReactNode | (() => ReactNode),
  options: RenderOptions = {},
): Promise<RenderResult> {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const factory =
    typeof build === "function" ? (build as () => ReactNode) : () => build;
  return mount(factory, options, queryClient);
}
