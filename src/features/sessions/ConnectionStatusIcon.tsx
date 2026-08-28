import { Check, Clock3, Loader2, Pause, X } from "lucide-react";
import type { ConnectionStatus } from "../../domain/sessionStatus";

export function ConnectionStatusIcon({ status }: { status: ConnectionStatus }) {
  const Icon = status === "completed"
    ? Check
    : status === "failed"
      ? X
      : status === "waiting-for-answer"
        ? Clock3
        : status === "running"
          ? Loader2
          : Pause;
  return <Icon className={status === "running" ? "spin" : undefined} x="-7" y="-7" width="14" height="14" strokeWidth={2.75} aria-hidden="true" />;
}
