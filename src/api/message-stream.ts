import type { EventSubscribeResponse, Part } from "@opencode-ai/sdk/client";
import type { MessageWithParts } from "@/types/opencode";

function upsertMessage(
  messages: MessageWithParts[],
  next: MessageWithParts,
): MessageWithParts[] {
  const index = messages.findIndex((item) => item.info.id === next.info.id);
  if (index === -1) {
    return [...messages, next];
  }

  const copy = [...messages];
  copy[index] = next;
  return copy;
}

function upsertPart(parts: Part[], part: Part, delta?: string): Part[] {
  const index = parts.findIndex((item) => item.id === part.id);
  if (index === -1) {
    if (part.type === "text" && delta) {
      return [...parts, { ...part, text: delta }];
    }
    return [...parts, part];
  }

  const existing = parts[index];
  const copy = [...parts];

  if (part.type === "text" && existing.type === "text" && delta) {
    copy[index] = { ...existing, ...part, text: existing.text + delta };
    return copy;
  }

  copy[index] = part;
  return copy;
}

function removePart(parts: Part[], partId: string): Part[] {
  return parts.filter((part) => part.id !== partId);
}

export function applyStreamEvent(
  messages: MessageWithParts[],
  event: EventSubscribeResponse,
  sessionId: string,
): MessageWithParts[] | null {
  switch (event.type) {
    case "message.updated": {
      if (event.properties.info.sessionID !== sessionId) {
        return null;
      }

      const existing = messages.find(
        (item) => item.info.id === event.properties.info.id,
      );

      return upsertMessage(messages, {
        info: event.properties.info,
        parts: existing?.parts ?? [],
      });
    }

    case "message.removed": {
      if (event.properties.sessionID !== sessionId) {
        return null;
      }

      return messages.filter(
        (item) => item.info.id !== event.properties.messageID,
      );
    }

    case "message.part.updated": {
      const { part, delta } = event.properties;
      if (part.sessionID !== sessionId) {
        return null;
      }

      const messageIndex = messages.findIndex(
        (item) => item.info.id === part.messageID,
      );

      if (messageIndex === -1) {
        return messages;
      }

      const target = messages[messageIndex];
      const updated: MessageWithParts = {
        ...target,
        parts: upsertPart(target.parts, part, delta),
      };

      const copy = [...messages];
      copy[messageIndex] = updated;
      return copy;
    }

    case "message.part.removed": {
      if (event.properties.sessionID !== sessionId) {
        return null;
      }

      const messageIndex = messages.findIndex(
        (item) => item.info.id === event.properties.messageID,
      );

      if (messageIndex === -1) {
        return null;
      }

      const target = messages[messageIndex];
      const updated: MessageWithParts = {
        ...target,
        parts: removePart(target.parts, event.properties.partID),
      };

      const copy = [...messages];
      copy[messageIndex] = updated;
      return copy;
    }

    default:
      return null;
  }
}

export function isAgentBusyEvent(
  event: EventSubscribeResponse,
): boolean | null {
  if (event.type === "session.status") {
    return event.properties.status.type === "busy";
  }

  if (event.type === "session.idle") {
    return false;
  }

  if (event.type === "message.part.updated") {
    const part = event.properties.part;
    if (
      part.type === "tool" &&
      "status" in part.state &&
      part.state.status === "running"
    ) {
      return true;
    }
  }

  return null;
}

export function shouldRefetchMessages(event: EventSubscribeResponse): boolean {
  return (
    event.type === "session.compacted" ||
    event.type === "session.diff" ||
    event.type === "command.executed"
  );
}
