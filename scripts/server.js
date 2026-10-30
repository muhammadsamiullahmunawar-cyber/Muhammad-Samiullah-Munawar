import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";

// Find project root and .output directory
function resolveOutputDir() {
  const candidates = [
    path.resolve(process.cwd(), ".output"),
    path.resolve(__dirname, "../../.output"),
    path.resolve(__dirname, "../.output"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

const outputDir = resolveOutputDir();
const publicDir = path.join(outputDir, "public");
const serverEntryPath = path.join(outputDir, "server", "index.mjs");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

let nitroHandler = null;
async function getNitroHandler() {
  if (nitroHandler) return nitroHandler;
  if (!fs.existsSync(serverEntryPath)) {
    throw new Error(`Server entry file not found at ${serverEntryPath}`);
  }
  const mod = await import(serverEntryPath);
  nitroHandler = mod.default?.fetch || mod.fetch;
  if (typeof nitroHandler !== "function") {
    throw new Error(`Server entry at ${serverEntryPath} does not export a fetch function`);
  }
  return nitroHandler;
}

const server = http.createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host || "localhost";
    const parsedUrl = new URL(req.url || "/", `http://${hostHeader}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    // 1. Try serving static file from public dir
    const safeFilePath = path.normalize(path.join(publicDir, pathname));
    if (safeFilePath.startsWith(publicDir) && fs.existsSync(safeFilePath)) {
      const stats = fs.statSync(safeFilePath);
      if (stats.isFile()) {
        const ext = path.extname(safeFilePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", stats.size);
        if (pathname.startsWith("/assets/")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
        return fs.createReadStream(safeFilePath).pipe(res);
      }
    }

    // 2. Delegate to TanStack Start Nitro SSR handler
    const handler = await getNitroHandler();
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const webReq = new Request(parsedUrl.href, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: "half",
    });

    const webRes = await handler(webReq, {}, { waitUntil: () => {} });

    res.statusCode = webRes.status;
    for (const [key, value] of webRes.headers.entries()) {
      res.setHeader(key, value);
    }

    if (webRes.body) {
      Readable.fromWeb(webRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Production Server Error]:", message);

    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Application Error</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center;background:#090d16;color:#fff;">
  <h2>Application temporary unavailable</h2>
  <p style="color:#94a3b8;">Please refresh the page or try again in a few moments.</p>
</body>
</html>`);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[production-server] Listening on http://${HOST}:${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("[production-server] Received SIGTERM, gracefully closing server");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("[production-server] Received SIGINT, gracefully closing server");
  server.close(() => process.exit(0));
});
