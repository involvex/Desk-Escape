/**
 * Turning `file.read` bytes into something renderable.
 *
 * V2's `file.read` returns a bare `Uint8Array` - no mime type, no encoding, no
 * size metadata (`FileReadOutput = globalThis.Uint8Array`). Everything the viewer
 * needs to decide how to present a file therefore has to be derived here, and it
 * all has to be derived from the bytes plus the path.
 *
 * Kept free of React and of the SDK so the rules can be tested directly.
 */

/**
 * Largest body the viewer will render.
 *
 * A repository contains files that are perfectly valid and completely unreadable
 * on a phone: build outputs, lockfiles, minified bundles, dumps. Fetching those
 * to decide whether they are viewable is the expensive part, so the cap is
 * enforced on the byte count before any decoding happens.
 */
export const MAX_VIEWABLE_BYTES = 512 * 1024;

/** How much of the body the binary heuristic inspects. */
const SNIFF_BYTES = 8000;

export type FileContent =
  | { kind: "text"; text: string; truncated: boolean; size: number }
  | { kind: "binary"; size: number }
  | { kind: "too-large"; size: number; limit: number }
  | { kind: "empty"; size: 0 };

/**
 * Heuristic binary detection, following the usual "is it text?" rules.
 *
 * A NUL byte is decisive: no text encoding this app will encounter puts one in
 * the middle of a file. Beyond that, a high proportion of C0 control characters
 * (excluding tab, newline and carriage return) means the bytes are not text.
 *
 * Deliberately not a mime lookup. There is no extension table that stays correct
 * across the file types a code agent touches, and guessing wrong on a `.tsx`
 * costs nothing whereas guessing wrong on a `.wasm` produces a screenful of
 * replacement characters.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, SNIFF_BYTES);
  if (limit === 0) {
    return false;
  }

  let suspicious = 0;
  for (let i = 0; i < limit; i++) {
    const byte = bytes[i]!;
    if (byte === 0) {
      return true;
    }
    // Printable ASCII, tab, newline, carriage return, plus everything from 0x80 up
    // (UTF-8 continuation and lead bytes, which are not a binary signal).
    const isTextByte =
      byte >= 0x20 ||
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      byte === 0x0c;
    if (!isTextByte) {
      suspicious++;
    }
  }

  return suspicious / limit > 0.3;
}

/**
 * Decodes bytes for display.
 *
 * `TextDecoder` with `fatal: false` replaces malformed sequences with U+FFFD
 * rather than throwing, so a file with one bad byte in the middle still renders.
 */
export function decodeFileContent(bytes: Uint8Array): FileContent {
  const size = bytes.length;

  if (size === 0) {
    return { kind: "empty", size: 0 };
  }

  // Check size first: a multi-megabyte binary would otherwise be sniffed before
  // being rejected.
  if (size > MAX_VIEWABLE_BYTES) {
    return { kind: "too-large", size, limit: MAX_VIEWABLE_BYTES };
  }

  if (looksBinary(bytes)) {
    return { kind: "binary", size };
  }

  const text = new TextDecoder("utf-8").decode(bytes);
  return { kind: "text", text, truncated: false, size };
}

/** Extension, lowercased, without the dot. Empty when the name has none. */
function extensionOf(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return "";
  }
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Whether a text file should go through the markdown renderer.
 *
 * Only the formats markdown actually improves on are listed. Rendering arbitrary
 * source as markdown would reflow code, swallow indentation and mangle table-like
 * structures, so everything else stays as preformatted text.
 */
export function isMarkdownPath(path: string): boolean {
  return ["md", "markdown", "mdx"].includes(extensionOf(path));
}

/**
 * Short language label for the header, or `null` when unknown.
 *
 * Used only as a hint in the UI. Nothing parses with it, so an incomplete table
 * is harmless and much cheaper than a real language registry.
 */
export function languageLabel(path: string): string | null {
  const byExtension: Record<string, string> = {
    // Markdown renders through the markdown path, so it still deserves a label.
    md: "Markdown",
    markdown: "Markdown",
    mdx: "MDX",
    ts: "TypeScript",
    tsx: "TypeScript JSX",
    mts: "TypeScript",
    cts: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript JSX",
    mjs: "JavaScript",
    cjs: "JavaScript",
    json: "JSON",
    jsonc: "JSON",
    yml: "YAML",
    yaml: "YAML",
    toml: "TOML",
    rs: "Rust",
    go: "Go",
    py: "Python",
    rb: "Ruby",
    java: "Java",
    kt: "Kotlin",
    kts: "Kotlin",
    swift: "Swift",
    c: "C",
    h: "C",
    cc: "C++",
    cpp: "C++",
    cxx: "C++",
    hpp: "C++",
    cs: "C#",
    php: "PHP",
    sh: "Shell",
    bash: "Shell",
    zsh: "Shell",
    fish: "Shell",
    ps1: "PowerShell",
    sql: "SQL",
    html: "HTML",
    htm: "HTML",
    css: "CSS",
    scss: "SCSS",
    less: "Less",
    xml: "XML",
    svg: "SVG",
    gradle: "Gradle",
    dockerfile: "Dockerfile",
    makefile: "Makefile",
    lua: "Lua",
    pl: "Perl",
    r: "R",
    dart: "Dart",
    ex: "Elixir",
    exs: "Elixir",
    erl: "Erlang",
    hs: "Haskell",
    scala: "Scala",
    zig: "Zig",
    vue: "Vue",
    svelte: "Svelte",
    graphql: "GraphQL",
    gql: "GraphQL",
    proto: "Protobuf",
    ini: "INI",
    env: "Dotenv",
    txt: "Text",
    log: "Log",
    lock: "Lockfile",
  };

  const extension = extensionOf(path);
  if (byExtension[extension]) {
    return byExtension[extension]!;
  }

  // Extensionless files that are conventionally these languages.
  const name = (path.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase();
  if (name === "dockerfile") return "Dockerfile";
  if (name === "makefile") return "Makefile";
  if (name === "license") return "Text";
  if (name === "readme") return "Markdown";

  return null;
}

/** Human-readable byte count, e.g. `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
