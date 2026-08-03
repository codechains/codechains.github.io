/* ============================================================
   공유 카드 이미지(og:image) 만들기
   실행:  npm run og

   만들어지는 것
     assets/og.png                 사이트 공용 카드 (홈·소개·404)
     assets/og/<슬러그>.png         한국어 글마다 제목이 박힌 카드
     assets/og/en/<슬러그>.png      영문 글

   왜 이렇게 만드는가:
   - og:image 는 카카오톡·링크드인·페이스북·X 가 링크 미리보기에 쓰는 그림입니다.
     SVG 는 이들 대부분이 렌더링하지 않으므로 PNG 여야 합니다.
   - 이미지 라이브러리를 새로 깔지 않으려고, 이미 설치된 크롬을 헤드리스로 띄워
     HTML 카드를 그대로 캡처합니다. 폰트 렌더링까지 이 PC에서 끝나므로
     배포 환경에 폰트나 라이브러리가 필요 없습니다.
   - 이미 만들어 둔 카드는 다시 그리지 않습니다. 카드 내용이 바뀐 것만 다시 캡처하므로
     글이 수백 개가 되어도 새 글 한 장만 그립니다. 전부 다시 그리려면 --force 를 붙이세요.
   - 초안(draft: true)은 만들지 않습니다. 공개된 글만 대상입니다.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { loadPosts, published, fmtDate, ogCardPath } = require("./posts");

const ROOT = path.join(__dirname, "..");
const CONTENT = path.join(ROOT, "content");
const ASSETS = path.join(ROOT, "assets");
const CACHE = path.join(__dirname, ".og-cache.json");
const site = JSON.parse(fs.readFileSync(path.join(CONTENT, "site.json"), "utf8"));

/* 2:1 로 만듭니다.
   1200x630(1.91:1)은 페이스북이 정한 Open Graph 표준값인데, 우리가 실제로 쓰는 곳은
   쓰레드와 카카오톡이고 둘 다 2:1 을 기준으로 링크 카드를 그립니다. X 도 2:1 입니다.
   페이스북·링크드인에서 생기는 2.4% 차이는 눈에 띄지 않습니다.

   위아래 20px 은 비워 둡니다. 플랫폼마다 자르는 폭이 조금씩 달라서,
   그 바깥에 글자를 두면 어디선가는 잘립니다. 지금 여백(위 68, 아래 76)이면 넉넉합니다. */
const WIDTH = 1200;
const HEIGHT = 600;
const SCALE = 2; // 고해상도 화면에서도 글자가 또렷하도록 2배로 캡처
const KAKAO_LIMIT_KB = 500; // 카카오톡이 받아주는 og:image 용량 한도
const FORCE = process.argv.includes("--force");

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- 크롬 찾기 ----------
   CHROME 환경변수로 직접 지정할 수도 있습니다. */
