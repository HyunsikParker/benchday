import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.BENCHDAY_PORT || 4177);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("BENCHDAY_PORT must be between 1024 and 65535.");
const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};
const allowed = new Set([
  "/index.html",
  "/styles.css",
  "/src/app.mjs",
  "/src/model.mjs",
  "/src/dispatch.mjs",
  "/src/storage.mjs",
  "/sw.js",
  "/manifest.webmanifest",
  "/demo.html",
  "/media/benchday-demo.mp4",
  "/media/benchday-demo.vtt",
  "/media/DEMO_TRANSCRIPT.md",
  "/screenshots/01-live-board.png",
]);
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Read-only server");
    return;
  }
  try {
    let path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/") path = "/index.html";
    if (!allowed.has(path)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const full = resolve(root, "." + path);
    if (!full.startsWith(root.endsWith(sep) ? root : root + sep))
      throw new Error("Invalid path");
    const data = await readFile(full);
    res.writeHead(200, {
      "Content-Type": types[extname(full)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Content-Length": data.length,
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`BenchDay: http://127.0.0.1:${port}`),
);
