import { createServer } from "node:http";
import { handleAnthropic } from "./anthropicProxy.mjs";
import { authPayload, ensureSession, handleLogin, handleLogout } from "./auth.mjs";
import { bareAnthropicRoutes, bareLocalRoutes, host } from "./config.mjs";
import { HttpError } from "./errors.mjs";
import { sendError, sendJson } from "./httpUtils.mjs";
import { handleLocalStore } from "./localStore.mjs";
import { assertLocalRequest } from "./security.mjs";
import { serveStatic } from "./staticAssets.mjs";

export async function createRaddusHttpServer({ isDev = false, defaultPort = 5174 } = {}) {
  let vite = null;
  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      appType: "spa",
      server: {
        hmr: { host, protocol: "ws" },
        middlewareMode: true,
      },
    });
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${defaultPort}`}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      if (isBareAnthropicRoute(url.pathname)) {
        assertLocalRequest(req);
        const proxyUrl = new URL(`/api/anthropic${url.pathname}${url.search}`, url);
        await handleAnthropic(req, res, proxyUrl);
        return;
      }
      if (isBareLocalRoute(url.pathname)) {
        assertLocalRequest(req);
        throw new HttpError(410, "This endpoint is handled in the local browser store. Use the Raddus Canvas frontend or /api/anthropic/* for Anthropic proxy calls.");
      }
      if (vite) {
        vite.middlewares(req, res, (error) => {
          if (error) sendError(res, error);
        });
        return;
      }
      await serveStatic(req, res, url);
    } catch (error) {
      sendError(res, error);
    }
  });
}

export function listenOnAvailablePort(targetServer, startPort) {
  return new Promise((resolveListen, rejectListen) => {
    const tryPort = (candidatePort) => {
      const onError = (error) => {
        targetServer.off("listening", onListening);
        if (error?.code === "EADDRINUSE" && candidatePort < startPort + 20) {
          tryPort(candidatePort + 1);
        } else {
          rejectListen(error);
        }
      };
      const onListening = () => {
        targetServer.off("error", onError);
        resolveListen(candidatePort);
      };
      targetServer.once("error", onError);
      targetServer.once("listening", onListening);
      targetServer.listen(candidatePort, host);
    };
    tryPort(startPort);
  });
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  assertLocalRequest(req);
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    await handleLogin(req, res);
    return;
  }
  if (url.pathname === "/api/auth/session" && req.method === "GET") {
    const session = await ensureSession(req, res);
    sendJson(res, 200, authPayload(session));
    return;
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    await handleLogout(req, res);
    return;
  }
  if (url.pathname.startsWith("/api/local-store/")) {
    const session = await ensureSession(req, res);
    await handleLocalStore(req, res, url, session);
    return;
  }
  if (url.pathname.startsWith("/api/anthropic/")) {
    await handleAnthropic(req, res, url);
    return;
  }
  throw new HttpError(404, "Unknown local API endpoint.");
}

function isBareAnthropicRoute(pathname) {
  const [root] = pathname.split("/").filter(Boolean);
  return Boolean(root && bareAnthropicRoutes.has(root));
}

function isBareLocalRoute(pathname) {
  const [root] = pathname.split("/").filter(Boolean);
  return Boolean(root && bareLocalRoutes.has(root));
}
