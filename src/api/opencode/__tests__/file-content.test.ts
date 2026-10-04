import { describe, expect, test } from "bun:test";

import {
  MAX_VIEWABLE_BYTES,
  decodeFileContent,
  formatBytes,
  isMarkdownPath,
  languageLabel,
  looksBinary,
} from "@/api/opencode/file-content";

/**
 * Tests for turning `file.read` bytes into something renderable.
 *
 * `file.read` answers with a bare `Uint8Array` and nothing else, so every
 * decision the viewer makes - text or binary, render or refuse - comes from these
 * functions. Getting the binary heuristic wrong in either direction is bad:
 * calling a source file binary hides the file entirely, and calling a binary file
 * text fills the screen with replacement characters.
 */

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

describe("looksBinary", () => {
  test("plain text is not binary", () => {
    expect(looksBinary(bytes("const x = 1;\n"))).toBe(false);
  });

  test("a NUL byte is decisive", () => {
    // No text encoding this app decodes puts a NUL in the middle of a file.
    expect(looksBinary(new Uint8Array([0x61, 0x62, 0x00, 0x63]))).toBe(true);
  });

  test("a NUL at the very end still counts", () => {
    expect(looksBinary(new Uint8Array([0x61, 0x00]))).toBe(true);
  });

  test("a realistic PNG header is binary", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]);
    expect(looksBinary(png)).toBe(true);
  });

  test("an ELF header is binary", () => {
    const elf = new Uint8Array([
      0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00,
    ]);
    expect(looksBinary(elf)).toBe(true);
  });

  test("tabs, newlines and carriage returns do not make a file binary", () => {
    expect(looksBinary(bytes("a\tb\r\nc\nd"))).toBe(false);
  });

  test("UTF-8 multibyte text is not binary", () => {
    // Continuation and lead bytes are >= 0x80 and must not count as suspicious.
    expect(looksBinary(bytes("héllo wörld — ünïcodé ✓ 日本語"))).toBe(false);
  });

  test("emoji-heavy text is not binary", () => {
    expect(looksBinary(bytes("🎉 🚀 🔥 done 🎉 🚀 🔥 done"))).toBe(false);
  });

  test("an empty buffer is not binary", () => {
    expect(looksBinary(new Uint8Array(0))).toBe(false);
  });

  test("text with a few stray control bytes is still text", () => {
    // Under the 30% threshold: a stray 0x01 in a log file should not hide it.
    const mostlyText = "0123456789".repeat(20) + "\u0001";
    expect(looksBinary(bytes(mostlyText))).toBe(false);
  });

  test("content well past the sniff window is still judged", () => {
    // Only the first bytes are sniffed, so a NUL deep inside a large file is not
    // seen. Documented consequence of sniffing a prefix.
    const large = new Uint8Array(20_000).fill(0x41);
    large[15_000] = 0x00;
    expect(looksBinary(large)).toBe(false);
  });

  test("a NUL inside the sniff window of a large file is caught", () => {
    const large = new Uint8Array(20_000).fill(0x41);
    large[500] = 0x00;
    expect(looksBinary(large)).toBe(true);
  });
});

/**
 * The ratio branch, with no NUL byte anywhere.
 *
 * Separated from the tests above on purpose: every fixture there contains a NUL,
 * which short-circuits on the first byte and never evaluates the ratio. Without
 * these the 30% threshold could be any value at all and the suite would still
 * pass.
 */
