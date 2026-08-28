import { ensureSession } from "./auth.mjs";
import { collect, createAnthropicClient } from "./anthropicClient.mjs";
import { HttpError } from "./errors.mjs";
import { asPayload, readJsonBody, sendJson } from "./httpUtils.mjs";

export async function handleAnthropic(req, res, url) {
  const session = await ensureSession(req, res);
  const client = createAnthropicClient(session.apiKey);
  const path = url.pathname.slice("/api/anthropic".length);
  const segments = path.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readJsonBody(req);
  const result = await routeAnthropicRequest(client, req.method ?? "GET", segments, body);
  sendJson(res, 200, result);
}

async function routeAnthropicRequest(client, method, segments, body) {
  const [resource, id, child, childId] = segments;
  if (resource === "agents") {
    if (method === "GET" && segments.length === 1) return collect(client.beta.agents.list({ limit: 100 }));
    if (method === "POST" && segments.length === 1) return client.beta.agents.create(asPayload(body));
    if (method === "PATCH" && id && segments.length === 2) return client.beta.agents.update(id, asPayload(body));
    if (method === "POST" && id && child === "archive" && segments.length === 3) return client.beta.agents.archive(id);
  }
  if (resource === "environments") {
    if (method === "GET" && segments.length === 1) return collect(client.beta.environments.list({ limit: 100 }));
    if (method === "POST" && segments.length === 1) return client.beta.environments.create(asPayload(body));
    if (method === "PATCH" && id && segments.length === 2) return client.beta.environments.update(id, asPayload(body));
    if (method === "DELETE" && id && segments.length === 2) return client.beta.environments.delete(id);
  }
  if (resource === "deployments") {
    if (method === "GET" && segments.length === 1) return collect(client.beta.deployments.list({ limit: 100 }));
    if (method === "POST" && segments.length === 1) return client.beta.deployments.create(asPayload(body));
    if (method === "POST" && id && child === "run" && segments.length === 3) return client.beta.deployments.run(id);
    if (method === "DELETE" && id && segments.length === 2) return client.beta.deployments.archive(id);
  }
  if (resource === "sessions") {
    if (method === "GET" && segments.length === 1) return collect(client.beta.sessions.list({ limit: 100 }));
    if (method === "POST" && segments.length === 1) return client.beta.sessions.create(asPayload(body));
    if (method === "DELETE" && id && segments.length === 2) return client.beta.sessions.delete(id);
    if (method === "GET" && id && child === "events" && segments.length === 3) return collect(client.beta.sessions.events.list(id, { limit: 100, order: "asc" }));
    if (method === "POST" && id && child === "events" && segments.length === 3) return client.beta.sessions.events.send(id, asPayload(body));
    if (method === "POST" && id && child === "interrupt" && segments.length === 3) return client.beta.sessions.events.send(id, { events: [{ type: "user.interrupt" }] });
  }
  if (resource === "vaults") {
    if (method === "GET" && segments.length === 1) return collect(client.beta.vaults.list({ limit: 100 }));
    if (method === "POST" && segments.length === 1) return client.beta.vaults.create(asPayload(body));
    if (method === "DELETE" && id && segments.length === 2) return client.beta.vaults.delete(id);
    if (method === "GET" && id && child === "credentials" && segments.length === 3) return collect(client.beta.vaults.credentials.list(id, { limit: 100 }));
    if (method === "POST" && id && child === "credentials" && segments.length === 3) return client.beta.vaults.credentials.create(id, asPayload(body));
    if (method === "DELETE" && id && child === "credentials" && childId && segments.length === 4) return client.beta.vaults.credentials.delete(childId, { vault_id: id });
  }
  if (resource === "skills") {
    if (method === "GET" && segments.length === 1) return collect(client.beta.skills.list({ limit: 100 }));
  }
  if (resource === "messages") {
    if (method === "POST" && segments.length === 1) return client.messages.create(asPayload(body));
  }
  throw new HttpError(404, `Local Anthropic proxy does not implement ${method} /${segments.join("/")}`);
}
