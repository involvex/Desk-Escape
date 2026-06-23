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

export function getFileIcon(
  name: string,
  type: "file" | "directory",
): LucideIcon {
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
