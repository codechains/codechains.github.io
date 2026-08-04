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
const THREADS = path.join(__dirname, "threads.js"); // 관리 페이지의 쓰레드 탭이 이 규칙으로 원고를 읽습니다
const PORT = Number(process.env.PORT) || 4000;

// 변경을 감시할 대상 — 빌드 입력이 되는 것들만
const WATCH = [path.join(ROOT, "content"), path.join(ROOT, "assets"), BUILD, ADMIN, THREADS];

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

/* ---------- 깃허브 반영 ----------
   화면에서 원고를 고쳐 로컬 파일만 바꾸는 것은 아무 의미가 없습니다.
   실제로 쓰레드에 올리는 것은 깃허브 액션이고, 액션이 읽는 것은 origin/main 의 파일입니다.
   로컬만 고쳐두면 화면에는 고친 글이 보이는데 쓰레드에는 옛 글이 올라갑니다. 제일 나쁜 어긋남입니다.

   그래서 저장은 "파일 쓰기"가 아니라 "깃허브까지 올라가는 것"까지가 한 동작입니다.
   순서도 이래야 합니다.
     1. 먼저 받아옵니다. 그사이 액션이 남긴 발행 표시를 가져와야, 이미 나간 편을 고치는 일을 막습니다.
     2. 그다음에 씁니다. (이때 발행됨으로 바뀐 편이면 threads.js 가 거부합니다)
     3. 커밋하고 올립니다. */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" }; // 자격 증명을 물으면 멈추지 말고 실패하게
const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env: GIT_ENV, timeout: 60000 });

function gitOrThrow(label, ...args) {
  const r = git(...args);
  if (r.status !== 0) throw new Error(`${label} 실패\n${((r.stderr || "") + (r.stdout || "")).trim()}`);
  return (r.stdout || "").trim();
}

/* 깃허브의 최신 상태를 가져옵니다. 바뀐 것이 있었는지 알려줍니다(화면을 새로 그릴지 정하려고).
   --autostash: 다른 파일을 손보던 중이어도 리베이스가 막히지 않게 잠깐 치웠다 되돌립니다. */
function pullLatest() {
  const branch = gitOrThrow("브랜치 확인", "rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") {
    throw new Error(`지금 브랜치가 ${branch} 입니다. 발행은 main 을 읽으므로 main 에서 고치세요.`);
  }
  const before = gitOrThrow("현재 커밋 확인", "rev-parse", "HEAD");
  gitOrThrow("깃허브에서 받아오기", "pull", "--rebase", "--autostash", "origin", "main");
  return { changed: gitOrThrow("커밋 확인", "rev-parse", "HEAD") !== before };
}

/* 해당 파일만 커밋해서 올립니다.
   경로를 붙여 커밋하는 이유는, 지금 손보던 다른 파일까지 딸려 올라가지 않게 하기 위해서입니다. */
function pushFile(rel, message) {
  if (!gitOrThrow("변경 확인", "status", "--porcelain", "--", rel)) return { pushed: false, reason: "same" };

  const c = git("commit", "-m", message, "--", rel);
  if (c.status !== 0) {
    const out = ((c.stderr || "") + (c.stdout || "")).trim();
    /* 줄 끝 차이처럼 깃이 무시하는 변경만 있었던 경우입니다.
       status 는 바뀌었다고 보는데 커밋할 것은 없습니다. 실패가 아니라 올릴 것이 없는 것입니다. */
    if (/nothing to commit|no changes added/i.test(out)) return { pushed: false, reason: "same" };
    throw new Error(`커밋 실패\n${out}`);
  }

  let r = git("push", "origin", "HEAD:main");
  if (r.status !== 0) {
    // 그사이 액션이 발행 표시를 올렸을 수 있습니다. 한 번 당겨서 다시 시도합니다.
    gitOrThrow("다시 받아오기", "pull", "--rebase", "--autostash", "origin", "main");
    r = git("push", "origin", "HEAD:main");
  }
  if (r.status !== 0) throw new Error(`올리기 실패\n${((r.stderr || "") + (r.stdout || "")).trim()}`);
  return { pushed: true };
}

/* ---------- 자동 새로고침 (SSE) ---------- */
const clients = new Set();

const RELOAD_SNIPPET = `<script>
(function(){
  var es = new EventSource("/__reload");
  es.onmessage = function(){
    /* 화면이 "지금 새로고침하면 안 된다"고 하면 넘깁니다.
       관리 페이지에서 원고를 고치는 중일 때가 그렇습니다. 새로고침하면 안 저장한 글이 날아갑니다.
       다음 변경 때 다시 오므로 화면은 곧 따라잡습니다. */
    if (window.__ccHold && window.__ccHold()) return;
    location.reload();
  };
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

  /* 관리 화면의 저장·동기화. 이 서버는 이 PC 에서만 뜨고 배포되지 않으므로 여기에만 둡니다. */
  const route = req.url.split("?")[0];
  if (route === "/__thread-save" || route === "/__thread-sync") {
    const reply = (code, obj) => {
      const body = Buffer.from(JSON.stringify(obj), "utf8");
      res.writeHead(code, { "Content-Type": MIME[".json"], "Cache-Control": "no-store", "Content-Length": body.length });
      res.end(body);
    };
    if (req.method !== "POST") {
      reply(405, { ok: false, error: "POST 만 받습니다." });
      return;
    }

    if (route === "/__thread-sync") {
      try {
        const r = pullLatest();
        console.log(`  동기화  ${r.changed ? "받아온 것이 있습니다" : "최신입니다"}`);
        reply(200, { ok: true, ...r });
      } catch (e) {
        console.error(`  동기화 실패  ${e.message}`);
        reply(400, { ok: false, error: e.message });
      }
      return;
    }

    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy(); // 원고 한 편은 몇 킬로바이트입니다
    });
    req.on("end", () => {
      let saved = null;
      try {
        const { id, part, text } = JSON.parse(raw);
        // 1. 먼저 받아옵니다. 액션이 남긴 발행 표시를 가져와야 이미 나간 편을 고치는 일을 막습니다.
        pullLatest();
        // 2. 씁니다. 그사이 발행됨으로 바뀐 편이면 여기서 거부됩니다.
        saved = require("./threads").writeText(path.join(ROOT, "content", "threads"), id, part, text);
        console.log(`  저장  ${id} → ${saved.file} (${saved.len}자)`);
        // 3. 깃허브까지 올려야 끝입니다. 여기까지 와야 액션이 고친 원고를 읽습니다.
        const up = pushFile(`content/threads/${saved.file}`, `쓰레드 ${id} 본문 수정`);
        console.log(`  올림  ${id} ${up.pushed ? "→ origin/main" : "(바뀐 것 없음)"}`);
        reply(200, { ok: true, ...saved, pushed: up.pushed });
      } catch (e) {
        console.error(`  저장 실패  ${e.message}`);
        /* 파일까지는 썼는데 올리는 데서 실패한 경우입니다. 글은 살아 있으니 지우지 않고,
           깃허브에는 아직 안 올라갔다는 것만 분명히 알립니다. */
        reply(saved ? 200 : 400, { ok: !!saved, ...(saved || {}), pushed: false, error: e.message });
      }
    });
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
