import { toolDurationMs, toolOutputText } from "@/types/domain";
import type { ChatPart, ChatToolPart } from "@/types/domain";

export type PartCategory = "text" | "tool" | "thinking";

export function isToolPart(part: ChatPart): part is ChatToolPart {
  return part.type === "tool";
}

export function isReasoningPart(part: ChatPart): boolean {
  return part.type === "reasoning";
}

/**
 * Whether a part belongs in the collapsed "thinking" group.
 *
 * This is deliberately a closed allowlist. The V1 implementation was written as
 * a negation (`type === "text" || type === "tool" ? false : true`), which meant
 * every part type it did not recognise -- including any new one -- silently
 * rendered as reasoning. V2 only produces text, reasoning and tool content, so
 * enumerating them keeps an unexpected variant from being mislabelled.
 */
export function isThinkingPart(part: ChatPart): boolean {
  return isReasoningPart(part);
}

export function isCollapsiblePart(part: ChatPart): boolean {
  return isToolPart(part) || isThinkingPart(part);
}

export function classifyPart(part: ChatPart): PartCategory {
  if (part.type === "text") {
    return "text";
  }
  if (isToolPart(part)) {
    return "tool";
  }
  return "thinking";
}

export function getMessageText(parts: ChatPart[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function formatToolLabel(part: ChatToolPart): string {
  // Arguments are only parsed once the tool stops streaming; before that the
  // partial JSON lives in `rawInput`.
  const input = part.input ?? {};
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

export function formatThinkingLabel(part: ChatPart): string {
  switch (part.type) {
    case "reasoning":
      return "Thinking…";
    default:
      return part.type;
  }
}

export function getPartLabel(part: ChatPart): string {
  if (isToolPart(part)) {
    return formatToolLabel(part);
  }
  return formatThinkingLabel(part);
}

export function getPartStatus(
  part: ChatPart,
): "running" | "completed" | "error" | undefined {
  if (!isToolPart(part)) {
    return undefined;
  }
  switch (part.status) {
    case "streaming":
    case "running":
      return "running";
    case "error":
      return "error";
    case "completed":
      return "completed";
    default:
      return undefined;
  }
}

export function getToolBody(part: ChatToolPart): string {
  // V2 replaced V1's single `state.output` string with a structured
  // `state.content[]`, so render the joined text before falling back to args.
  const output = toolOutputText(part);
  if (output) {
    return output;
  }
  if (part.rawInput) {
    return part.rawInput;
  }
  if (part.input) {
    return JSON.stringify(part.input, null, 2);
  }
  return "";
}

export function getThinkingBody(part: ChatPart): string {
  if (part.type === "reasoning" || part.type === "text") {
    return part.text;
  }
  return JSON.stringify(part, null, 2);
}

export function getThinkingMetadata(part: ChatPart): {
  isStreaming: boolean;
  duration: number | null;
  startTime: number | null;
  endTime: number | null;
} {
  // V2 moved timestamps off `state` and onto the tool content as
  // `time.{created, ran, completed}`.
  const time = "time" in part ? part.time : undefined;
  if (!time?.created) {
    return {
      isStreaming: false,
      duration: null,
      startTime: null,
      endTime: null,
    };
  }

  const duration = isToolPart(part) ? toolDurationMs(part) : undefined;

  return {
    isStreaming: isToolPart(part) && part.status === "running",
    duration: duration ?? null,
    startTime: time.created,
    endTime: time.completed ?? null,
  };
}
