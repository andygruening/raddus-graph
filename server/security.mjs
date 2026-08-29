import { HttpError } from "./errors.mjs";

export function assertLocalRequest(req) {
  const hostHeader = String(req.headers.host ?? "");
  const hostName = hostHeader.split(":")[0]?.toLowerCase();
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostName)) {
    throw new HttpError(403, "Raddus Graph only accepts loopback requests.");
  }
  const origin = req.headers.origin;
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(String(origin)).host;
    } catch {
      throw new HttpError(403, "Invalid request origin.");
    }
    if (originHost !== hostHeader) {
      throw new HttpError(403, "Raddus Graph only accepts same-origin requests.");
    }
  }
}
