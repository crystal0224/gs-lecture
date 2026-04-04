#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.resolve(ROOT, "dist");
const SLIDES = path.resolve(ROOT, "slides");
const ASSETS = path.resolve(ROOT, "assets");
const PORT = process.env.PORT || 3000;
const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB for JSON endpoints
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB for image uploads

const ALLOWED_IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
]);

// Ensure assets directory exists
if (!fs.existsSync(ASSETS)) {
  fs.mkdirSync(ASSETS, { recursive: true });
}

function getSlideFiles() {
  return fs
    .readdirSync(SLIDES)
    .filter((f) => f.startsWith("slide-") && f.endsWith(".html"))
    .sort();
}

function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = bufferIndexOf(buffer, boundaryBuf, 0);

  if (start === -1) return parts;

  while (true) {
    start += boundaryBuf.length;

    // Check for closing boundary (--boundary--)
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;

    // Skip \r\n after boundary
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) {
      start += 2;
    }

    // Find end of headers (double CRLF)
    const headerEnd = bufferIndexOf(buffer, Buffer.from("\r\n\r\n"), start);
    if (headerEnd === -1) break;

    const headerText = buffer.slice(start, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;

    // Find next boundary
    const nextBoundary = bufferIndexOf(buffer, boundaryBuf, bodyStart);
    if (nextBoundary === -1) break;

    // Body ends 2 bytes before next boundary (the \r\n before boundary)
    const bodyEnd = nextBoundary - 2;
    const body = buffer.slice(bodyStart, bodyEnd);

    // Parse headers
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > -1) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const val = line.slice(colonIdx + 1).trim();
        headers[key] = val;
      }
    }

    // Parse Content-Disposition
    const disposition = headers["content-disposition"] || "";
    const nameMatch = disposition.match(/name="([^"]+)"/);
    const filenameMatch = disposition.match(/filename="([^"]+)"/);

    parts.push({
      name: nameMatch ? nameMatch[1] : null,
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: headers["content-type"] || null,
      data: body,
    });

    start = nextBoundary - boundaryBuf.length;
  }

  return parts;
}

function bufferIndexOf(buf, search, fromIndex) {
  if (fromIndex >= buf.length) return -1;
  return buf.indexOf(search, fromIndex);
}

function buildImageTag(filename, position) {
  const src = `../assets/${filename}`;

  switch (position) {
    case "background":
      return `<img src="${src}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.3;">`;

    case "center":
      return `<img src="${src}" style="max-width:80%;max-height:60%;border-radius:var(--radius);object-fit:cover;position:relative;z-index:1;margin:16px auto;">`;

    case "left":
      return `<img src="${src}" style="max-width:40%;max-height:60%;border-radius:var(--radius);object-fit:cover;float:left;margin:0 24px 16px 0;position:relative;z-index:1;">`;

    case "right":
      return `<img src="${src}" style="max-width:40%;max-height:60%;border-radius:var(--radius);object-fit:cover;float:right;margin:0 0 16px 24px;position:relative;z-index:1;">`;

    default:
      return `<img src="${src}" style="max-width:80%;max-height:60%;border-radius:var(--radius);object-fit:cover;position:relative;z-index:1;margin:16px auto;">`;
  }
}

function insertImageIntoSlide(html, filename, position) {
  const imgTag = buildImageTag(filename, position);

  if (position === "background") {
    // Insert right after the opening <section ...> tag
    return html.replace(/(<section[^>]*>)/, `$1\n  ${imgTag}`);
  }

  if (position === "left" || position === "right") {
    // Wrap existing content in a flex container with the image
    const sectionMatch = html.match(/(<section[^>]*>)([\s\S]*?)(<\/section>)/);
    if (sectionMatch) {
      const opening = sectionMatch[1];
      const content = sectionMatch[2];
      const closing = sectionMatch[3];

      const flexDir = position === "left" ? "row" : "row-reverse";
      const wrappedContent = `\n  <div style="display:flex;flex-direction:${flexDir};align-items:center;gap:24px;width:100%;position:relative;z-index:1;">\n    ${imgTag}\n    <div style="flex:1;">${content}\n    </div>\n  </div>\n`;

      return `${opening}${wrappedContent}${closing}`;
    }
  }

  // "center" — insert before closing </section>
  return html.replace(
    /(<\/section>)/,
    `  ${imgTag}\n$1`,
  );
}

