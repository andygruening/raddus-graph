import { createReadStream, existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { distDir } from "./config.mjs";
import { HttpError } from "./errors.mjs";

export async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed.");
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  let filePath = resolve(distDir, requested);
  if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) throw new HttpError(403, "Forbidden.");
  if (!existsSync(filePath)) filePath = resolve(distDir, "index.html");
  const contentType = contentTypeFor(filePath);
  res.writeHead(200, { "content-type": contentType });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function contentTypeFor(filePath) {
  switch (extname(filePath)) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".png": return "image/png";
    case ".svg": return "image/svg+xml";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}
