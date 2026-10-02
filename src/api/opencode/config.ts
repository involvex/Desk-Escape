import type { ConfigEntry } from "@opencode/client";

/**
 * Folding V2's `config.get()` response into a single effective config.
 *
 * V1 answered `config.get()` with one already-merged `Config` object. V2 has no
 * such shortcut: it returns the list of **source documents**, ordered lowest to
 * highest priority, and leaves the merge to the client. This module performs
 * that fold so the rest of the app can read a plain object.
 *
 * Merge rules, in the order they are applied to each document:
 *
 * - Scalars (`shell`, `model`, `share`, `snapshots`, ...) are **last present
 *   wins**. A key that a higher-priority document simply omits does not clear the
 *   value inherited from a lower one. An explicit `null` *is* a value and does
 *   win, which is how `shell` gets cleared.
 * - Record-shaped fields (`agents`, `commands`, `providers`, `references`) merge
 *   **key by key**, so a project config can override one agent without restating
 *   the rest.
 * - `permissions` is an ordered array in V2, not an object. Rules are keyed by
 *   `action` + `resource`; a later document replaces an earlier rule with the
 *   same key, and the surviving order is the merge order.
 * - `plugins` is a list, and plugins are additive in OpenCode, so packages are
 *   unioned (deduped by package name) rather than replaced. Each entry may be a
 *   bare package name or `{ package, options }`; only the package name is kept
 *   here.
 * - `directory` entries are **not** config. They mark directories that were
 *   searched while discovering config, and are collected into
 *   {@link OpenCodeConfig.directories} for display instead of being merged.
 *
 * `theme` does not exist anywhere in V2 config. The app's theme is a purely
 * local preference held in `ThemeContext`, so there is nothing to fold and
 * nothing to sync. The Appearance section in Settings is intentionally local.
 */

type ConfigInfo = Extract<ConfigEntry, { type: "document" }>["info"];

/** A permission rule as V2 models it: an ordered, flat list. */
export type OpenCodePermissionRule = NonNullable<
  ConfigInfo["permissions"]
>[number];

/** An `agents` entry, with V2's renames applied (`system`, `steps`, `disabled`). */
export type OpenCodeAgentConfig = NonNullable<ConfigInfo["agents"]>[string];

/** A `commands` entry. V2 requires `template`. */
export type OpenCodeCommandConfig = NonNullable<ConfigInfo["commands"]>[string];

/** A `providers` entry, including its nested `models` map. */
export type OpenCodeProviderConfig = NonNullable<
  ConfigInfo["providers"]
>[string];

export type OpenCodeShare = NonNullable<ConfigInfo["share"]>;

/**
 * The effective config after folding every `document` entry.
 *
 * Field names follow V2 (`agents`, `commands`, `plugins`, `permissions`), not
 * the V1 spellings the older UI used.
 */
export interface OpenCodeConfig {
  /** Shell the server runs commands with. `null` means explicitly cleared. */
  shell: string | null;
  /** Default model as `"provider/model"`, or an object form in V2. */
  model: string | null;
  /** V2 spells this `default_agent`; exposed camelCase for the UI. */
  defaultAgent: string | null;
  share: OpenCodeShare | null;
  snapshots: boolean;

  agents: Record<string, OpenCodeAgentConfig>;
  commands: Record<string, OpenCodeCommandConfig>;
  providers: Record<string, OpenCodeProviderConfig>;
  /** V2's `references`: repository/path entries merged key by key. */
  references: Record<string, unknown>;

  /** Effective permission rules, in merge order. */
  permissions: OpenCodePermissionRule[];
  /** Package names only, unioned across documents, deduped, lowest first. */
  plugins: string[];
  instructions: string[];
  skills: string[];

  /** Paths of the merged documents, lowest priority first. */
  sources: string[];
  /** Directories reported by `directory` entries. Discovery roots, not config. */
  directories: string[];