function rebuildProject() {
  // Safe: hardcoded command, no user input interpolation
  execSync("node scripts/build.js", {
    cwd: ROOT,
    stdio: "pipe",
    timeout: 10000,
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ---------- Editor UI injection ----------

const EDITOR_UI_HTML = `
<!-- Image Upload Editor UI (injected by server) -->
<style>
  #img-upload-btn{position:fixed;bottom:24px;right:24px;z-index:99999;width:52px;height:52px;border-radius:50%;background:#1a1a2e;border:2px solid rgba(212,165,116,.5);color:#d4a574;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.5);transition:all .2s;}
  #img-upload-btn:hover{background:#2a2a3e;transform:scale(1.1);}
  #img-modal-overlay{display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);align-items:center;justify-content:center;}
  #img-modal-overlay.active{display:flex;}
  #img-modal{background:#1a1a2e;border:1px solid rgba(212,165,116,.3);border-radius:12px;padding:28px;width:420px;max-width:90vw;max-height:85vh;overflow-y:auto;color:#e0e0e0;font-family:system-ui,sans-serif;}
  #img-modal h3{margin:0 0 18px;color:#d4a574;font-size:18px;}
  #img-modal label{display:block;font-size:13px;color:#999;margin:12px 0 4px;}
  #img-modal select,#img-modal input[type=number]{width:100%;padding:8px 10px;background:#111;border:1px solid #333;border-radius:6px;color:#e0e0e0;font-size:14px;box-sizing:border-box;}
  #img-modal .file-drop{border:2px dashed rgba(212,165,116,.4);border-radius:8px;padding:24px;text-align:center;cursor:pointer;margin:8px 0;transition:all .2s;color:#888;font-size:13px;}
  #img-modal .file-drop:hover,.file-drop.dragover{border-color:#d4a574;background:rgba(212,165,116,.08);color:#d4a574;}
  #img-modal .file-drop input{display:none;}
  #img-modal .btn-row{display:flex;gap:8px;margin-top:18px;}
  #img-modal button{padding:8px 18px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;}
  #img-modal .btn-upload{background:#d4a574;color:#111;flex:1;}
  #img-modal .btn-upload:hover{background:#e0b584;}
  #img-modal .btn-upload:disabled{opacity:.4;cursor:not-allowed;}
  #img-modal .btn-cancel{background:#333;color:#ccc;}
  #img-modal .btn-cancel:hover{background:#444;}
  #img-modal .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px;margin-top:10px;}
  #img-modal .gallery-item{aspect-ratio:1;border-radius:6px;overflow:hidden;border:1px solid #333;cursor:pointer;transition:all .15s;position:relative;}
  #img-modal .gallery-item:hover{border-color:#d4a574;transform:scale(1.05);}
  #img-modal .gallery-item img{width:100%;height:100%;object-fit:cover;}
  #img-modal .gallery-item span{position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.7);color:#ccc;font-size:9px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  #img-modal .status{font-size:12px;margin-top:8px;min-height:16px;}
  #img-modal .status.ok{color:#4dc9c4;}
  #img-modal .status.err{color:#e74c3c;}
  #drag-overlay{display:none;position:fixed;inset:0;z-index:200000;background:rgba(26,26,46,.92);align-items:center;justify-content:center;pointer-events:none;}
  #drag-overlay.active{display:flex;pointer-events:auto;}
  #drag-overlay .inner{border:3px dashed #d4a574;border-radius:16px;padding:60px 80px;text-align:center;color:#d4a574;font-size:22px;font-weight:700;font-family:system-ui,sans-serif;}
</style>

<button id="img-upload-btn" title="Upload image">IMG</button>

<div id="img-modal-overlay">
  <div id="img-modal">
    <h3>Insert Image</h3>

    <label>Image file</label>
    <div class="file-drop" id="img-file-drop">
      <span id="img-file-label">Click or drag an image here</span>
      <input type="file" id="img-file-input" accept="image/*">
    </div>

    <label>Slide number</label>
    <input type="number" id="img-slide-idx" min="1" value="1">

    <label>Position</label>
    <select id="img-position">
      <option value="center">Center</option>
      <option value="background">Background (overlay)</option>
      <option value="left">Left</option>
      <option value="right">Right</option>
    </select>

    <div class="btn-row">
      <button class="btn-upload" id="img-do-upload" disabled>Upload &amp; Insert</button>
      <button class="btn-cancel" id="img-cancel">Close</button>
    </div>
    <div class="status" id="img-status"></div>

    <label style="margin-top:18px;">Gallery (assets/)</label>
    <div class="gallery" id="img-gallery"></div>
  </div>
</div>

<div id="drag-overlay">
  <div class="inner">Drop image here</div>
</div>

<script>
(function(){
  var btn = document.getElementById('img-upload-btn');
  var overlay = document.getElementById('img-modal-overlay');
  var fileInput = document.getElementById('img-file-input');
  var fileDrop = document.getElementById('img-file-drop');
  var fileLabel = document.getElementById('img-file-label');
  var slideIdx = document.getElementById('img-slide-idx');
  var position = document.getElementById('img-position');
  var uploadBtn = document.getElementById('img-do-upload');
  var cancelBtn = document.getElementById('img-cancel');
  var status = document.getElementById('img-status');
  var gallery = document.getElementById('img-gallery');
  var dragOverlay = document.getElementById('drag-overlay');

  var selectedFile = null;

  function getCurrentSlide() {
    var el = document.querySelector('.slide.active, section.active, [class*="current"]');
    if (el) {
      var slides = document.querySelectorAll('section.slide, section[class*="slide"]');
      for (var i = 0; i < slides.length; i++) {
        if (slides[i] === el) return i + 1;
      }
    }
    if (typeof Reveal !== 'undefined' && Reveal.getIndices) {
      return Reveal.getIndices().h + 1;
    }
    return 1;
  }

  function openModal() {
    slideIdx.value = getCurrentSlide();
    overlay.classList.add('active');
    loadGallery();
  }

  function closeModal() {
    overlay.classList.remove('active');
    selectedFile = null;
    fileLabel.textContent = 'Click or drag an image here';
    uploadBtn.disabled = true;
    status.textContent = '';
    status.className = 'status';
  }

  btn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });

  fileDrop.addEventListener('click', function() { fileInput.click(); });
  fileInput.addEventListener('change', function() {
    if (fileInput.files.length > 0) {
      selectedFile = fileInput.files[0];
      fileLabel.textContent = selectedFile.name;
      uploadBtn.disabled = false;
    }
  });

  fileDrop.addEventListener('dragover', function(e) {
    e.preventDefault(); fileDrop.classList.add('dragover');
  });
  fileDrop.addEventListener('dragleave', function() {
    fileDrop.classList.remove('dragover');
  });
  fileDrop.addEventListener('drop', function(e) {
    e.preventDefault(); fileDrop.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      selectedFile = e.dataTransfer.files[0];
      fileLabel.textContent = selectedFile.name;
      uploadBtn.disabled = false;
    }
  });

  uploadBtn.addEventListener('click', function() {
    if (!selectedFile) return;
    doUpload(selectedFile, parseInt(slideIdx.value, 10) - 1, position.value);
  });

  function doUpload(file, idx, pos) {
    status.textContent = 'Uploading...';
    status.className = 'status';
    uploadBtn.disabled = true;

    var fd = new FormData();
    fd.append('image', file);
    fd.append('slideIndex', idx);
    fd.append('position', pos);

    fetch('/api/upload-image', { method: 'POST', body: fd })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          status.textContent = 'Inserted ' + data.file + ' into slide.';
          status.className = 'status ok';
          loadGallery();
          setTimeout(function() { location.reload(); }, 800);
        } else {
          status.textContent = data.error || 'Upload failed';
          status.className = 'status err';
          uploadBtn.disabled = false;
        }
      })
      .catch(function(err) {
        status.textContent = err.message;
        status.className = 'status err';
        uploadBtn.disabled = false;
      });
  }

  function loadGallery() {
    fetch('/api/images')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        gallery.innerHTML = '';
        (data.images || []).forEach(function(name) {
          var item = document.createElement('div');
          item.className = 'gallery-item';
          item.title = name;
          item.innerHTML = '<img src="/assets/' + name + '" alt="' + name + '"><span>' + name + '</span>';
          item.addEventListener('click', function() {
            selectedFile = null;
            var idx = parseInt(slideIdx.value, 10) - 1;
            var pos = position.value;
            status.textContent = 'Inserting ' + name + '...';
            status.className = 'status';
            fetch('/api/upload-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ existingImage: name, slideIndex: idx, position: pos })
            })
            .then(function(r) { return r.json(); })
            .then(function(d) {
              if (d.ok) {
                status.textContent = 'Inserted ' + d.file;
                status.className = 'status ok';
                setTimeout(function() { location.reload(); }, 800);
              } else {
                status.textContent = d.error || 'Failed';
                status.className = 'status err';
              }
            })
            .catch(function(err) {
              status.textContent = err.message;
              status.className = 'status err';
            });
          });
          gallery.appendChild(item);
        });
      })
      .catch(function() {});
  }

  var dragCounter = 0;
  document.addEventListener('dragenter', function(e) {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') > -1) {
      dragOverlay.classList.add('active');
    }
  });
  document.addEventListener('dragleave', function(e) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dragOverlay.classList.remove('active');
    }
  });
  document.addEventListener('dragover', function(e) {
    e.preventDefault();
  });
  document.addEventListener('drop', function(e) {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.classList.remove('active');

    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      var file = e.dataTransfer.files[0];
      if (file.type && file.type.startsWith('image/')) {
        var idx = getCurrentSlide() - 1;
        if (overlay.classList.contains('active')) {
          idx = parseInt(slideIdx.value, 10) - 1;
          doUpload(file, idx, position.value);
        } else {
          doUpload(file, idx, 'center');
        }
      }
    }
  });
})();
</script>
`;

// ---------- MIME types ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

// ---------- Request handler ----------

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

  // ── POST /api/save-slide ──
  if (req.method === "POST" && req.url === "/api/save-slide") {
    collectBody(req, MAX_BODY_SIZE, (err, body) => {
      if (err) return sendJSON(res, 413, { error: err.message });
      try {
        const { slideIndex, html } = JSON.parse(body.toString("utf8"));
        const files = getSlideFiles();
        if (slideIndex < 0 || slideIndex >= files.length) {
          return sendJSON(res, 400, { error: "Invalid slide index" });
        }
        const filePath = path.join(SLIDES, files[slideIndex]);
        fs.writeFileSync(filePath, html, "utf8");
        rebuildProject();
        console.log(`  Saved: ${files[slideIndex]}`);
        sendJSON(res, 200, { ok: true, file: files[slideIndex] });
      } catch (e) {
        console.error("Save error:", e.message);
        sendJSON(res, 500, { error: e.message });
      }
    });
    return;
  }

  // ── POST /api/build ──
  if (req.method === "POST" && req.url === "/api/build") {
    try {
      rebuildProject();
      console.log("  Build completed");
      sendJSON(res, 200, { ok: true });
    } catch (e) {
      console.error("Build error:", e.message);
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /api/upload-image ──
  if (req.method === "POST" && req.url === "/api/upload-image") {
    const contentType = req.headers["content-type"] || "";

    // Handle JSON requests (gallery insert of existing image)
    if (contentType.includes("application/json")) {
      collectBody(req, MAX_BODY_SIZE, (err, body) => {
        if (err) return sendJSON(res, 413, { error: err.message });
        try {
          const { existingImage, slideIndex, position: pos } = JSON.parse(
            body.toString("utf8"),
          );
          return handleImageInsert(
            res,
            existingImage,
            slideIndex,
            pos || "center",
          );
        } catch (e) {
          console.error("Image insert error:", e.message);
          sendJSON(res, 500, { error: e.message });
        }
      });
      return;
    }

    // Handle multipart form data (new image upload)
    const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/);
    if (!boundaryMatch) {
      return sendJSON(res, 400, { error: "Missing multipart boundary" });
    }
    const boundary = boundaryMatch[1].trim();

    collectBody(req, MAX_IMAGE_SIZE, (err, body) => {
      if (err) return sendJSON(res, 413, { error: err.message });
      try {
        const parts = parseMultipart(body, boundary);

        let imagePart = null;
        let slideIndex = 0;
        let pos = "center";

        for (const part of parts) {
          if (part.name === "image" && part.filename) {
            imagePart = part;
          } else if (part.name === "slideIndex") {
            slideIndex = parseInt(part.data.toString("utf8").trim(), 10);
          } else if (part.name === "position") {
            pos = part.data.toString("utf8").trim();
          }
        }

        if (!imagePart) {
          return sendJSON(res, 400, { error: "No image file provided" });
        }

        // Validate extension
        const origExt = path.extname(imagePart.filename).toLowerCase();
        if (!ALLOWED_IMAGE_EXTS.has(origExt)) {
          return sendJSON(res, 400, {
            error: `Unsupported format: ${origExt}. Allowed: ${[...ALLOWED_IMAGE_EXTS].join(", ")}`,
          });
        }

        // Sanitize filename
        const baseName = path.basename(imagePart.filename, origExt);
        const sanitized = sanitizeFilename(baseName) + origExt;

        if (!sanitized || sanitized === origExt) {
          return sendJSON(res, 400, { error: "Invalid filename" });
        }

        // Save file
        const savePath = path.join(ASSETS, sanitized);
        fs.writeFileSync(savePath, imagePart.data);
        console.log(
          `  Saved image: ${sanitized} (${imagePart.data.length} bytes)`,
        );

        handleImageInsert(res, sanitized, slideIndex, pos);
      } catch (e) {
        console.error("Upload error:", e.message);
        sendJSON(res, 500, { error: e.message });
      }
    });
    return;
  }

  // ── GET /api/images ──
  if (req.method === "GET" && req.url === "/api/images") {
    try {
      const images = fs.existsSync(ASSETS)
        ? fs
            .readdirSync(ASSETS)
            .filter((f) => {
              const ext = path.extname(f).toLowerCase();
              return ALLOWED_IMAGE_EXTS.has(ext);
            })
            .sort()
        : [];
      sendJSON(res, 200, { images });
    } catch (e) {
      console.error("Image list error:", e.message);
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // ── Static file serving ──
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

  // Inject editor UI when serving lecture.html
  if (filePath.endsWith("lecture.html")) {
    let html = fs.readFileSync(filePath, "utf8");
    html = html.replace("</body>", EDITOR_UI_HTML + "\n</body>");
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": Buffer.byteLength(html),
    });
    res.end(html);
    return;
  }

  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(filePath).pipe(res);
});

// ---------- Helpers ----------

function collectBody(req, maxSize, cb) {
  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on("data", (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > maxSize) {
      aborted = true;
      req.destroy();
      cb(
        new Error(
          `Request body too large (${Math.round(maxSize / 1024 / 1024)}MB limit)`,
        ),
      );
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (!aborted) {
      cb(null, Buffer.concat(chunks));
    }
  });

  req.on("error", (err) => {
    if (!aborted) {
      aborted = true;
      cb(err);
    }
  });
}

function handleImageInsert(res, filename, slideIndex, pos) {
  const files = getSlideFiles();

  if (isNaN(slideIndex) || slideIndex < 0 || slideIndex >= files.length) {
    return sendJSON(res, 400, {
      error: `Invalid slide index: ${slideIndex}. Total slides: ${files.length}`,
    });
  }

  const validPositions = ["background", "left", "right", "center"];
  if (!validPositions.includes(pos)) {
    return sendJSON(res, 400, {
      error: `Invalid position: ${pos}. Allowed: ${validPositions.join(", ")}`,
    });
  }

  // Verify image exists
  const imgPath = path.join(ASSETS, filename);
  if (!fs.existsSync(imgPath)) {
    return sendJSON(res, 404, { error: `Image not found: ${filename}` });
  }

  // Read slide, insert image, save
  const slidePath = path.join(SLIDES, files[slideIndex]);
  const slideHtml = fs.readFileSync(slidePath, "utf8");
  const updatedHtml = insertImageIntoSlide(slideHtml, filename, pos);
  fs.writeFileSync(slidePath, updatedHtml, "utf8");

  console.log(`  Inserted ${filename} into ${files[slideIndex]} (${pos})`);

  rebuildProject();

  sendJSON(res, 200, {
    ok: true,
    file: filename,
    path: `assets/${filename}`,
  });
}

// ---------- Start ----------

server.listen(PORT, () => {
  console.log(`\n  Editor server running at http://localhost:${PORT}`);
  console.log("  Changes saved in edit mode will sync to source files.");
  console.log("  Image upload: drag & drop or click IMG button.\n");
});
