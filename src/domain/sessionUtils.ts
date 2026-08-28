import type { ManagedSession } from "./types";

export function latestSessionsFirst(sessions: ManagedSession[]): ManagedSession[] {
  return [...sessions].sort((a, b) => sessionSortTimestamp(b) - sessionSortTimestamp(a));
}

export function isStoppableSession(session: ManagedSession | null | undefined): session is ManagedSession {
  return session?.status === "running" || session?.status === "rescheduling";
}

function sessionSortTimestamp(session: ManagedSession): number {
  const updatedAt = Date.parse(session.updated_at);
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(session.created_at);
  return Number.isFinite(createdAt) ? createdAt : 0;
}
