import { createServer as createHttpServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, realpath, stat } from "node:fs/promises";

const WEB_DIST = resolve(fileURLToPath(new URL("../web-dist", import.meta.url)));
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function isWithin(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function respond(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(body);
}

export function createServer(root = WEB_DIST) {
  const requestedRoot = resolve(root);
  return createHttpServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      respond(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    } catch {
      respond(res, 400, "Bad request");
      return;
    }

    const relativePath = pathname.replace(/^\/+/, "") || "web.html";
    const filePath = resolve(requestedRoot, relativePath);
    if (!isWithin(requestedRoot, filePath)) {
      respond(res, 404, "Not found");
      return;
    }

    try {
      const [realRoot, realFile] = await Promise.all([
        realpath(requestedRoot),
        realpath(filePath)
      ]);
      if (!isWithin(realRoot, realFile) || !(await stat(realFile)).isFile()) {
        respond(res, 404, "Not found");
        return;
      }

      const body = await readFile(realFile);
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": body.length,
        "Content-Type": CONTENT_TYPES[extname(realFile).toLowerCase()] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      respond(res, 404, "Not found");
    }
  });
}

export function startServer(port = Number(process.env.PORT ?? 4173), root = WEB_DIST) {
  return createServer(root).listen(port, "127.0.0.1");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = startServer();
  server.once("listening", () => {
    console.log(`PromptLab local UI: http://127.0.0.1:${server.address().port}`);
  });
  server.once("error", (error) => {
    console.error(`Could not start the local UI: ${error.message}`);
    process.exitCode = 1;
  });
}
