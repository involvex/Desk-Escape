import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpenCodeClient, PluginInfo } from "@opencode/client";

import { toOpenCodeError, withOpenCodeErrors } from "@/api/opencode/errors";
import { withLocation } from "@/api/opencode/location";
import { useConnection } from "@/context/ConnectionContext";

/**
 * Plugin inventory and updates for OpenCode V2.
 *
 * **Product regression:** V1's plugin manager installed and removed plugins by
 * writing `config.plugin`. V2 has no write path for the plugin list at all:
 * `config.update` patches only `shell`, and the plugin namespace exposes just
 * `list`, `check` and `update`. Installing and removing a plugin is therefore
 * impossible over the V2 API, and this module deliberately offers no control
 * that pretends otherwise. What remains is: show what the server loaded, check
 * for newer package versions, and run the server's own update.
 *
 * V2 also returns a richer shape than V1: each entry is a `PluginInfo` with a
 * `source` (builtin / package / local / sdk), `features` and a `state`, instead
 * of a bare package name.
 */

export const pluginListKey = (directory?: string | null) =>
  ["plugins", directory ?? "default"] as const;

export const pluginCheckKey = (directory?: string | null) =>
  ["plugins", directory ?? "default", "check"] as const;

/**
 * Installed / loaded plugins, as reported by the server.
 *
 * The `client` cast narrows the connection's client to the V2 client;
 * `ConnectionContext` is mid-migration from the V1 SDK and a single documented
 * cast here keeps this module compiling against either build of it.
 */
export function usePlugins() {
  const { client: rawClient, activeDirectory } = useConnection();
  const client = rawClient as OpenCodeClient | null;

  return useQuery({
    enabled: Boolean(client),
    queryKey: pluginListKey(activeDirectory),
    queryFn: async (): Promise<PluginInfo[]> => {
      if (!client) {
        return [];
      }
      const result = await withOpenCodeErrors(() =>
        client.plugin.list(withLocation(activeDirectory)),
      );
      return result.data;
    },
    staleTime: 30_000,
  });
}

/**
 * Ask the server which package plugins have a newer version available.
 *
 * Runs on demand rather than on mount: it hits the package registry, so it must
 * not run every time the screen appears. Results are cached under a separate key
 * from the list so the list is not refetched by a check.
 */
export function usePluginCheck() {
  const { client: rawClient, activeDirectory } = useConnection();
  const client = rawClient as OpenCodeClient | null;

  return useMutation({
    mutationFn: async (): Promise<PluginInfo[]> => {
      if (!client) {
        throw new Error("Not connected.");
      }
      const result = await withOpenCodeErrors(() =>
        client.plugin.check(withLocation(activeDirectory)),
      );
      return result.data;
    },
  });
}

/**
 * Run the server's plugin update for the given package targets.
 *
 * `plugin.update` is a 204 No Content endpoint: it returns nothing, so the
 * caller must refetch the list to see the new versions. Targets are package
 * names, which is why builtin / sdk / local plugins are filtered out before
 * this is called.
 */
export function usePluginUpdate() {
  const queryClient = useQueryClient();
  const { client: rawClient, activeDirectory } = useConnection();
  const client = rawClient as OpenCodeClient | null;

  return useMutation({
    mutationFn: async (targets: string[]) => {
      if (!client) {
        throw new Error("Not connected.");
      }
      if (targets.length === 0) {
        return;
      }
      await withOpenCodeErrors(() =>
        client.plugin.update({
          ...withLocation(activeDirectory),
          targets,
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: pluginListKey(activeDirectory),
      });
      void queryClient.invalidateQueries({
        queryKey: pluginCheckKey(activeDirectory),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a value to something safe to render.
 *
 * `PluginInfo` is compile-time typed only; the fields are free-form server data
 * and plugin `options` may legitimately contain objects. React throws
 * `Objects are not valid as a React child` for a non-string child, so every
 * value that reaches `<Text>` goes through here.
 */
function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (__DEV__ && value != null) {
    console.warn(
      `[plugins] non-renderable value coerced to "${fallback}":`,
      value,
    );
  }
  return fallback;
}

/** Stable identity for a plugin entry, used as a list key. */
export function pluginKey(info: PluginInfo, index: number): string {
  const source = info.source;
  if (source.type === "package") return `package:${asText(source.target)}`;
  if (source.type === "local") return `local:${asText(source.path)}`;
  if (source.type === "sdk") return "sdk";
  return `builtin:${asText(info.id) || index}`;
}

/**
 * Human label for a plugin.
 *
 * A plugin is identified by its id, else by whatever names its source: the npm
 * target for packages, the folder for local plugins, and a fixed name for the
 * builtin / sdk cases.
 */
export function pluginName(info: PluginInfo): string {
  // `PluginInfo` is server data typed at compile time only, so narrow for real:
  // a string is the only thing that may be rendered as a React child.
  const id = asText(info.id);
  if (id) return id;
  if (info.source.type === "package") return asText(info.source.target);
  if (info.source.type === "local") return asText(info.source.path);
  if (info.source.type === "sdk") return "sdk";
  return "builtin";
}

/** One-line provenance, e.g. `package 1.2.3` or `local ./plugins/foo`. */
export function pluginSourceLabel(info: PluginInfo): string {
  const source = info.source;
  if (source.type === "package") {
    const version = asText(source.version);
    return version ? `package ${version}` : "package";
  }
  if (source.type === "local") return `local ${asText(source.path)}`;
  if (source.type === "sdk") return "sdk plugin";
  return "built in";
}

/** Short state for a badge: `active`, `failed`, `updating`, `update available`. */
export function pluginBadgeLabel(info: PluginInfo): string {
  if (pluginIsOutdated(info)) return "update available";
  if (info.source.type === "package" && info.source.updating) return "updating";
  return info.state.status === "failed" ? "failed" : "active";
}

/** `active` / `failed: <message>`, plus a transient `updating` marker. */
export function pluginStatusLabel(info: PluginInfo): string {
  if (info.source.type === "package" && info.source.updating) {
    return "updating";
  }
  if (info.state.status === "failed") {
    return `failed: ${info.state.error}`;
  }
  return "active";
}

/** Extra line for a plugin that failed to load. */
export function pluginErrorDetail(info: PluginInfo): string | null {
  if (info.state.status !== "failed") return null;
  // `error` comes from the server's plugin loader and could in principle be a
  // structured value; only a string is renderable.
  const message = asText(info.state.error);
  return message.length > 0 ? message : null;
}

export function pluginHasFailed(info: PluginInfo): boolean {
  return info.state.status === "failed";
}

export function pluginIsOutdated(info: PluginInfo): boolean {
  return info.source.type === "package" && info.source.outdated === true;
}

/** Feature badges, e.g. `server`, `tui`, `rpc`. */
export function pluginFeatures(info: PluginInfo): string[] {
  const features = info.features as Record<string, unknown> | undefined;
  if (!features || typeof features !== "object") return [];
  return (["server", "tui", "rpc"] as const).filter(
    (key) => features[key] === true,
  );
}

/** Package targets that `plugin.update` can act on. */
export function pluginUpdateTargets(plugins: readonly PluginInfo[]): string[] {
  const targets: string[] = [];
  for (const info of plugins) {
    if (
      info.source.type === "package" &&
      !targets.includes(info.source.target)
    ) {
      targets.push(info.source.target);
    }
  }
  return targets;
}

/** Normalize a thrown value for inline display. */
export function pluginErrorMessage(error: unknown): string {
  return toOpenCodeError(error).message;
}
