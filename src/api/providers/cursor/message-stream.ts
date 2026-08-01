import type { MessageWithParts } from "@/types/opencode";
import type { CursorStreamEvent } from "./types";

let idCounter = 0;
function generateId(): string {
  return `cursor-${Date.now()}-${++idCounter}`;
}

function newAssistantInfo(runId: string) {
  return {
    id: generateId(),
    role: "assistant",
    sessionID: runId,
    createdAt: new Date().toISOString(),
  } as unknown as MessageWithParts["info"];
}

function newSystemInfo(runId: string) {
  return {
    id: generateId(),
    role: "system",
    sessionID: runId,
    createdAt: new Date().toISOString(),
  } as unknown as MessageWithParts["info"];
}

function newTextPart(text: string) {
  return {
    id: generateId(),
    type: "text",
    text,
  } as unknown as MessageWithParts["parts"][number];
}

function newThinkingPart(text: string) {
  return {
    id: generateId(),
    type: "thinking",
    content: text,
  } as unknown as MessageWithParts["parts"][number];
}

function newToolPart(payload: Record<string, unknown>) {
  return {
    id: generateId(),
    type: "tool",
    tool: {
      name: payload.name ?? "unknown",
      state: {
        status: "completed" as const,
        input: payload.input,
        output: payload.output,
      },
    },
  } as unknown as MessageWithParts["parts"][number];
}

export function applyCursorStreamEvent(
  messages: MessageWithParts[],
  event: CursorStreamEvent,
  currentRunId: string,
): MessageWithParts[] | null {
  switch (event.type) {
    case "assistant": {
      return [
        ...messages,
        {
          info: newAssistantInfo(currentRunId),
          parts: [newTextPart(event.payload.text)],
        },
      ];
    }

    case "thinking": {
      const assistantMsg = messages.find((m) => m.info.role === "assistant");

      if (assistantMsg) {
        return messages.map((m) =>
          m.info.id === assistantMsg.info.id
            ? {
                ...m,
                parts: [
                  ...m.parts.filter(
                    (p) => (p as { type: string }).type !== "thinking",
                  ),
                  newThinkingPart(event.payload.text),
                ],
              }
            : m,
        );
      }

      return [
        ...messages,
        {
          info: newAssistantInfo(currentRunId),
          parts: [newThinkingPart(event.payload.text)],
        },
      ];
    }

    case "tool_call": {
      const assistantMsg = messages.find((m) => m.info.role === "assistant");

      if (assistantMsg) {
        return messages.map((m) =>
          m.info.id === assistantMsg.info.id
            ? {
                ...m,
                parts: [
                  ...m.parts,
                  newToolPart(event.payload as Record<string, unknown>),
                ],
              }
            : m,
        );
      }

      return [
        ...messages,
        {
          info: newAssistantInfo(currentRunId),
          parts: [newToolPart(event.payload as Record<string, unknown>)],
        },
      ];
    }

    case "status":
    case "heartbeat":
      return null;

    case "result":
      return null;

    case "error": {
      return [
        ...messages,
        {
          info: newSystemInfo(currentRunId),
          parts: [
            newTextPart(
              `Error: ${(event.payload as { message: string }).message}`,
            ),
          ],
        },
      ];
    }

    default:
      return null;
  }
}

export function isCursorAgentBusyEvent(
  event: CursorStreamEvent,
): boolean | null {
  if (event.type === "status") {
    return (
      event.payload.status === "RUNNING" || event.payload.status === "CREATING"
    );
  }
  if (event.type === "result") {
    return false;
  }
  return null;
}

export function shouldRefetchCursorMessages(event: CursorStreamEvent): boolean {
  return event.type === "result";
}
