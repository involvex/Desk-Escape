import { Share } from "react-native";
import type { Session } from "@opencode-ai/sdk/client";
import type { MessageWithParts } from "@/types/opencode";

export function exportSessionToMarkdown(
  session: Session | null,
  messages: MessageWithParts[],
): string {
  const title = session?.title || "Untitled Session";
  const created = session?.time.created;
  const updated = session?.time.updated;
  const directory = session?.directory;
  const modelMessage = messages.find((m) => m.info.role === "assistant")?.info;
  const model =
    modelMessage && "modelID" in modelMessage
      ? String(modelMessage.modelID)
      : "unknown";

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  if (created) {
    lines.push(`Created: ${new Date(created).toISOString()}`);
  }
  if (updated && updated !== created) {
    lines.push(`Updated: ${new Date(updated).toISOString()}`);
  }
  if (directory) {
    lines.push(`Directory: \`${directory}\``);
  }
  lines.push(`Model: ${model}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    const roleLabel = msg.info.role === "user" ? "User" : "Assistant";
    lines.push(`## ${roleLabel}`);
    lines.push("");

    if (msg.info.time.created) {
      lines.push(`_${new Date(msg.info.time.created).toISOString()}_`);
      lines.push("");
    }

    for (const part of msg.parts) {
      if (part.type === "text" && "text" in part && part.text) {
        lines.push(part.text);
        lines.push("");
      } else if (part.type === "tool" && "tool" in part) {
        const toolPart = part as {
          tool?: string;
          state?: { input?: unknown; output?: unknown };
        };
        lines.push(`### Tool: ${toolPart.tool ?? "unknown"}`);
        lines.push("");
        if (toolPart.state?.input) {
          lines.push("**Input:**");
          lines.push("```");
          lines.push(
            typeof toolPart.state.input === "string"
              ? toolPart.state.input
              : JSON.stringify(toolPart.state.input, null, 2),
          );
          lines.push("```");
          lines.push("");
        }
        if (toolPart.state?.output) {
          lines.push("**Output:**");
          lines.push("```");
          lines.push(
            typeof toolPart.state.output === "string"
              ? toolPart.state.output
              : JSON.stringify(toolPart.state.output, null, 2),
          );
          lines.push("```");
          lines.push("");
        }
      } else if (part.type === "reasoning" && "text" in part && part.text) {
        lines.push("### Reasoning");
        lines.push("");
        lines.push(String(part.text));
        lines.push("");
      } else if (part.type === "file" && "filename" in part && part.filename) {
        lines.push(`Attachment: ${String(part.filename)}`);
        lines.push("");
      }
    }

    const tokens = "tokens" in msg.info ? msg.info.tokens : undefined;
    const cost = "cost" in msg.info ? msg.info.cost : undefined;
    if (msg.info.role === "assistant" && tokens) {
      const t = tokens as {
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: { read?: number; write?: number };
      };
      lines.push(
        `Tokens: ${t.input ?? 0} in / ${t.output ?? 0} out` +
          (t.reasoning ? ` / ${t.reasoning} reasoning` : "") +
          (t.cache?.read ? ` / ${t.cache.read} cache-r` : "") +
          (t.cache?.write ? ` / ${t.cache.write} cache-w` : "") +
          (typeof cost === "number" ? ` | Cost: $${cost.toFixed(4)}` : ""),
      );
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export async function shareSessionMarkdown(
  session: Session | null,
  messages: MessageWithParts[],
): Promise<void> {
  const markdown = exportSessionToMarkdown(session, messages);
  const title = session?.title || "session";
  await Share.share({
    message: markdown,
    title,
  });
}
