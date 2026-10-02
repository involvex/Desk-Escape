import type { LucideIcon } from "lucide-react-native";
import {
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  Image,
  Settings,
} from "lucide-react-native";
import type { FileEntry } from "@/types/domain";

const codeExtensions = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "dart",
  "kt",
  "kts",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "rb",
  "php",
  "swift",
  "vue",
  "svelte",
]);

const configExtensions = new Set([
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "config",
]);

const docExtensions = new Set(["md", "mdx", "txt", "rst"]);

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

export function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Pick an icon for a directory entry.
 *
 * `type` is keyed off the domain {@link FileEntry["type"]}, which in V2 mirrors
 * the wire `FileSystemEntry.type` union exactly (`"file" | "directory"`) — no
 * widening is needed. The extension checks below remain useful because V2
 * dropped the richer V1 node and hands over a bare path.
 */
export function getFileIcon(name: string, type: FileEntry["type"]): LucideIcon {
  if (type === "directory") {
    return Folder;
  }

  const ext = getFileExtension(name);

  if (codeExtensions.has(ext)) {
    return FileCode;
  }
  if (configExtensions.has(ext)) {
    return ext === "json" ? FileJson : Settings;
  }
  if (docExtensions.has(ext)) {
    return FileText;
  }
  if (imageExtensions.has(ext)) {
    return ext === "svg" ? FileImage : Image;
  }

  return File;
}
