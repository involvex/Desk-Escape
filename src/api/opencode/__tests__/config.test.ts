import { describe, expect, test } from "bun:test";

import {
  configCounts,
  configDirectories,
  configPluginNames,
  configPluginPackageNames,
  configShell,
  configSources,
  countConfigEntries,
  resolveConfig,
} from "@/api/opencode/config";

/**
 * Tests for the V2 config fold.
 *
 * `resolveConfig` merges the ordered list of source documents V2 returns into one
 * effective config. The merge has several non-obvious rules - per-key record
 * merging, ordered permission replacement by action+resource, additive plugin
 * unioning, and directory entries that are collected but never merged - and a
 * regression in any of them would show up in Settings as silently wrong data
 * rather than an error.
 */

import type { ConfigEntry } from "@opencode/client";

/** A single entry accepted by `resolveConfig`. */
type Entry = ConfigEntry;

/** The entry list shape `resolveConfig` accepts, minus the nullish forms. */
type EntryList = readonly ConfigEntry[];

type Info = Record<string, unknown>;

/**
 * Builds a `document` entry.
 *
 * `type` is pinned to the literal `"document"` (rather than inferred as `string`)
 * because `ConfigEntry` is a discriminated union. `info` stays loose on purpose
 * so each test can state only the keys it cares about.
 */
function document(info: Info, path?: string): Entry {
  return {
    type: "document",
    info,
    ...(path ? { path } : {}),
  } as Entry;
}

function directory(path: string): Entry {
  return { type: "directory", path } as Entry;
}

/** Convenience wrapper so call sites read as whole stacks of documents. */
function docs(...entries: Entry[]): EntryList {
  return entries;
}

/**
 * Same as {@link docs}, but for the common case of a single entry.
 *
 * Keeps single-document assertions readable without re-introducing the
 * `resolveConfig([...])` widening that loses the literal `type`.
 */
function doc(info: Info, path?: string): EntryList {
  return docs(document(info, path));
}

const empty = resolveConfig([]);

// ---------------------------------------------------------------------------
// Empty and missing input
// ---------------------------------------------------------------------------

describe("resolveConfig: empty input", () => {
  test("null resolves to an empty config", () => {
    const config = resolveConfig(null);
    expect(config.shell).toBeNull();
    expect(config.agents).toEqual({});
    expect(config.permissions).toEqual([]);
    expect(config.plugins).toEqual([]);
    expect(config.sources).toEqual([]);
  });

  test("undefined resolves to an empty config", () => {
    expect(resolveConfig(undefined)).toEqual(empty);
  });

  test("an empty document list resolves to an empty config", () => {
    expect(resolveConfig([])).toEqual(empty);
  });
});

// ---------------------------------------------------------------------------
// Scalars: last present wins
// ---------------------------------------------------------------------------

