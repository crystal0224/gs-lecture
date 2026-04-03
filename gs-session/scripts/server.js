#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.resolve(ROOT, "dist");
const SLIDES = path.resolve(ROOT, "slides");
const PORT = process.env.PORT || 3000;
const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB

function getSlideFiles() {
  return fs
    .readdirSync(SLIDES)
    .filter((f) => f.startsWith("slide-") && f.endsWith(".html"))
    .sort();
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  // CORS — restrict to localhost only
  const origin = req.headers.origin;
  if (origin === `http://localhost:${PORT}`) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Save API
  if (req.method === "POST" && req.url === "/api/save-slide") {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Request body too large (1MB limit)" }),
        );
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { slideIndex, html } = JSON.parse(body);
        const files = getSlideFiles();
        if (slideIndex < 0 || slideIndex >= files.length) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid slide index" }));
          return;
        }
        const filePath = path.join(SLIDES, files[slideIndex]);
        fs.writeFileSync(filePath, html, "utf8");

        // Auto rebuild
        execSync("node scripts/build.js", {
          cwd: ROOT,
          stdio: "pipe",
          timeout: 10000,
        });

        console.log(`  Saved: ${files[slideIndex]}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, file: files[slideIndex] }));
      } catch (err) {
        console.error("Save error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Build API
  if (req.method === "POST" && req.url === "/api/build") {
    try {
      execSync("node scripts/build.js", {
        cwd: ROOT,
        stdio: "pipe",
        timeout: 10000,
      });
      console.log("  Build completed");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error("Build error:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static file serving
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/lecture.html";

  // Try dist/ first, then project root (for assets/)
  let filePath = path.resolve(DIST, urlPath.replace(/^\//, ""));
  if (!fs.existsSync(filePath)) {
    filePath = path.resolve(ROOT, urlPath.replace(/^\//, ""));
  }

  // Path traversal protection — must stay within DIST or ROOT
  if (!filePath.startsWith(DIST) && !filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Editor server running at http://localhost:${PORT}`);
  console.log("  Changes saved in edit mode will sync to source files.\n");
});
