import { graphDataDir } from "./config.mjs";
import { listBranches, listRepositories } from "./github.mjs";
import { readGraphData, replaceGraphState } from "./graphStore.mjs";
import { appendCallbackStatus, createGraphSession, deleteGraphSession, stopGraphSession } from "./graphRuntime.mjs";
import { modelCatalog } from "./modelCatalog.mjs";
import { commandWorks } from "./processUtils.mjs";
import { HttpError } from "./errors.mjs";
import { asPayload, readJsonBody, sendJson } from "./httpUtils.mjs";

export async function handleGraphApi(req, res, url) {
  const segments = url.pathname.slice("/api/graph".length).split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const [resource, id, child, childId, action] = segments;

  if (resource === "state" && req.method === "GET" && segments.length === 1) {
    sendJson(res, 200, { ...(await readGraphData()), dataDir: graphDataDir });
    return;
  }

  if (resource === "state" && req.method === "PUT" && segments.length === 1) {
    const body = asPayload(await readJsonBody(req));
    sendJson(res, 200, { ...(await replaceGraphState(body)), dataDir: graphDataDir });
    return;
  }

  if (resource === "models" && req.method === "GET" && segments.length === 1) {
    sendJson(res, 200, { models: modelCatalog });
    return;
  }

  if (resource === "cli-status" && req.method === "GET" && segments.length === 1) {
    const [codexAvailable, claudeAvailable] = await Promise.all([
      commandWorks("codex", ["--version"], { timeoutMs: 5_000 }),
      commandWorks("claude", ["--version"], { timeoutMs: 5_000 }),
    ]);
    sendJson(res, 200, {
      checkedAt: new Date().toISOString(),
      agents: [
        { id: "codex", label: "Codex", command: "codex", available: codexAvailable },
        { id: "claude", label: "Claude", command: "claude", available: claudeAvailable },
      ],
    });
    return;
  }

  if (resource === "repositories" && req.method === "GET" && segments.length === 1) {
    sendJson(res, 200, await listRepositories());
    return;
  }

  if (resource === "branches" && req.method === "GET" && segments.length === 1) {
    const repo = url.searchParams.get("repo")?.trim();
    if (!repo) throw new HttpError(400, "Missing repo query parameter.");
    sendJson(res, 200, await listBranches(repo));
    return;
  }

  if (resource === "sessions" && req.method === "GET" && segments.length === 1) {
    sendJson(res, 200, { sessions: (await readGraphData()).sessions });
    return;
  }

  if (resource === "sessions" && req.method === "POST" && segments.length === 1) {
    try {
      const body = asPayload(await readJsonBody(req));
      sendJson(res, 201, { session: await createGraphSession(body) });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (resource === "sessions" && id && req.method === "DELETE" && segments.length === 2) {
    const result = await deleteGraphSession(id);
    if (!result) throw new HttpError(404, "Graph session not found.");
    sendJson(res, 200, { removedSessionId: id, sessions: result.sessions });
    return;
  }

  if (resource === "sessions" && id && child === "stop" && req.method === "POST" && segments.length === 3) {
    const session = await stopGraphSession(id);
    if (!session) throw new HttpError(404, "Graph session not found.");
    sendJson(res, 200, { session });
    return;
  }

  if (resource === "sessions" && id && child === "agent-sessions" && childId && action === "status" && req.method === "POST" && segments.length === 5) {
    const body = asPayload(await readJsonBody(req));
    const result = await appendCallbackStatus(id, childId, body);
    if (!result.session || !result.status) throw new HttpError(404, "Agent session not found.");
    sendJson(res, 200, result);
    return;
  }

  throw new HttpError(404, `Unknown Raddus Graph endpoint: ${req.method} /${segments.join("/")}`);
}
