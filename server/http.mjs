import { createServer } from "node:http";
import { host, removedCanvasRoutes, removedProviderRoutes } from "./config.mjs";
import { HttpError } from "./errors.mjs";
import { handleGraphApi } from "./graphApi.mjs";
import { sendError, sendJson } from "./httpUtils.mjs";
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
      if (isRemovedProviderRoute(url.pathname)) {
        assertLocalRequest(req);
        throw new HttpError(410, "Raddus Graph no longer proxies Anthropic SDK routes. Use /api/graph/*.");
        return;
      }
      if (isRemovedCanvasRoute(url.pathname)) {
        assertLocalRequest(req);
        throw new HttpError(410, "This Raddus Canvas endpoint was removed. Use the Raddus Graph frontend or /api/graph/*.");
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
  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true, name: "Raddus Graph" });
    return;
  }
  if (url.pathname.startsWith("/api/graph/")) {
    await handleGraphApi(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/anthropic/") || url.pathname.startsWith("/api/local-store/")) {
    throw new HttpError(410, "This Raddus Canvas API was removed during the Raddus Graph migration.");
  }
  throw new HttpError(404, "Unknown Raddus Graph API endpoint.");
}

function isRemovedProviderRoute(pathname) {
  const [root] = pathname.split("/").filter(Boolean);
  return Boolean(root && removedProviderRoutes.has(root));
}

function isRemovedCanvasRoute(pathname) {
  const [root] = pathname.split("/").filter(Boolean);
  return Boolean(root && removedCanvasRoutes.has(root));
}