describe("resolveConfig: scalars", () => {
  test("reads a scalar from a single document", () => {
    const config = resolveConfig(doc({ shell: "/bin/zsh" }));
    expect(config.shell).toBe("/bin/zsh");
  });

  test("a later document overrides an earlier one", () => {
    const config = resolveConfig(
      docs(document({ shell: "/bin/bash" }), document({ shell: "/bin/fish" })),
    );
    expect(config.shell).toBe("/bin/fish");
  });

  test("omitting a key does not clear the inherited value", () => {
    // Critical: a project config that says nothing about `shell` must not reset
    // the global shell.
    const config = resolveConfig(
      docs(
        document({ shell: "/bin/bash" }),
        document({ model: "anthropic/claude" }),
      ),
    );
    expect(config.shell).toBe("/bin/bash");
    expect(config.model).toBe("anthropic/claude");
  });

  test("an explicit null clears an inherited value", () => {
    // `null` is a value in V2 and is how `shell` gets cleared.
    const config = resolveConfig(
      docs(document({ shell: "/bin/bash" }), document({ shell: null })),
    );
    expect(config.shell).toBeNull();
  });

  test("reads `default_agent` and exposes it camelCased", () => {
    const config = resolveConfig(doc({ default_agent: "build" }));
    expect(config.defaultAgent).toBe("build");
  });

  test("snapshots is only true when explicitly true", () => {
    expect(resolveConfig(doc({ snapshots: true })).snapshots).toBe(true);
    expect(resolveConfig(doc({ snapshots: false })).snapshots).toBe(false);
    expect(resolveConfig(doc({})).snapshots).toBe(false);
    expect(resolveConfig(doc({ snapshots: "yes" })).snapshots).toBe(false);
  });

  test("carries `share` through", () => {
    // V2 types `share` as "manual" | "auto" | "disabled", not a URL string.
    const config = resolveConfig(doc({ share: "manual" }));
    expect(config.share).toBe("manual");
  });

  test("share defaults to null", () => {
    expect(empty.share).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Model normalization
// ---------------------------------------------------------------------------

describe("resolveConfig: model", () => {
  test("keeps the string form as-is", () => {
    expect(resolveConfig(doc({ model: "anthropic/claude" })).model).toBe(
      "anthropic/claude",
    );
  });

  test("flattens the object form to provider/model", () => {
    const config = resolveConfig(
      docs(
        document({
          model: { providerID: "anthropic", model: "claude-sonnet-4" },
        }),
      ),
    );
    expect(config.model).toBe("anthropic/claude-sonnet-4");
  });

  test("normalizes to null for an unusable value", () => {
    expect(resolveConfig(doc({ model: 42 })).model).toBeNull();
    expect(resolveConfig(doc({ model: null })).model).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Records: merge per key
// ---------------------------------------------------------------------------

describe("resolveConfig: record fields", () => {
  test("merges agents key by key rather than replacing", () => {
    // The reason records merge per key: a project config should be able to
    // override one agent without restating every other agent.
    const config = resolveConfig(
      docs(
        document({ agents: { build: { model: "a" }, plan: { model: "b" } } }),
        document({ agents: { build: { model: "c" } } }),
      ),
    );

    expect(config.agents.build).toEqual({ model: "c" });
    expect(config.agents.plan).toEqual({ model: "b" });
  });

  test("merges commands key by key", () => {
    const config = resolveConfig(
      docs(
        document({ commands: { a: { template: "1" }, b: { template: "2" } } }),
        document({ commands: { a: { template: "override" } } }),
      ),
    );

    expect(Object.keys(config.commands).sort()).toEqual(["a", "b"]);
    expect(config.commands.a).toEqual({ template: "override" });
  });

  test("merges providers including nested models", () => {
    const config = resolveConfig(
      docs(
        document({ providers: { anthropic: { models: { a: {} } } } }),
        document({ providers: { openai: { models: { b: {} } } } }),
      ),
    );

    expect(Object.keys(config.providers).sort()).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  test("merges references", () => {
    const config = resolveConfig(
      docs(
        document({ references: { one: "a" } }),
        document({ references: { two: "b" } }),
      ),
    );

    expect(config.references).toEqual({ one: "a", two: "b" });
  });

  test("a document with no record fields leaves earlier ones intact", () => {
    const config = resolveConfig(
      docs(
        document({ agents: { build: {} } }),
        document({ shell: "/bin/bash" }),
      ),
    );

    expect(Object.keys(config.agents)).toEqual(["build"]);
  });
});

// ---------------------------------------------------------------------------
// Permissions: ordered, replaced by action+resource
// ---------------------------------------------------------------------------

describe("resolveConfig: permissions", () => {
  // V2 models a rule as `{ action, resource, effect }`, where `action` is the
  // operation ("bash", "write") and `effect` is the verdict ("allow" | "deny" |
  // "ask"). Rules are keyed by action+resource only, so two rules for the same
  // operation but different verdicts collide on purpose - the later document
  // decides the verdict.
  const bashAllow = {
    action: "bash",
    resource: "local",
    effect: "allow" as const,
  };
  const bashDeny = {
    action: "bash",
    resource: "local",
    effect: "deny" as const,
  };

  test("collects rules in document order", () => {
    const writeAsk = {
      action: "write",
      resource: "local",
      effect: "ask" as const,
    };
    const config = resolveConfig(
      docs(
        document({ permissions: [bashAllow] }),
        document({ permissions: [writeAsk] }),
      ),
    );

    expect(config.permissions).toEqual([bashAllow, writeAsk]);
  });

  test("a later rule with the same action+resource replaces the earlier one", () => {
    const config = resolveConfig(
      docs(
        document({ permissions: [bashAllow] }),
        document({ permissions: [bashDeny] }),
      ),
    );

    expect(config.permissions).toEqual([bashDeny]);
  });

  test("a replacement keeps its original position, not the later one", () => {
    // Merge order is the surviving order, so replacing a rule must not move it
    // to the end - otherwise the precedence of the remaining rules shifts.
    const writeDeny = {
      action: "write",
      resource: "local",
      effect: "deny" as const,
    };
    const config = resolveConfig(
      docs(
        document({ permissions: [bashAllow, writeDeny] }),
        document({ permissions: [bashDeny] }),
      ),
    );

    expect(config.permissions).toEqual([bashDeny, writeDeny]);
  });

  test("different actions are both kept", () => {
    const writeDeny = {
      action: "write",
      resource: "local",
      effect: "deny" as const,
    };
    const config = resolveConfig(
      docs(
        document({ permissions: [bashAllow] }),
        document({ permissions: [writeDeny] }),
      ),
    );

    expect(config.permissions).toHaveLength(2);
  });

  test("the same action on a different resource is kept", () => {
    const remote = {
      action: "bash",
      resource: "remote",
      effect: "deny" as const,
    };
    const config = resolveConfig(
      docs(
        document({ permissions: [bashAllow] }),
        document({ permissions: [remote] }),
      ),
    );

    expect(config.permissions).toHaveLength(2);
  });

  test("rules within one document also replace by key", () => {
    const config = resolveConfig(
      docs(document({ permissions: [bashAllow, bashDeny] })),
    );
    expect(config.permissions).toEqual([bashDeny]);
  });

  test("missing permissions leaves an empty list", () => {
    expect(empty.permissions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Plugins: additive union
// ---------------------------------------------------------------------------

describe("resolveConfig: plugins", () => {
  test("unions plugins across documents rather than replacing", () => {
    // Plugins are additive in OpenCode, so a project adding one must not drop
    // the global ones.
    const config = resolveConfig(
      docs(document({ plugins: ["a", "b"] }), document({ plugins: ["c"] })),
    );

    expect(config.plugins).toEqual(["a", "b", "c"]);
  });

  test("dedupes by package name, keeping the first occurrence", () => {
    const config = resolveConfig(
      docs(
        document({ plugins: ["a", "b"] }),
        document({ plugins: ["b", "c"] }),
      ),
    );

    expect(config.plugins).toEqual(["a", "b", "c"]);
  });

  test("preserves lowest-priority-first order", () => {
    const config = resolveConfig(
      docs(
        document({ plugins: ["global"] }),
        document({ plugins: ["project"] }),
      ),
    );

    expect(config.plugins[0]).toBe("global");
  });

  test("reads the package out of the object form", () => {
    const config = resolveConfig(
      docs(document({ plugins: [{ package: "pkg", options: { x: 1 } }] })),
    );

    expect(config.plugins).toEqual(["pkg"]);
  });

  test("ignores malformed plugin entries", () => {
    const config = resolveConfig(
      docs(document({ plugins: [null, 42, {}, { package: "" }, "  ", "ok"] })),
    );

    expect(config.plugins).toEqual(["ok"]);
  });

  test("trims whitespace around package names", () => {
    expect(configPluginPackageNames(["  spaced  "])).toEqual(["spaced"]);
  });

  test("returns empty for a non-array", () => {
    expect(configPluginPackageNames(undefined)).toEqual([]);
    expect(configPluginPackageNames("nope")).toEqual([]);
    expect(configPluginPackageNames({ a: 1 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Instructions and skills
// ---------------------------------------------------------------------------

describe("resolveConfig: instructions and skills", () => {
  test("unions instructions across documents", () => {
    const config = resolveConfig(
      docs(
        document({ instructions: ["a"] }),
        document({ instructions: ["b", "a"] }),
      ),
    );

    expect(config.instructions).toEqual(["a", "b"]);
  });

  test("unions skills across documents", () => {
    const config = resolveConfig(
      docs(document({ skills: ["s1"] }), document({ skills: ["s2"] })),
    );

    expect(config.skills).toEqual(["s1", "s2"]);
  });

  test("defaults to empty", () => {
    expect(empty.instructions).toEqual([]);
    expect(empty.skills).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sources and directories
// ---------------------------------------------------------------------------

describe("resolveConfig: sources and directories", () => {
  test("records document paths in lowest-priority-first order", () => {
    const config = resolveConfig(
      docs(
        document({}, "/global/opencode.json"),
        document({}, "/project/opencode.json"),
      ),
    );

    expect(config.sources).toEqual([
      "/global/opencode.json",
      "/project/opencode.json",
    ]);
  });

  test("a document without a path is merged but not recorded as a source", () => {
    const config = resolveConfig(doc({ shell: "/bin/bash" }));
    expect(config.sources).toEqual([]);
    expect(config.shell).toBe("/bin/bash");
  });

  test("directory entries are collected, never merged", () => {
    // `directory` marks a root searched while discovering config. Merging it
    // would inject config the server never declared.
    const config = resolveConfig(docs(directory("/repo")));
    expect(config.directories).toEqual(["/repo"]);
    expect(config.shell).toBeNull();
    expect(config.sources).toEqual([]);
  });

  test("a directory entry cannot set config even alongside a document", () => {
    const config = resolveConfig(
      docs(directory("/repo"), document({ shell: "/bin/bash" })),
    );

    expect(config.shell).toBe("/bin/bash");
    expect(config.directories).toEqual(["/repo"]);
  });

  test("collects directories in order", () => {
    const config = resolveConfig(docs(directory("/a"), directory("/b")));
    expect(config.directories).toEqual(["/a", "/b"]);
  });
});

// ---------------------------------------------------------------------------
// Raw view
// ---------------------------------------------------------------------------

describe("resolveConfig: raw", () => {
  test("exposes every top-level key seen", () => {
    const config = resolveConfig(
      docs(document({ shell: "/bin/bash", custom: { nested: true } })),
    );

    expect(config.raw.shell).toBe("/bin/bash");
    expect(config.raw.custom).toEqual({ nested: true });
  });

  test("is a shallow last-wins view, not the effective config", () => {
    // `raw` is documented as a reference preview: records are replaced wholesale
    // rather than merged, so it can disagree with the normalized fields. That is
    // intentional, and this test guards the documented behaviour.
    const config = resolveConfig(
      docs(
        document({ agents: { a: {}, b: {} } }),
        document({ agents: { a: {} } }),
      ),
    );

    expect(Object.keys(config.raw.agents as object)).toEqual(["a"]);
    expect(Object.keys(config.agents).sort()).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Combined documents
// ---------------------------------------------------------------------------

describe("resolveConfig: realistic document stack", () => {
  test("folds global, project and a discovery root in priority order", () => {
    const config = resolveConfig(
      docs(
        directory("/repo"),
        document(
          {
            shell: "/bin/bash",
            model: "anthropic/claude",
            agents: { build: { model: "opus" }, plan: { model: "sonnet" } },
            permissions: [
              { action: "bash", resource: "local", effect: "allow" },
            ],
            plugins: ["global-plugin"],
            instructions: ["be concise"],
          },
          "/global/opencode.json",
        ),
        document(
          {
            agents: { build: { model: "sonnet" } },
            permissions: [{ action: "bash", resource: "local", effect: "ask" }],
            plugins: ["project-plugin"],
            skills: ["review"],
          },
          "/repo/opencode.json",
        ),
      ),
    );

    // Scalars inherited from the global document.
    expect(config.shell).toBe("/bin/bash");
    expect(config.model).toBe("anthropic/claude");

    // Project overrides one agent, keeps the other.
    expect(config.agents.build).toEqual({ model: "sonnet" });
    expect(config.agents.plan).toEqual({ model: "sonnet" });

    // Project's permission replaces the global one at the same action+resource.
    expect(config.permissions).toEqual([
      { action: "bash", resource: "local", effect: "ask" },
    ]);

    // Plugins union; instructions and skills union.
    expect(config.plugins).toEqual(["global-plugin", "project-plugin"]);
    expect(config.instructions).toEqual(["be concise"]);
    expect(config.skills).toEqual(["review"]);

    // Sources in priority order, directory recorded separately.
    expect(config.sources).toEqual([
      "/global/opencode.json",
      "/repo/opencode.json",
    ]);
    expect(config.directories).toEqual(["/repo"]);
  });
});

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

describe("read helpers", () => {
  test("countConfigEntries handles both shapes", () => {
    expect(countConfigEntries(["a", "b"])).toBe(2);
    expect(countConfigEntries({ a: 1, b: 2 })).toBe(2);
  });

  test("countConfigEntries returns zero for anything else", () => {
    expect(countConfigEntries(null)).toBe(0);
    expect(countConfigEntries(undefined)).toBe(0);
    expect(countConfigEntries("string")).toBe(0);
    expect(countConfigEntries(7)).toBe(0);
  });

  test("configCounts summarises a resolved config", () => {
    const config = resolveConfig(
      docs(
        document({
          agents: { a: {}, b: {} },
          commands: { c: {} },
          providers: { d: {} },
          plugins: ["p1", "p2"],
        }),
      ),
    );

    expect(configCounts(config)).toEqual({
      agents: 2,
      commands: 1,
      providers: 1,
      plugins: 2,
    });
  });

  test("configCounts is all zeros for a missing config", () => {
    expect(configCounts(null)).toEqual({
      agents: 0,
      commands: 0,
      providers: 0,
      plugins: 0,
    });
    expect(configCounts(undefined).agents).toBe(0);
  });

  test("configShell returns a string or null", () => {
    expect(configShell(resolveConfig(doc({ shell: "/bin/zsh" })))).toBe(
      "/bin/zsh",
    );
    expect(configShell(empty)).toBeNull();
    expect(configShell(null)).toBeNull();
  });

  test("configPluginNames reads the array form", () => {
    const config = resolveConfig(doc({ plugins: ["a"] }));
    expect(configPluginNames(config)).toEqual(["a"]);
  });

  test("configPluginNames reads the V1 record form as keys", () => {
    // Regression guard: this used to return the *values*, which are arbitrary
    // objects, and React then crashed rendering an object as a child.
    const config = {
      plugins: { "plugin-a": { hostname: "0.0.0.0" } },
    } as unknown as Parameters<typeof configPluginNames>[0];

    expect(configPluginNames(config)).toEqual(["plugin-a"]);
  });

  test("configPluginNames tolerates the object form inside an array", () => {
    const config = {
      plugins: [{ package: "pkg", options: {} }],
    } as unknown as Parameters<typeof configPluginNames>[0];

    expect(configPluginNames(config)).toEqual(["pkg"]);
  });

  test("configPluginNames is empty for a missing config", () => {
    expect(configPluginNames(null)).toEqual([]);
  });

  test("configSources and configDirectories filter to strings", () => {
    const config = resolveConfig(
      docs(
        directory("/repo"),
        document({}, "/a.json"),
        document({}, "/b.json"),
      ),
    );

    expect(configSources(config)).toEqual(["/a.json", "/b.json"]);
    expect(configDirectories(config)).toEqual(["/repo"]);
  });

  test("configSources drops non-string entries", () => {
    const config = {
      sources: ["/a.json", 42, null, "/b.json"],
    } as unknown as Parameters<typeof configSources>[0];

    expect(configSources(config)).toEqual(["/a.json", "/b.json"]);
  });

  test("source and directory helpers are empty for a missing config", () => {
    expect(configSources(null)).toEqual([]);
    expect(configDirectories(undefined)).toEqual([]);
  });
});
