import { defaultPort, host } from "./config.mjs";
import { initializeGraphStore } from "./graphStore.mjs";
import { setGraphServerOrigin } from "./graphRuntime.mjs";
import { createRaddusHttpServer, listenOnAvailablePort } from "./http.mjs";

export async function startServer({ isDev = false, port = defaultPort } = {}) {
  const startPort = Number.isFinite(port) ? port : 5174;
  await initializeGraphStore();
  const server = await createRaddusHttpServer({ isDev, defaultPort: startPort });
  const listeningPort = await listenOnAvailablePort(server, startPort);
  const url = `http://${host}:${listeningPort}`;
  setGraphServerOrigin(url);

  console.log(`Raddus Graph listening at ${url}`);

  return {
    server,
    port: listeningPort,
    url,
    stop: () => new Promise((resolveStop, rejectStop) => {
      server.close((error) => {
        if (error) rejectStop(error);
        else resolveStop();
      });
    }),
  };
}