  /**
   * Naive shallow last-wins view of every top-level key across the documents.
   *
   * Useful for a read-only "what did the server actually send" preview, but it
   * is **not** the effective config: record fields here are replaced wholesale
   * and `plugins` shows only the highest-precedence document's list. Use the
   * normalized fields above for anything the user sees.
   */
  raw: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Read a package name out of one `plugins` entry.
 *
 * V2 allows `string | { package, options? }`; V1 only ever had `string[]`. Both
 * are accepted so an older server or a hand-edited file does not break the list.
 */
function pluginPackageName(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (isRecord(value)) {
    const pkg = value.package;
    if (typeof pkg === "string") {
      const trimmed = pkg.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

/**
 * Normalize a `plugins` value to package names.
 *
 * Exported because it tolerates any shape: the Settings screen and the plugin
 * list both need to count and name plugins without assuming which of the array
 * or object spellings they are looking at.
 */
export function configPluginPackageNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const name = pluginPackageName(entry);
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/**
 * Count entries in a config collection without assuming its shape.
 *
 * `agents` / `commands` / `providers` are objects keyed by name, while `plugins`,
 * `instructions` and `skills` are arrays, and a resolved config also carries
 * `permissions` as an array. Anything unrecognised counts as zero rather than
 * throwing, so a future V2 field cannot crash Settings.
 */
export function countConfigEntries(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (isRecord(value)) {
    return Object.keys(value).length;
  }
  return 0;
}

function permissionKey(rule: OpenCodePermissionRule): string {
  return `${rule.action}\u0000${rule.resource}`;
}

/**
 * Fold `config.get()`'s document list into one effective config.
 *
 * Accepts the raw V2 payload; `null`/`undefined` (not connected, or a server
 * that returned nothing) resolves to an empty config rather than throwing, so
 * consumers can render the "not connected" state from the same object.
 */
export function resolveConfig(
  entries: readonly ConfigEntry[] | null | undefined,
): OpenCodeConfig {
  const raw: Record<string, unknown> = {};
  const agents: Record<string, OpenCodeAgentConfig> = {};
  const commands: Record<string, OpenCodeCommandConfig> = {};
  const providers: Record<string, OpenCodeProviderConfig> = {};
  const references: Record<string, unknown> = {};
  const permissions = new Map<string, OpenCodePermissionRule>();
  const plugins: string[] = [];
  const pluginSeen = new Set<string>();
  const sources: string[] = [];
  const directories: string[] = [];
  const instructions: string[] = [];
  const skills: string[] = [];

  for (const entry of entries ?? []) {
    if (entry.type === "directory") {
      // Discovery root, not config. Recorded for display, never merged.
      directories.push(entry.path);
      continue;
    }

    const info = entry.info;
    if (entry.path) {
      sources.push(entry.path);
    }

    // Reference view: shallow, last present key wins.
    for (const key of Object.keys(info)) {
      raw[key] = (info as Record<string, unknown>)[key];
    }

    // Record-shaped fields merge per key so partial overrides work.
    if (info.agents) Object.assign(agents, info.agents);
    if (info.commands) Object.assign(commands, info.commands);
    if (info.providers) Object.assign(providers, info.providers);
    if (info.references) Object.assign(references, info.references);

    // Ordered ruleset: later documents override same-key rules, keeping order.
    for (const rule of info.permissions ?? []) {
      permissions.set(permissionKey(rule), rule);
    }

    // Plugins are additive, so union rather than replace.
    for (const name of configPluginPackageNames(info.plugins)) {
      if (!pluginSeen.has(name)) {
        pluginSeen.add(name);
        plugins.push(name);
      }
    }

    for (const item of info.instructions ?? []) {
      if (!instructions.includes(item)) instructions.push(item);
    }
    for (const item of info.skills ?? []) {
      if (!skills.includes(item)) skills.push(item);
    }
  }

  return {
    shell: typeof raw.shell === "string" ? raw.shell : null,
    model: pickString(
      typeof raw.model === "string"
        ? raw.model
        : isRecord(raw.model)
          ? `${String(raw.model.providerID)}/${String(raw.model.model)}`
          : null,
    ),
    defaultAgent: pickString(raw.default_agent),
    share: (raw.share as OpenCodeShare | undefined) ?? null,
    snapshots: raw.snapshots === true,
    agents,
    commands,
    providers,
    references,
    permissions: [...permissions.values()],
    plugins,
    instructions,
    skills,
    sources,
    directories,
    raw,
  };
}

/** Counts for the Settings screen's "Server config" summary line. */
export interface OpenCodeConfigCounts {
  agents: number;
  commands: number;
  plugins: number;
  providers: number;
}

/**
 * Structural minimum the read helpers below need.
 *
 * Deliberately loose: these are the only fields the UI reads, and typing the
 * input this way keeps the screens compiling against whatever precise config
 * type the query layer hands back, including while that type is still moving.
 */
export interface OpenCodeConfigLike {
  shell?: unknown;
  agents?: unknown;
  commands?: unknown;
  providers?: unknown;
  plugins?: unknown;
  sources?: unknown;
  directories?: unknown;
}

export function configCounts(
  config: OpenCodeConfigLike | null | undefined,
): OpenCodeConfigCounts {
  if (!config) {
    return { agents: 0, commands: 0, plugins: 0, providers: 0 };
  }
  return {
    agents: countConfigEntries(config.agents),
    commands: countConfigEntries(config.commands),
    plugins: countConfigEntries(config.plugins),
    providers: countConfigEntries(config.providers),
  };
}

/** The server's configured shell, or `null` when unset/cleared. */
export function configShell(
  config: OpenCodeConfigLike | null | undefined,
): string | null {
  return typeof config?.shell === "string" ? config.shell : null;
}

/** Package names declared across the merged config documents. */
export function configPluginNames(
  config: OpenCodeConfigLike | null | undefined,
): string[] {
  if (!config) {
    return [];
  }
  if (Array.isArray(config.plugins)) {
    return configPluginPackageNames(config.plugins);
  }
  // Tolerate the V1 spelling, where `plugin` was a record of name -> options and
  // the *values* were arbitrary objects such as `{ hostname: "0.0.0.0" }`. Only
  // the keys are package names; returning the values is what previously made
  // React attempt to render an object as a child and crash.
  if (isRecord(config.plugins)) {
    return Object.keys(config.plugins).filter((key) => key.trim().length > 0);
  }
  return [];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Config document paths that were merged, lowest priority first. */
export function configSources(
  config: OpenCodeConfigLike | null | undefined,
): string[] {
  return stringList(config?.sources);
}

/** `directory` entries: roots searched for config, never merged themselves. */
export function configDirectories(
  config: OpenCodeConfigLike | null | undefined,
): string[] {
  return stringList(config?.directories);
}
