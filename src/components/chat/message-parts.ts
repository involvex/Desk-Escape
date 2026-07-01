import type { Part, ToolPart } from "@/types/opencode";

export type PartCategory = "text" | "tool" | "thinking";

export function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool";
}

export function isThinkingPart(part: Part): boolean {
  if (part.type === "text" || part.type === "tool") {
    return false;
  }
  return true;
}

export function isCollapsiblePart(part: Part): boolean {
  return isToolPart(part) || isThinkingPart(part);
}

export function classifyPart(part: Part): PartCategory {
  if (part.type === "text") {
    return "text";
  }
  if (isToolPart(part)) {
    return "tool";
  }
  return "thinking";
}

export function getMessageText(parts: Part[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => ("text" in part ? part.text : ""))
    .join("\n")
    .trim();
}

export function formatToolLabel(part: ToolPart): string {
  const input = (part.state?.input ?? {}) as Record<string, unknown>;
  const toolName = part.tool?.toLowerCase() ?? "tool";

  switch (toolName) {
    case "read":
      return `read ${String(input.filePath ?? input.file ?? "")}`;
    case "edit":
      return `edit ${String(input.filePath ?? input.file ?? "")}`;
    case "bash":
      return `bash ${String(input.command ?? input.cmd ?? "").slice(0, 48)}`;
    default:
      return toolName;
  }
}

export function formatThinkingLabel(part: Part): string {
  switch (part.type) {
    case "reasoning":
      return "Thinking…";
    case "step-start":
      return "Step start";
    case "step-finish":
      return "Step finish";
    case "agent":
      return "Agent";
    case "subtask":
      return "Subtask";
    default:
      return part.type;
  }
}

export function getPartLabel(part: Part): string {
  if (isToolPart(part)) {
    return formatToolLabel(part);
  }
  return formatThinkingLabel(part);
}

export function getPartStatus(
  part: Part,
): "running" | "completed" | "error" | undefined {
  if (!("state" in part) || !part.state || typeof part.state !== "object") {
    return undefined;
  }
  const status = (part.state as { status?: string }).status;
  if (status === "running" || status === "pending") {
    return "running";
  }
  if (status === "error" || status === "failed") {
    return "error";
  }
  if (status === "completed" || status === "done") {
    return "completed";
  }
  return undefined;
}

export function getToolBody(part: ToolPart): string {
  const state = part.state;
  if (!state) {
    return "";
  }
  if ("output" in state && state.output != null) {
    return typeof state.output === "string"
      ? state.output
      : JSON.stringify(state.output, null, 2);
  }
  if ("input" in state && state.input != null) {
    return JSON.stringify(state.input, null, 2);
  }
  return "";
}

export function getThinkingBody(part: Part): string {
  if ("text" in part && typeof part.text === "string") {
    return part.text;
  }
  if ("content" in part && typeof part.content === "string") {
    return part.content;
  }
  if ("reasoning" in part && typeof part.reasoning === "string") {
    return part.reasoning;
  }
  return JSON.stringify(part, null, 2);
}
