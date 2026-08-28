import type { ChatMessage } from "./types";

export interface ParsedSessionStatusUpdate {
  id: string;
  title: string;
  agent: string;
  message: string;
  status: "failed" | "completed" | "waiting-for-answer" | "running";
  link?: string;
}

export type ConnectionStatus = ParsedSessionStatusUpdate["status"] | "idle";

export function parseSessionMessageStatusUpdates(messages: ChatMessage[]): ParsedSessionStatusUpdate[] {
  return messages.flatMap((sessionMessage) => {
    if (sessionMessage.role !== "assistant") return [];
    const updateStart = sessionMessage.content.lastIndexOf("### UPDATE");
    if (updateStart < 0) return [];

    const update = sessionMessage.content
      .slice(updateStart)
      .trim()
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n");
    const match = /^### UPDATE\s*\nTITLE=([^\n]*)\nMESSAGE=([\s\S]*?)\nAGENT=([^\n]+)\nSTATUS=(failed|completed|waiting-for-answer|running)(?:\nLINK=([^\n]*))?\s*$/.exec(update);
    if (!match) return [];

    const rawLink = match[5]?.trim();
    return [{
      id: sessionMessage.id,
      title: match[1].trim(),
      message: match[2].trim(),
      agent: match[3].trim(),
      status: match[4] as ParsedSessionStatusUpdate["status"],
      ...(rawLink && isPublicHttpUrl(rawLink) ? { link: rawLink } : {}),
    }];
  });
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