describe("looksBinary: control-byte ratio (no NUL present)", () => {
  /** `suspicious` control bytes (0x01) among `total` printable 'A' bytes. */
  function controlBytes(suspicious: number, total: number): Uint8Array {
    const out = new Uint8Array(total).fill(0x41);
    for (let i = 0; i < suspicious; i++) {
      out[i] = 0x01;
    }
    return out;
  }

  test("exactly 30% is still text", () => {
    // 6 of 20 = 0.30, and the comparison is strictly greater than.
    expect(looksBinary(controlBytes(6, 20))).toBe(false);
  });

  test("just over 30% is binary", () => {
    // 7 of 21 = 0.333.
    expect(looksBinary(controlBytes(7, 21))).toBe(true);
  });

  test("well over 30% is binary", () => {
    expect(looksBinary(controlBytes(19, 20))).toBe(true);
  });

  test("no control bytes at all is text", () => {
    expect(looksBinary(controlBytes(0, 64))).toBe(false);
  });

  test("a low proportion of control bytes is text", () => {
    // 1 in 100 is normal for a binary-ish log with a stray escape.
    expect(looksBinary(controlBytes(1, 100))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decodeFileContent
// ---------------------------------------------------------------------------

describe("decodeFileContent", () => {
  test("decodes text", () => {
    const result = decodeFileContent(bytes("hello world\n"));
    expect(result).toMatchObject({ kind: "text", text: "hello world\n" });
  });

  test("reports an empty file distinctly from an unreadable one", () => {
    // A zero-byte file is common and legitimate (an empty `.gitkeep`), and it must
    // not be reported as binary or as a failure.
    expect(decodeFileContent(new Uint8Array(0))).toEqual({
      kind: "empty",
      size: 0,
    });
  });

  test("reports binary rather than returning mojibake", () => {
    const result = decodeFileContent(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(result.kind).toBe("binary");
  });

  test("rejects an oversized file before decoding it", () => {
    const huge = new Uint8Array(MAX_VIEWABLE_BYTES + 1).fill(0x41);
    const result = decodeFileContent(huge);
    expect(result).toMatchObject({
      kind: "too-large",
      size: MAX_VIEWABLE_BYTES + 1,
      limit: MAX_VIEWABLE_BYTES,
    });
  });

  test("accepts a file exactly at the limit", () => {
    // The boundary must be inclusive on the allowed side.
    const atLimit = new Uint8Array(MAX_VIEWABLE_BYTES).fill(0x41);
    expect(decodeFileContent(atLimit).kind).toBe("text");
  });

  test("checks size before binary so a huge binary is not sniffed", () => {
    const hugeBinary = new Uint8Array(MAX_VIEWABLE_BYTES + 10);
    expect(decodeFileContent(hugeBinary).kind).toBe("too-large");
  });

  test("a malformed byte does not throw", () => {
    // Lone continuation byte: invalid UTF-8. `fatal: false` replaces it instead
    // of raising, so the file still renders.
    const result = decodeFileContent(new Uint8Array([0x61, 0xc3, 0x28, 0x62]));
    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.text).toContain("a");
      expect(result.text).toContain("b");
    }
  });

  test("preserves line structure exactly", () => {
    const source = "line one\n  indented\n\nlast\n";
    const result = decodeFileContent(bytes(source));
    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.text).toBe(source);
    }
  });

  test("carries the byte size, not the character count", () => {
    // Multibyte text: the size shown in the header must be the transferred bytes.
    const result = decodeFileContent(bytes("日本語"));
    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.size).toBe(9);
    }
  });

  test("is not truncated at the limit", () => {
    // The cap is a rejection, not a truncation: a file that passes is whole.
    const result = decodeFileContent(bytes("complete"));
    expect(result.kind === "text" && result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Markdown routing
// ---------------------------------------------------------------------------

describe("isMarkdownPath", () => {
  for (const path of ["a.md", "README.MD", "docs/x.markdown", "notes.mdx"]) {
    test(`${path} renders as markdown`, () => {
      expect(isMarkdownPath(path)).toBe(true);
    });
  }

  for (const path of [
    "a.ts",
    "a.tsx",
    "a.json",
    "a.txt",
    "Makefile",
    // A dotfile must not read as an extension.
    ".md",
    ".mdrc",
    // No extension at all.
    "LICENSE",
    "a.",
  ]) {
    test(`${path} does not render as markdown`, () => {
      expect(isMarkdownPath(path)).toBe(false);
    });
  }

  test("uses the basename, not the directory", () => {
    expect(isMarkdownPath("docs/v1.2/notes.md")).toBe(true);
    expect(isMarkdownPath("a.md/notes.txt")).toBe(false);
  });

  test("handles Windows separators", () => {
    expect(isMarkdownPath("src\\components\\readme.md")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Language labels
// ---------------------------------------------------------------------------

describe("languageLabel", () => {
  test("labels common source files", () => {
    expect(languageLabel("src/app.ts")).toBe("TypeScript");
    expect(languageLabel("src/app.tsx")).toBe("TypeScript JSX");
    expect(languageLabel("main.go")).toBe("Go");
    expect(languageLabel("lib.rs")).toBe("Rust");
    expect(languageLabel("app.py")).toBe("Python");
  });

  test("is case insensitive", () => {
    expect(languageLabel("README.MD")).toBe("Markdown");
    expect(languageLabel("App.TS")).toBe("TypeScript");
  });

  test("recognises extensionless conventions", () => {
    expect(languageLabel("Dockerfile")).toBe("Dockerfile");
    expect(languageLabel("path/to/Dockerfile")).toBe("Dockerfile");
    expect(languageLabel("Makefile")).toBe("Makefile");
  });

  test("returns null for an unknown extension", () => {
    expect(languageLabel("data.weirdext")).toBeNull();
  });

  test("returns null rather than throwing on odd paths", () => {
    expect(languageLabel("")).toBeNull();
    expect(languageLabel(".")).toBeNull();
    expect(languageLabel("a.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe("formatBytes", () => {
  test("formats bytes below a kilobyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  test("switches to KB at 1024", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  test("drops the decimal once the number gets long", () => {
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });

  test("does not divide forever", () => {
    expect(formatBytes(1024 ** 4)).toContain("GB");
  });
});
