/* ============================================================
   codechains blog — 로컬 개발 서버 (외부 의존성 없음)
   실행:  npm run dev   →  http://localhost:4000

   - 시작할 때 한 번 빌드하고 site/ 를 그대로 서빙합니다.
   - content/ · assets/ · scripts/build.js 가 바뀌면 자동으로 다시 빌드하고
     열려 있는 브라우저 탭을 자동 새로고침합니다.
   - 모든 응답에 no-store 를 붙여 브라우저 캐시를 아예 만들지 않습니다.
     (배포본에서 Ctrl+F5 해야 했던 문제를 로컬에서는 겪지 않도록)
   - 자동 새로고침용 스크립트는 이 개발 서버가 응답할 때만 끼워 넣습니다.
     빌드 결과물(site/)에는 남지 않으므로 배포에는 영향이 없습니다.
   ============================================================ */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "site");
const BUILD = path.join(__dirname, "build.js");
const ADMIN = path.join(__dirname, "admin.js");
const PORT = Number(process.env.PORT) || 4000;

// 변경을 감시할 대상 — 빌드 입력이 되는 것들만
const WATCH = [path.join(ROOT, "content"), path.join(ROOT, "assets"), BUILD, ADMIN];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/* ---------- 빌드 ---------- */
function build() {
  // 로컬 빌드이므로 관리 페이지가 함께 만들어집니다(배포 빌드에서만 빠집니다).
  // CC_DEPLOY 가 환경에 남아 있으면 관리 페이지가 사라지므로 여기서 확실히 꺼둡니다.
  const env = { ...process.env, PORT: String(PORT) };
  delete env.CC_DEPLOY;
  const r = spawnSync(process.execPath, [BUILD], { cwd: ROOT, encoding: "utf8", env });
  if (r.status === 0) {
    process.stdout.write(r.stdout);
    return true;
  }
  console.error("\n[빌드 실패]");
  console.error((r.stderr || r.stdout || "").trim());
  console.error("파일을 고쳐서 저장하면 자동으로 다시 시도합니다.\n");
  return false;
}

/* ---------- 자동 새로고침 (SSE) ---------- */
const clients = new Set();

const RELOAD_SNIPPET = `<script>
(function(){
  var es = new EventSource("/__reload");
  es.onmessage = function(){ location.reload(); };
  es.onerror = function(){ /* 서버 재시작 중이면 브라우저가 알아서 재연결 */ };
})();
</script>`;

function notifyReload() {
  for (const res of clients) {
    try { res.write("data: reload\n\n"); } catch (e) { clients.delete(res); }
  }
}

/* ---------- 경로 해석 ---------- */
// /about/ → site/about/index.html, /about → site/about/index.html, /feed.xml → site/feed.xml
function resolveFile(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch (e) {
    return null;
  }
  const target = path.join(OUT, path.normalize(p).replace(/^[\\/]+/, ""));
  // site/ 밖으로 나가는 경로 차단
  if (target !== OUT && !target.startsWith(OUT + path.sep)) return null;

  const candidates = p.endsWith("/")
    ? [path.join(target, "index.html")]
    : [target, path.join(target, "index.html")];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/* ---------- 서버 ---------- */
const server = http.createServer((req, res) => {
  if (req.url.split("?")[0] === "/__reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write("retry: 500\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const file = resolveFile(req.url);
  const notFound = !file;
  const served = file || path.join(OUT, "404.html");

  if (notFound && !fs.existsSync(served)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("404");
    console.log(`  404  ${req.url}`);
    return;
  }

  const ext = path.extname(served).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  let body = fs.readFileSync(served);

  // HTML 에만 자동 새로고침 스크립트를 주입
  if (ext === ".html") {
    body = Buffer.from(body.toString("utf8").replace("</body>", `${RELOAD_SNIPPET}\n</body>`), "utf8");
  }

  res.writeHead(notFound ? 404 : 200, {
    "Content-Type": type,
    "Cache-Control": "no-store, must-revalidate",
    "Content-Length": body.length,
  });
  res.end(body);
  console.log(`  ${notFound ? 404 : 200}  ${req.url}`);
});

/* ---------- 감시 ---------- */
let timer = null;
function onChange(file) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`\n[변경 감지] ${file} → 다시 빌드`);
    if (build()) notifyReload();
  }, 120); // 에디터가 여러 번 저장 이벤트를 쏘는 것을 합침
}

function watch() {
  for (const target of WATCH) {
    if (!fs.existsSync(target)) continue;
    const isDir = fs.statSync(target).isDirectory();
    fs.watch(target, { recursive: isDir }, (_e, name) => {
      onChange(path.join(path.basename(target), name || ""));
    });
  }
}

/* ---------- 실행 ---------- */
console.log("첫 빌드 중...");
build();
watch();
server.listen(PORT, () => {
  console.log(`\n  로컬 서버: http://localhost:${PORT}`);
  console.log(`  콘텐츠 관리: http://localhost:${PORT}/admin  (로컬 전용, 배포되지 않음)`);
  console.log("  content/ · assets/ · scripts/build.js 를 저장하면 자동으로 반영됩니다.");
  console.log("  종료: Ctrl+C\n");
});
