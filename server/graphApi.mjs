import { graphDataDir } from "./config.mjs";
import { listBranches, listRepositories } from "./github.mjs";
import { readGraphData, replaceGraphState } from "./graphStore.mjs";
import { appendCallbackStatus, createGraphSession, stopGraphSession } from "./graphRuntime.mjs";
import { modelCatalog } from "./modelCatalog.mjs";
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

  if (resource === "sessions" && id && child === "stop" && req.method === "POST" && segments.length === 3) {
    const session = await stopGraphSession(id);
    if (!session) throw new HttpError(404, "Graph session not found.");
    sendJson(res, 200, { session });
    return;
  }

  if (resource === "sessions" && id && child === "nodes" && childId && action === "status" && req.method === "POST" && segments.length === 5) {
    const body = asPayload(await readJsonBody(req));
    const result = await appendCallbackStatus(id, childId, body);
    if (!result.session) throw new HttpError(404, "Graph session not found.");
    sendJson(res, 200, result);
    return;
  }

  throw new HttpError(404, `Unknown Raddus Graph endpoint: ${req.method} /${segments.join("/")}`);
}
