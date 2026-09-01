export type CanvasViewport = { x: number; y: number; zoom: number };

type CanvasViewportStorage = Pick<Storage, "getItem" | "setItem">;

export const defaultCanvasViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 };

const canvasViewportStoragePrefix = "raddus-graph:canvas-viewport:";
const minCanvasZoom = 0.35;
const maxCanvasZoom = 2.2;

export function canvasViewportStorageKey(projectId: string): string {
  return `${canvasViewportStoragePrefix}${projectId}`;
}

export function readCanvasViewport(
  projectId: string,
  storage: CanvasViewportStorage | null = browserLocalStorage(),
): CanvasViewport {
  if (!projectId || !storage) return defaultCanvasViewport;
  try {
    const value = storage.getItem(canvasViewportStorageKey(projectId));
    return parseCanvasViewport(value) ?? defaultCanvasViewport;
  } catch {
    return defaultCanvasViewport;
  }
}

export function writeCanvasViewport(
  projectId: string,
  viewport: CanvasViewport,
  storage: CanvasViewportStorage | null = browserLocalStorage(),
): void {
  if (!projectId || !storage) return;
  const value = normalizeCanvasViewport(viewport);
  if (!value) return;
  try {
    storage.setItem(canvasViewportStorageKey(projectId), JSON.stringify(value));
  } catch {
    // Ignore unavailable storage; the viewport still works for the current session.
  }
}

function browserLocalStorage(): CanvasViewportStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function parseCanvasViewport(value: string | null): CanvasViewport | null {
  if (!value) return null;
  try {
    return normalizeCanvasViewport(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeCanvasViewport(value: unknown): CanvasViewport | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CanvasViewport>;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y) || !isFiniteNumber(candidate.zoom)) return null;
  return {
    x: candidate.x,
    y: candidate.y,
    zoom: Math.min(maxCanvasZoom, Math.max(minCanvasZoom, candidate.zoom)),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