function findChrome() {
  const candidates = [
    process.env.CHROME,
    path.join(process.env["ProgramFiles"] || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["LOCALAPPDATA"] || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles"] || "", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/* 카드 위쪽에 들어가는 워드마크.
   헤더가 쓰는 것과 같은 파일을 그대로 읽어 옵니다. 로고를 다시 만들면(npm run wordmark)
   카드도 같이 따라오도록, 여기에 모양을 베껴 두지 않습니다.
   카드 배경이 어두우므로 어두운 테마용을 씁니다.

   크기는 CSS 로 정하므로 루트 svg 의 width/height 만 뗍니다.
   파일 전체에서 떼면 안 됩니다. 안쪽 마스크의 rect 크기까지 사라져서
   마스크가 통째로 검게 되고 로고가 아예 안 보입니다. 실제로 한 번 그렇게 나갔습니다. */
const WORDMARK = fs
  .readFileSync(path.join(ROOT, "assets/logo/wordmark-nowing-dark.svg"), "utf8")
  .replace(/^<\?xml[^>]*\?>\s*/, "")
  .replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s+(width|height)="[^"]*"/g, ""));


/* 제목 길이는 글마다 다릅니다. 넘치면 카드 밖으로 잘려 나가므로,
   캡처 직전에 제목이 자리에 들어갈 때까지 글자 크기를 줄입니다.
   (크롬이 페이지를 그린 뒤 캡처하므로 이 스크립트가 반영된 화면이 찍힙니다) */
const FIT_JS = `<script>
(function(){
  var el = document.getElementById('fit');
  if (!el) return;
  var box = el.parentNode;
  for (var size = 78; size >= 34; size -= 2) {
    el.style.fontSize = size + 'px';
    if (el.scrollHeight <= box.clientHeight) break;
  }
})();
</script>`;

const STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    background: #0e1116;
    font-family: system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
    color: #e6e9ef;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    position: relative;
    width: ${WIDTH}px; height: ${HEIGHT}px;
    padding: 68px 80px 76px;
    display: flex; flex-direction: column; justify-content: space-between;
    overflow: hidden;
  }
  /* 모서리에서 번지는 빛. 평평한 검정 배경보다 카드가 살아 보입니다. */
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(760px 420px at 8% -6%, rgba(110,231,183,.16), transparent 60%),
      radial-gradient(700px 460px at 100% 108%, rgba(122,162,255,.18), transparent 62%);
  }
  .top { position: relative; display: flex; align-items: center; justify-content: space-between; }
  .row { display: flex; align-items: center; gap: 16px; }
  .brand { font-size: 32px; font-weight: 700; letter-spacing: -.01em; }
  .date { font-size: 25px; color: #8b93a7; font-variant-numeric: tabular-nums; }
  .middle { position: relative; flex: 1; display: flex; align-items: center; min-height: 0; padding: 26px 0; }
  h1 { font-size: 78px; line-height: 1.24; font-weight: 800; letter-spacing: -.035em; word-break: keep-all; }
  .grad {
    background: linear-gradient(100deg, #6ee7b7, #7aa2ff);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  footer { position: relative; display: flex; align-items: baseline; justify-content: space-between; gap: 32px; }
  .sub { font-size: 25px; color: #8b93a7; letter-spacing: -.01em; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .url { font-size: 25px; font-weight: 600; color: #6ee7b7; letter-spacing: .01em; white-space: nowrap; }
  /* 아래쪽 가는 띠. 카드가 잘려도 브랜드 색이 남습니다. */
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 8px;
         background: linear-gradient(90deg, #6ee7b7, #7aa2ff); }
`;

function cardHtml({ lang, heading, date, sub, fit }) {
  return `<!doctype html>
<html lang="${lang === "en" ? "en" : "ko"}">
<head>
<meta charset="utf-8">
<title>og card</title>
<style>${STYLE}</style>
</head>
<body>
<div class="card">
  <div class="glow"></div>
  <div class="top">
    <div class="row"><span class="brand">${esc(site.brand)}</span></div>
    ${date ? `<span class="date">${esc(date)}</span>` : ""}
  </div>
  <div class="middle"><h1${fit ? ` id="fit"` : ""}>${heading}</h1></div>
  <footer>
    <span class="sub">${esc(sub)}</span>
  </footer>
  <div class="bar"></div>
</div>
${fit ? FIT_JS : ""}
</body>
</html>`;
}

/* ---------- 만들 카드 목록 ---------- */
const jobs = [];

// 사이트 공용 카드. 홈·소개·404 와, 아직 자기 카드가 없는 글이 씁니다.
jobs.push({
  out: path.join(ASSETS, "og.png"),
  label: "og.png (공용)",
  html: cardHtml({
    lang: "ko",
    heading: `이어 붙인 기록이,<br><span class="grad">커리어가 된다.</span>`,
    date: "",
    sub: "AI transformation, documented in the open",
    fit: false,
  }),
});

const groups = [
  { lang: "ko", posts: published(loadPosts(path.join(CONTENT, "posts-kr"))) },
  { lang: "en", posts: published(loadPosts(path.join(CONTENT, "posts-en"))) },
];

groups.forEach(({ lang, posts }) => {
  posts.forEach((p) => {
    const rel = ogCardPath(lang, p.slug); // /assets/og/... 형태
    const tags = (p.tags || []).slice(0, 3).join(" · ");
    jobs.push({
      out: path.join(ROOT, rel.replace(/^\//, "")),
      label: `${lang}/${p.slug}`,
      html: cardHtml({
        lang,
        heading: esc(p.title),
        date: fmtDate(p.date, lang),
        sub: tags || (lang === "en" ? "AI transformation, documented in the open" : "AI 트랜스포메이션 기록"),
        fit: true, // 제목 길이에 맞춰 글자 크기를 줄임
      }),
    });
  });
});

/* ---------- 캐시 ----------
   카드 HTML 이 그대로면 결과 PNG 도 그대로이므로 다시 캡처하지 않습니다. */
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (e) {}

const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

/* ---------- PNG 크기 읽기 ----------
   캡처가 빈 화면이거나 크기가 어긋나면 바로 알 수 있도록 결과를 직접 확인합니다. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!b.slice(0, 8).equals(sig)) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

/* ---------- 실행 ---------- */
const chrome = findChrome();
if (!chrome) {
  console.error("크롬이나 엣지를 찾지 못했습니다. CHROME 환경변수에 실행 파일 경로를 지정하세요.");
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-"));
const profile = path.join(tmp, "profile"); // 떠 있는 브라우저의 프로필과 부딪히지 않도록 따로
let made = 0, skipped = 0, failed = 0;

jobs.forEach((job) => {
  const key = path.relative(ROOT, job.out).replace(/\\/g, "/");
  const h = hash(job.html);
  if (!FORCE && cache[key] === h && fs.existsSync(job.out)) {
    skipped++;
    return;
  }

  const htmlFile = path.join(tmp, `${hash(key)}.html`);
  fs.writeFileSync(htmlFile, job.html, "utf8");
  fs.mkdirSync(path.dirname(job.out), { recursive: true });
  if (fs.existsSync(job.out)) fs.rmSync(job.out);

  const r = spawnSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--user-data-dir=${profile}`,
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    `--screenshot=${job.out}`,
    `file:///${htmlFile.replace(/\\/g, "/")}`,
  ], { encoding: "utf8", timeout: 60000 });

  const size = fs.existsSync(job.out) && pngSize(job.out);
  if (!size) {
    failed++;
    console.error(`  실패: ${job.label}`);
    console.error("    " + (r.stderr || r.stdout || "").trim().slice(0, 400));
    return;
  }
  if (size.w !== WIDTH * SCALE || size.h !== HEIGHT * SCALE) {
    console.warn(`  경고: ${job.label} 크기가 ${size.w}x${size.h} 입니다(기대 ${WIDTH * SCALE}x${HEIGHT * SCALE}).`);
  }
  /* 카카오톡은 500KB 를 넘는 og:image 를 아예 안 보여줍니다.
     한국 독자가 단톡방에 링크를 던지는 경로라 미리보기가 빠지면 손해가 큽니다.
     제목이 길어지면 용량이 늘어나므로 만들 때마다 확인합니다. */
  const KB = size.bytes / 1024;
  if (KB > KAKAO_LIMIT_KB) {
    console.warn(`  경고: ${job.label} 이 ${KB.toFixed(0)}KB 입니다. 카카오톡은 ${KAKAO_LIMIT_KB}KB 를 넘으면 미리보기를 안 띄웁니다.`);
  }
  cache[key] = h;
  made++;
  console.log(`  만듦: ${job.label}  ${KB.toFixed(0)}KB${KB > KAKAO_LIMIT_KB * 0.8 ? " (카카오 한도에 근접)" : ""}`);
});

/* 글을 지웠거나 슬러그를 바꾸면 예전 카드가 남습니다.
   배포본에 쓰이지 않는 파일이 계속 쌓이므로 정리합니다. */
const wanted = new Set(jobs.map((j) => path.relative(ROOT, j.out).replace(/\\/g, "/")));
const ogDir = path.join(ASSETS, "og");
let removed = 0;
if (fs.existsSync(ogDir)) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const full = path.join(d, e.name);
    if (e.isDirectory()) return walk(full);
    const key = path.relative(ROOT, full).replace(/\\/g, "/");
    if (!wanted.has(key)) { fs.rmSync(full); delete cache[key]; removed++; console.log(`  지움: ${key}`); }
  });
  walk(ogDir);
}

fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n카드 ${jobs.length}장 중 ${made}장 새로 만들고 ${skipped}장은 그대로 뒀습니다.` +
  (removed ? ` 쓰이지 않는 ${removed}장을 지웠습니다.` : "") +
  (failed ? ` 실패 ${failed}장.` : ""));
if (failed) process.exit(1);
