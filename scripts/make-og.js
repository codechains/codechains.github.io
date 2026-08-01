/* ============================================================
   공유 카드 이미지(og:image) 만들기
   실행:  npm run og   →  assets/og.png (1200x630)

   왜 이렇게 만드는가:
   - og:image 는 카카오톡·링크드인·페이스북·X 가 링크 미리보기에 쓰는 그림입니다.
     SVG 는 이들 대부분이 렌더링하지 않으므로 PNG 여야 합니다.
   - 이미지 라이브러리를 새로 깔지 않으려고, 이미 설치된 크롬을 헤드리스로 띄워
     HTML 카드를 그대로 캡처합니다. 폰트 렌더링까지 이 PC에서 끝나므로
     배포 환경에 폰트나 라이브러리가 필요 없습니다.
   - 카드 문구는 content/site.json 에서 가져옵니다. 브랜드 문구를 고치면 다시 돌리면 됩니다.
   - 중간 산출물 scripts/og-card.html 은 브라우저로 열어서 눈으로 확인할 수 있습니다.
     디자인을 손보고 싶으면 이 파일이 아니라 아래 CARD 템플릿을 고치고 다시 실행하세요.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "site.json"), "utf8"));

const OUT_PNG = path.join(ROOT, "assets", "og.png");
const CARD_HTML = path.join(__dirname, "og-card.html");
const WIDTH = 1200;
const HEIGHT = 630;
const SCALE = 2; // 고해상도 화면에서도 글자가 또렷하도록 2배로 캡처

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

/* ---------- 카드 ----------
   사이트와 같은 색·같은 로고를 씁니다. 미리보기에서 본 인상과 실제 사이트가 이어지도록.
   한국어 문장을 크게 두고 영어 한 줄을 곁들입니다. 카드는 한 장으로 두 언어판에 함께 쓰입니다. */
const LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12.5 19.5l7-7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/>
<path d="M14.8 9.2l1.7-1.7a4.6 4.6 0 016.5 6.5l-1.7 1.7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/>
<path d="M17.2 22.8l-1.7 1.7a4.6 4.6 0 01-6.5-6.5l1.7-1.7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/>
<defs><linearGradient id="g" x1="6" y1="8" x2="26" y2="24" gradientUnits="userSpaceOnUse">
<stop stop-color="#6ee7b7"/><stop offset="1" stop-color="#7aa2ff"/></linearGradient></defs></svg>`;

const CARD = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>og card</title>
<style>
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
    padding: 72px 80px;
    display: flex; flex-direction: column; justify-content: space-between;
    overflow: hidden;
  }
  /* 왼쪽 위에서 번지는 빛. 평평한 검정 배경보다 카드가 살아 보입니다. */
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(760px 420px at 8% -6%, rgba(110,231,183,.16), transparent 60%),
      radial-gradient(700px 460px at 100% 108%, rgba(122,162,255,.18), transparent 62%);
  }
  /* 오른쪽 아래 큰 로고. 브랜드를 각인시키되 글자를 방해하지 않을 만큼만. */
  .mark {
    position: absolute; right: -70px; bottom: -110px;
    width: 460px; height: 460px; opacity: .07;
  }
  .mark svg { width: 100%; height: 100%; }
  .row { position: relative; display: flex; align-items: center; gap: 16px; }
  .row svg { width: 46px; height: 46px; }
  .wordmark { font-size: 34px; font-weight: 700; letter-spacing: -.01em; }
  h1 {
    position: relative;
    font-size: 78px; line-height: 1.24; font-weight: 800; letter-spacing: -.035em;
  }
  .grad {
    background: linear-gradient(100deg, #6ee7b7, #7aa2ff);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  footer { position: relative; display: flex; align-items: baseline; justify-content: space-between; }
  .sub { font-size: 26px; color: #8b93a7; letter-spacing: -.01em; }
  .url { font-size: 26px; font-weight: 600; color: #6ee7b7; letter-spacing: .01em; }
  /* 아래쪽 가는 띠. 카드가 잘려도 브랜드 색이 남습니다. */
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 8px;
         background: linear-gradient(90deg, #6ee7b7, #7aa2ff); }
</style>
</head>
<body>
<div class="card">
  <div class="glow"></div>
  <div class="mark">${LOGO}</div>
  <div class="row">${LOGO}<span class="wordmark">${esc(site.brand)}</span></div>
  <h1>이어 붙인 기록이,<br><span class="grad">커리어가 된다.</span></h1>
  <footer>
    <span class="sub">AI transformation, documented in the open</span>
    <span class="url">${esc(site.customDomain || "codechains.dev")}</span>
  </footer>
  <div class="bar"></div>
</div>
</body>
</html>`;

/* ---------- PNG 크기 읽기 ----------
   캡처가 빈 화면이거나 크기가 어긋나면 바로 알 수 있도록 결과를 직접 확인합니다. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  const isPng = b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

/* ---------- 실행 ---------- */
const chrome = findChrome();
if (!chrome) {
  console.error("크롬이나 엣지를 찾지 못했습니다. CHROME 환경변수에 실행 파일 경로를 지정하세요.");
  process.exit(1);
}

fs.writeFileSync(CARD_HTML, CARD, "utf8");
fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });
if (fs.existsSync(OUT_PNG)) fs.rmSync(OUT_PNG);

// 이미 떠 있는 브라우저의 프로필과 부딪히지 않도록 임시 프로필을 따로 씁니다
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "og-shot-"));
const args = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--default-background-color=00000000",
  `--user-data-dir=${profile}`,
  `--force-device-scale-factor=${SCALE}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  `--screenshot=${OUT_PNG}`,
  `file:///${CARD_HTML.replace(/\\/g, "/")}`,
];

const r = spawnSync(chrome, args, { encoding: "utf8", timeout: 60000 });
fs.rmSync(profile, { recursive: true, force: true });

const size = fs.existsSync(OUT_PNG) && pngSize(OUT_PNG);
if (!size) {
  console.error("캡처에 실패했습니다.");
  console.error((r.stderr || r.stdout || "").trim().slice(0, 2000));
  process.exit(1);
}

console.log(`만들었습니다: assets/og.png  ${size.w}x${size.h}, ${(size.bytes / 1024).toFixed(0)}KB`);
console.log(`카드 원본: scripts/og-card.html (브라우저로 열어 확인할 수 있습니다)`);
if (size.w !== WIDTH * SCALE || size.h !== HEIGHT * SCALE) {
  console.warn(`경고: 기대한 크기(${WIDTH * SCALE}x${HEIGHT * SCALE})와 다릅니다.`);
}
