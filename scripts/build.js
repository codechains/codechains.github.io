/* ============================================================
   codechains blog — static build
   Reads markdown from /content and static files from /assets,
   writes static HTML to /site.
   No build step runs on GitHub; it only serves the output.
   Run:  node scripts/build.js
   ============================================================ */
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const fm = require("front-matter");
// 글을 읽는 규칙은 make-og.js 와 함께 씁니다(슬러그·날짜 해석이 어긋나지 않도록)
const { read, fmtDate, loadPosts, published, ogCardPath } = require("./posts");

const ROOT = path.join(__dirname, "..");
const CONTENT = path.join(ROOT, "content");
const ASSETS = path.join(ROOT, "assets"); // 커밋되는 정적 원본(css 등) → site/assets/ 로 복사
const OUT = path.join(ROOT, "site");
const site = JSON.parse(fs.readFileSync(path.join(CONTENT, "site.json"), "utf8"));

marked.setOptions({ gfm: true, breaks: false });

/* ---------- helpers ---------- */
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
function write(rel, html) {
  const out = path.join(OUT, rel);
  ensureDir(path.dirname(out));
  fs.writeFileSync(out, html);
  return rel;
}
/* /assets 의 정적 원본을 그대로 site/assets/ 로 복사.
   (css·이미지 등은 build.js가 생성하는 게 아니라 커밋된 파일이므로 반드시 복사해야 배포에 포함됨) */
function copyAssets() {
  if (!fs.existsSync(ASSETS)) {
    throw new Error("assets/ 폴더가 없습니다. CSS 등 정적 원본은 assets/ 안에 두고 커밋하세요.");
  }
  const files = fs.readdirSync(ASSETS);
  if (!files.includes("style.css")) {
    throw new Error("assets/style.css 가 없습니다. 스타일 없이 배포되는 걸 막기 위해 빌드를 중단합니다.");
  }
  const dest = path.join(OUT, "assets");
  ensureDir(dest);
  fs.cpSync(ASSETS, dest, { recursive: true });
  return files.length;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- SEO 검사 ----------
   글이 발행될 때마다 검색 최적화 항목이 자동으로 채워지도록, 빌드가 직접 확인합니다.
   - 없으면 안 되는 것(title/date/description)은 오류 → 빌드 중단 → 배포되지 않음
   - 품질 문제(설명 길이, 태그 누락 등)는 경고 → 배포는 되지만 로그에 남음
   초안이라 아직 못 채웠다면 frontmatter 에 draft: true 를 넣으세요. 검사 대상에서 빠집니다. */
const SEO = { descMin: 40, descMax: 160, titleMax: 60 };

function checkSeo(posts, label) {
  /* 검사 결과는 글 단위로 모읍니다.
     콘솔 출력용 문자열과, 로컬 관리 페이지가 글마다 배지로 보여줄 목록이 같은 데이터에서 나옵니다. */
  const issues = []; // { slug, level: "error" | "warn", msg }
  const bySlug = new Map();
  const add = (slug, level, msg) => {
    const item = { slug, level, msg };
    issues.push(item);
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(item);
  };
  const seenSlugs = new Map();
  const seenStamps = new Map();

  posts.forEach((p) => {
    const err = (m) => add(p.slug, "error", m);
    const warn = (m) => add(p.slug, "warn", m);

    if (!p.title || !String(p.title).trim()) err(`title 이 없습니다.`);
    if (!p.date || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) err(`date 가 없거나 형식이 잘못됐습니다(YYYY-MM-DD).`);
    if (!p.description || !String(p.description).trim()) {
      err(`description 이 없습니다. 검색결과에 보이는 문장이라 글마다 반드시 달라야 합니다.`);
    } else {
      const len = String(p.description).trim().length;
      if (len < SEO.descMin) warn(`description 이 ${len}자로 짧습니다(권장 ${SEO.descMin}~${SEO.descMax}자).`);
      if (len > SEO.descMax) warn(`description 이 ${len}자로 깁니다. 검색결과에서 뒷부분이 잘립니다(권장 ${SEO.descMax}자 이내).`);
    }

    if (p.title && String(p.title).length > SEO.titleMax) {
      warn(`title 이 ${String(p.title).length}자로 깁니다. 검색결과에서 잘릴 수 있습니다(권장 ${SEO.titleMax}자 이내).`);
    }
    if (!(p.tags || []).length) warn(`tags 가 없습니다.`);

    /* 긴 하이픈(em dash —, en dash –)은 AI가 쓴 글이라는 인상을 주는 대표적인 흔적이라 기본적으로 쓰지 않습니다.
       쉼표나 마침표로 대체하세요. 의도적으로 넣은 경우라면 이 경고는 무시하면 됩니다(빌드는 통과). */
    const dashFields = [["title", p.title], ["description", p.description], ["본문", p.rawBody]];
    dashFields.forEach(([name, text]) => {
      if (text && /[—–]/.test(String(text))) {
        warn(`${name}에 긴 하이픈(— 또는 –)이 있습니다. 쉼표나 마침표로 바꾸세요.`);
      }
    });

    // 슬러그가 겹치면 나중 글이 앞 글을 덮어써 조용히 사라집니다
    if (seenSlugs.has(p.slug)) err(`슬러그가 "${seenSlugs.get(p.slug)}" 와 겹칩니다. 파일명을 바꾸세요.`);
    else seenSlugs.set(p.slug, p.slug);

    /* 발행 시각이 완전히 같으면 어느 글이 위로 갈지 글 스스로 정하지 못합니다.
       파일명 역순으로 갈라 두긴 하지만, 의도한 순서인지는 사람만 알 수 있으므로 알려줍니다. */
    const stampKey = String(new Date(p.stamp).getTime());
    if (seenStamps.has(stampKey)) {
      warn(`발행 시각이 "${seenStamps.get(stampKey)}" 와 같아 목록 순서가 정해지지 않습니다. 나중에 낸 글의 date 에 시각을 넣으세요(예: date: ${p.date} 14:00:00 +09:00).`);
    } else seenStamps.set(stampKey, p.slug);
  });

  const lines = (level) => issues.filter((i) => i.level === level).map((i) => `${label}/${i.slug}: ${i.msg}`);
  return { errors: lines("error"), warnings: lines("warn"), bySlug };
}

function reportSeo(groups) {
  const errors = groups.flatMap((g) => g.errors);
  const warnings = groups.flatMap((g) => g.warnings);

  warnings.forEach((w) => console.warn(`  [SEO 경고] ${w}`));
  if (errors.length) {
    console.error("\n[SEO 검사 실패] 아래를 고쳐야 배포됩니다:");
    errors.forEach((e) => console.error(`  - ${e}`));
    console.error("\n(아직 다듬는 중이라면 frontmatter 에 draft: true 를 넣어 두세요.)\n");
    process.exit(1);
  }
  if (warnings.length) console.warn("");
}

const LOGO = `<svg class="logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12.5 19.5l7-7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/><path d="M14.8 9.2l1.7-1.7a4.6 4.6 0 016.5 6.5l-1.7 1.7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/><path d="M17.2 22.8l-1.7 1.7a4.6 4.6 0 01-6.5-6.5l1.7-1.7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/><defs><linearGradient id="g" x1="6" y1="8" x2="26" y2="24" gradientUnits="userSpaceOnUse"><stop stop-color="#6ee7b7"/><stop offset="1" stop-color="#7aa2ff"/></linearGradient></defs></svg>`;

const THEME_SCRIPT = `<script>(function(){try{var t=localStorage.getItem('cc-theme');if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();</script>`;
const THEME_TOGGLE_JS = `<script>(function(){var b=document.getElementById('themeBtn');if(!b)return;function cur(){return document.documentElement.getAttribute('data-theme')||'dark';}function set(v){document.documentElement.setAttribute('data-theme',v);try{localStorage.setItem('cc-theme',v);}catch(e){}b.textContent=v==='dark'?'☀':'☾';}b.textContent=cur()==='dark'?'☀':'☾';b.addEventListener('click',function(){set(cur()==='dark'?'light':'dark');});})();</script>`;
const SUBSCRIBE_JS = `<script>(function(){var f=document.getElementById('subForm');if(!f)return;f.addEventListener('submit',function(e){e.preventDefault();var n=document.getElementById('subNote');if(n)n.style.display='block';});})();</script>`;

/* 언어 이어가기 — 한국어 홈(/)에서만 동작.

   예전에는 브라우저 언어(navigator.languages)를 보고 한국어가 아니면 자동으로 /en/ 으로
   보냈습니다. 그 방식은 접었습니다. Googlebot 도 자바스크립트를 실행하고 그 언어 설정이
   보통 영어라, 크롤러가 한국어 홈을 보러 왔다가 영어 홈으로 튕겨 나갔기 때문입니다.
   구글은 인지된 언어에 따른 자동 리디렉션을 권장하지 않습니다(크롤러가 모든 언어판을
   보지 못하게 됨). 대신 다른 언어판이 있다는 것을 화면에 보이게 알립니다(langNotice).

   지금 남은 동작은 하나입니다. 사용자가 언어를 직접 고른 적이 있으면 그 선택을 이어 줍니다.
   크롤러에는 저장된 선택이 없으므로 이동이 일어나지 않습니다.
   깜빡임을 없애려고 <head>에서 본문 렌더 전에 실행하고, 히스토리를 더럽히지 않도록 replace 를 씁니다. */
const LANG_REDIRECT = `<script>(function(){try{if(localStorage.getItem('cc-lang')==='en'){location.replace('/en/');}}catch(e){}})();</script>`;

/* 언어 링크(머리말·안내 줄)를 직접 눌렀을 때 그 선택을 기억 */
const LANG_REMEMBER_JS = `<script>(function(){[].slice.call(document.querySelectorAll('[data-lang]')).forEach(function(a){a.addEventListener('click',function(){try{localStorage.setItem('cc-lang',a.getAttribute('data-lang'));}catch(e){}});});})();</script>`;

const T = {
  ko: { nav_about: "소개", home: "홈", posts: "글", langAlt: "EN", author_label: "글쓴이", author_more: "소개 보기", contact: "비슷한 상황이라면 편하게 물어보세요.", nl_h: "새 글을 이메일로 받아보기", nl_p: "AI 트랜스폼 여정의 새 글을 가장 먼저 받아보세요. 스팸은 없습니다.", nl_btn: "구독", nl_ph: "이메일 주소", nl_note: "구독 기능은 곧 연결됩니다. 우선 hello@codechains.dev 로 연락 주셔도 좋아요!", ad: "광고 영역 (애드센스 승인 후 표시됩니다)", latest: "최근 글", back: "← 목록으로", readmore: "읽기" },
  en: { nav_about: "About", home: "Home", posts: "Posts", langAlt: "한국어", author_label: "Written by", author_more: "About me", contact: "In a similar spot? Feel free to ask.", nl_h: "Get new posts by email", nl_p: "Be first to read new posts from the AI transformation journey. No spam.", nl_btn: "Subscribe", nl_ph: "your email", nl_note: "Subscriptions are being wired up. For now, reach me at hello@codechains.dev!", ad: "Ad slot (shown after AdSense approval)", latest: "Latest posts", back: "← All posts", readmore: "Read" },
};

/* 공유 카드 이미지의 실제 크기. og:image:width/height 를 같이 보내면
   카카오톡·페이스북 같은 곳이 이미지를 받기 전에도 자리를 잡아, 처음 공유할 때
   미리보기가 비어 보이는 일이 줄어듭니다. 파일에서 직접 읽으므로 카드를 다시 만들어도 맞습니다.
   같은 파일을 여러 페이지가 쓰므로 한 번 읽은 것은 기억해 둡니다. */
const dimsCache = new Map();
function pngDims(rel) {
  if (dimsCache.has(rel)) return dimsCache.get(rel);
  let dims = null;
  try {
    const b = fs.readFileSync(path.join(ASSETS, rel.replace(/^\/assets\//, "")));
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (b.slice(0, 8).equals(sig)) dims = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch (e) {}
  dimsCache.set(rel, dims);
  return dims;
}

/* 글이 자기 카드를 가지고 있으면 그것을, 없으면 사이트 공용 카드를 씁니다.
   카드를 아직 안 만든 글도 빈 미리보기로 나가지 않도록 하는 안전장치입니다.
   (새 글을 쓰고 npm run og 를 아직 안 돌린 상태가 여기에 해당합니다) */
function cardFor(lang, slug) {
  const rel = ogCardPath(lang, slug);
  if (fs.existsSync(path.join(ASSETS, rel.replace(/^\/assets\//, "")))) return rel;
  return site.ogImage;
}

/* ---------- layout ---------- */
/* JSON-LD 를 <script> 안에 안전하게 넣기 — 본문에 </script> 가 섞여도 태그가 깨지지 않도록 < 를 이스케이프 */
function jsonLdTag(obj) {
  if (!obj) return "";
  const json = JSON.stringify(obj).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>\n`;
}

function layout({ lang, title, description, canonical, langAltHref, active, body, autoLang, noAlt, ogType, published, jsonLd, card }) {
  const t = T[lang];
  const isEn = lang === "en";
  // hreflang: 검색엔진에 "같은 글의 다른 언어판"을 알려 각 언어권에 맞는 페이지가 노출되게 함
  const koHref = isEn ? langAltHref : canonical;
  const enHref = isEn ? canonical : langAltHref;
  /* x-default 는 한국어도 영어도 아닌 방문자가 갈 곳입니다(독일어·일본어 등).
     영어를 기본으로 둡니다. 해외 유입을 주로 보고 있고, 제3언어권 방문자에게는
     읽지 못하는 한국어보다 영어가 낫기 때문입니다.
     한국어 사용자는 hreflang="ko" 를 따라가므로 이 값에 영향받지 않습니다. */
  const altLinks = noAlt
    ? ""
    : `<link rel="alternate" hreflang="ko" href="${site.url}${koHref}">
<link rel="alternate" hreflang="en" href="${site.url}${enHref}">
<link rel="alternate" hreflang="x-default" href="${site.url}${enHref}">
`;
  /* 공유 카드 이미지. site.json 의 ogImage 에 경로(예: "/assets/og.png")를 채우면 활성화됩니다.
     이미지가 없는데 summary_large_image 를 선언하면 SNS에서 빈 카드가 뜨므로,
     이미지가 있을 때만 큰 카드를 쓰고 없으면 summary 로 낮춥니다. */
  const cardSrc = card || site.ogImage;
  const dims = cardSrc ? pngDims(cardSrc) : null;
  const ogImage = cardSrc
    ? `<meta property="og:image" content="${site.url}${cardSrc}">
<meta property="og:image:alt" content="${esc(title || site.brand)}">
${dims ? `<meta property="og:image:width" content="${dims.w}">
<meta property="og:image:height" content="${dims.h}">
` : ""}<meta name="twitter:image" content="${site.url}${cardSrc}">
`
    : "";
  const homeHref = isEn ? "/en/" : "/";
  const aboutHref = isEn ? "/en/about/" : "/about/";
  const fullTitle = title ? `${title} · ${site.brand}` : `${site.brand} · ${isEn ? site.taglineEn : site.taglineKo}`;
  const desc = description || (isEn ? site.descriptionEn : site.descriptionKo);
  return `<!doctype html>
<html lang="${isEn ? "en" : "ko"}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${site.url}${canonical}">
<meta name="author" content="${esc(site.author)}">
<meta property="og:type" content="${ogType || "website"}">
<meta property="og:site_name" content="${esc(site.brand)}">
<meta property="og:locale" content="${isEn ? "en_US" : "ko_KR"}">
<meta property="og:locale:alternate" content="${isEn ? "ko_KR" : "en_US"}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${site.url}${canonical}">
${published ? `<meta property="article:published_time" content="${published}">
<meta property="article:author" content="${esc(site.author)}">
` : ""}${ogImage}<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
${altLinks}<link rel="alternate" type="application/rss+xml" title="${site.brand}" href="/feed.xml">
<link rel="icon" href="/assets/favicon.svg">
<link rel="stylesheet" href="/assets/style.css">
${jsonLdTag(jsonLd)}${autoLang ? LANG_REDIRECT : ""}
${THEME_SCRIPT}
</head>
<body>
<header class="site-header"><div class="wrap">
  <a class="brand" href="${homeHref}">${LOGO}<span>codechains</span></a>
  <nav class="nav">
    <a href="${homeHref}">${t.home}</a>
    <a href="${aboutHref}">${t.nav_about}</a>
    <span class="sep"></span>
    <a id="langLink" data-lang="${isEn ? "ko" : "en"}" href="${langAltHref}" title="${t.langAlt}">${t.langAlt}</a>
    <button class="iconbtn" id="themeBtn" aria-label="theme">☀</button>
  </nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="site-footer"><div class="wrap">
  <span>© ${String(site.author)} · ${isEn ? "Built with care" : "코드체인"}</span>
  <span class="foot-links">
    <a href="/feed.xml">RSS</a>
  </span>
</div></footer>
${THEME_TOGGLE_JS}
${LANG_REMEMBER_JS}
${NEWSLETTER_ENABLED ? SUBSCRIBE_JS : ""}
</body>
</html>`;
}

/* 뉴스레터 구독 노출 스위치.
   구독 서비스를 실제로 시작할 때 true 로 바꾸면 홈·소개·글 하단에 다시 나타납니다.
   (마크업·문구·스크립트는 그대로 보존돼 있어 되돌리는 데 이 한 줄이면 됩니다) */
const NEWSLETTER_ENABLED = false;

/* 글 끝 연락 한 줄 노출 스위치.
   읽고 마음이 움직인 사람이 갈 곳이 없으면 그대로 닫고 나갑니다. 그래서 한 줄만 둡니다.
   판매 문구를 붙이지 않는 이유는, 이 글들이 읽히는 이유가 광고가 아니라 기록이기 때문입니다.
   문구를 고치려면 T 의 contact 를 손보세요. */
const CONTACT_ENABLED = true;

/* 광고 영역 노출 스위치.
   애드센스 승인 후 true 로 바꾸면 글 하단에 자리가 다시 생깁니다.
   그때 buildPost 의 .ad-slot 를 <ins class="adsbygoogle"> 코드로 교체하세요. */
const ADS_ENABLED = false;

function newsletter(lang) {
  if (!NEWSLETTER_ENABLED) return "";
  const t = T[lang];
  return `<section class="newsletter">
  <h3>${t.nl_h}</h3>
  <p>${t.nl_p}</p>
  <form class="subscribe" id="subForm" action="#" method="post">
    <input type="email" placeholder="${t.nl_ph}" aria-label="email" required>
    <button class="btn btn-primary" type="submit">${t.nl_btn}</button>
  </form>
  <p id="subNote" style="display:none;margin-top:.8rem;color:var(--accent-2);font-size:.9rem">${t.nl_note}</p>
</section>`;
}

/* ---------- 저자 ----------
   글 끝에 "누가 썼는가"를 사람이 볼 수 있게 남깁니다.
   구글 E-E-A-T(경험·전문성·권위·신뢰) 신호이자, 일반적인 글의 형식이기도 합니다.
   같은 정보를 JSON-LD 의 author 로도 내보내 크롤러가 사람과 글을 연결할 수 있게 합니다. */
const authorBio = (lang) => (lang === "en" ? site.authorBioEn : site.authorBioKo) || "";

/* 다른 언어판이 있다는 것을 눈에 보이게 알립니다. 자동 이동을 없앤 자리를 채우는 장치입니다.
   문구는 읽는 사람이 아는 언어로 씁니다. 한국어 화면에는 영어로, 영어 화면에는 한국어로.
   그래야 자기가 못 읽는 화면에 떨어진 사람이 이 줄만은 알아봅니다. */
function langNotice(lang) {
  const isEn = lang === "en";
  return `<p class="lang-notice">
  <span>${isEn ? "이 사이트는 한국어로도 읽을 수 있습니다." : "This site is also available in English."}</span>
  <a data-lang="${isEn ? "ko" : "en"}" href="${isEn ? "/" : "/en/"}">${isEn ? "한국어로 보기" : "Read in English"} →</a>
</p>`;
}

function contactLine(lang) {
  if (!CONTACT_ENABLED) return "";
  return `<p class="post-contact">${T[lang].contact} <a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>`;
}

function authorCard(lang) {
  const t = T[lang];
  const aboutHref = lang === "en" ? "/en/about/" : "/about/";
  return `<aside class="author-card">
  <div class="author-avatar" aria-hidden="true">${LOGO}</div>
  <div class="author-body">
    <p class="author-label">${t.author_label}</p>
    <p class="author-name">${esc(site.author)}</p>
    <p class="author-bio">${esc(authorBio(lang))}</p>
    <p class="author-links">
      <a href="${aboutHref}">${t.author_more}</a>
    </p>
  </div>
</aside>`;
}

/* ---------- 구조화 데이터 (schema.org) ---------- */
const PUBLISHER = {
  "@type": "Organization",
  name: site.brand,
  url: site.url,
  logo: { "@type": "ImageObject", url: `${site.url}/assets/favicon.svg` },
};
const AUTHOR = { "@type": "Person", name: site.author, url: site.url };
const authorNode = (lang) => ({
  ...AUTHOR,
  description: authorBio(lang),
  email: `mailto:${site.email}`,
  sameAs: [site.github],
});

function postJsonLd(post, lang, canonical) {
  const iso = post.stamp;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description || "",
    inLanguage: lang === "en" ? "en" : "ko",
    datePublished: iso,
    dateModified: iso,
    author: authorNode(lang),
    publisher: PUBLISHER,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${site.url}${canonical}` },
    url: `${site.url}${canonical}`,
    ...((post.tags || []).length ? { keywords: post.tags.join(", ") } : {}),
    ...(cardFor(lang, post.slug) ? { image: `${site.url}${cardFor(lang, post.slug)}` } : {}),
  };
}

function postListItems(posts, lang) {
  const base = lang === "en" ? "/en/posts/" : "/posts/";
  return posts
    .map((p) => {
      const tags = (p.tags || []).map((x) => `<span class="tag">${esc(x)}</span>`).join("");
      return `<li><a class="post-item" href="${base}${p.slug}/">
      <time datetime="${p.date}">${fmtDate(p.date, lang)}</time>
      <h2>${esc(p.title)}</h2>
      <p>${esc(p.description || "")}</p>
      ${tags ? `<div class="tags">${tags}</div>` : ""}
    </a></li>`;
    })
    .join("\n");
}

/* ---------- pages ---------- */
function buildHome(lang, posts) {
  const t = T[lang];
  const isEn = lang === "en";
  const tagline = isEn ? site.taglineEn : site.taglineKo;
  const intro = isEn
    ? "The journey of moving into AI, built and documented in the open, one link at a time."
    : "AI로 일하는 방식으로 전환하는 여정을, 공개된 곳에서 하나씩 이어 붙여 기록합니다.";
  const body = `${langNotice(lang)}
<section class="hero">
  <h1>${isEn ? "Chaining code into a<br><span class=\"grad\">new career.</span>" : "이어 붙인 기록이,<br><span class=\"grad\">커리어가 된다.</span>"}</h1>
  <p>${esc(tagline)}</p>
  <div class="cta">
    <a class="btn btn-primary" href="${isEn ? "/en/about/" : "/about/"}">${isEn ? "About me" : "소개 보기"}</a>
    <a class="btn btn-ghost" href="#latest">${isEn ? "Read posts" : "글 읽기"}</a>
  </div>
</section>
<h2 class="section-title" id="latest">${t.latest}</h2>
<ul class="postlist">
${postListItems(posts, lang)}
</ul>
${newsletter(lang)}`;
  const canonical = isEn ? "/en/" : "/";
  const langAlt = isEn ? "/" : "/en/";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: site.brand,
    url: `${site.url}${canonical}`,
    description: intro,
    inLanguage: isEn ? "en" : "ko",
    author: AUTHOR,
    publisher: PUBLISHER,
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `${site.url}${isEn ? "/en/posts/" : "/posts/"}${p.slug}/`,
      datePublished: p.stamp,
    })),
  };
  // 자동 언어 분기는 기본 진입점인 한국어 홈(/)에서만. 깊은 링크나 /en/ 은 방문자의 의도로 보고 건드리지 않음
  return layout({ lang, title: "", description: intro, canonical, langAltHref: langAlt, active: "home", body, autoLang: !isEn, jsonLd });
}

function buildAbout(lang) {
  const isEn = lang === "en";
  const file = isEn ? path.join(CONTENT, "en", "about.md") : path.join(CONTENT, "about.md");
  const parsed = fm(read(file));
  const body = `<article class="article">
  <div class="article-head"><h1>${esc(parsed.attributes.title)}</h1></div>
  <div class="prose">${marked.parse(parsed.body)}</div>
</article>
${newsletter(lang)}`;
  const canonical = isEn ? "/en/about/" : "/about/";
  const langAlt = isEn ? "/about/" : "/en/about/";
  // 소개 페이지는 인물 정보로 표시 — 검색에서 사람을 찾는 경로(협업·기회 제안)를 열어둠
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: `${site.url}${canonical}`,
    inLanguage: isEn ? "en" : "ko",
    mainEntity: {
      ...AUTHOR,
      email: `mailto:${site.email}`,
      description: parsed.attributes.description || "",
      sameAs: [site.github],
    },
  };
  return layout({ lang, title: parsed.attributes.title, description: parsed.attributes.description, canonical, langAltHref: langAlt, active: "about", body, jsonLd });
}

function buildPost(lang, post) {
  const t = T[lang];
  const isEn = lang === "en";
  const tags = (post.tags || []).map((x) => `<span class="tag">${esc(x)}</span>`).join("");
  const body = `<article class="article">
  <div class="article-head">
    <p class="article-meta">
      <time datetime="${post.date}">${fmtDate(post.date, lang)}</time>
      <span class="dot" aria-hidden="true">·</span>
      <a class="byline" href="${isEn ? "/en/about/" : "/about/"}" rel="author">${esc(site.author)}</a>
    </p>
    <h1>${esc(post.title)}</h1>
    ${tags ? `<div class="tags" style="margin-top:.8rem">${tags}</div>` : ""}
  </div>
  <div class="prose">${post.bodyHtml}</div>
  ${authorCard(lang)}
  ${contactLine(lang)}
  ${ADS_ENABLED ? `<div class="ad-slot">${t.ad}</div>` : ""}
  <a class="backlink" href="${isEn ? "/en/" : "/"}">${t.back}</a>
</article>
${newsletter(lang)}`;
  const canonical = `${isEn ? "/en/posts/" : "/posts/"}${post.slug}/`;
  const langAlt = `${isEn ? "/posts/" : "/en/posts/"}${post.slug}/`;
  return layout({
    lang, title: post.title, description: post.description, canonical, langAltHref: langAlt, active: "home", body,
    ogType: "article",
    published: post.stamp,
    card: cardFor(lang, post.slug), // 글마다 제목이 박힌 카드. 없으면 공용 카드로 내려갑니다
    jsonLd: postJsonLd(post, lang, canonical),
  });
}

/* ---------- feeds ---------- */
function buildFeed(posts) {
  const items = posts.slice(0, 20).map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${site.url}/posts/${p.slug}/</link>
    <guid>${site.url}/posts/${p.slug}/</guid>
    <pubDate>${new Date(p.stamp).toUTCString()}</pubDate>
    <description>${esc(p.description || "")}</description>
  </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(site.brand)}</title>
  <link>${site.url}/</link>
  <description>${esc(site.descriptionKo)}</description>
  <language>ko</language>
${items}
</channel></rss>`;
}
// 네임스페이스는 반드시 sitemaps.org (복수형). 오타가 나면 Search Console이 사이트맵을 통째로 거부합니다.
function buildSitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
    .map(({ loc, lastmod }) =>
      `  <url><loc>${site.url}${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`)
    .join("\n")}
</urlset>`;
}
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0e1116"/><path d="M12.5 19.5l7-7" stroke="#6ee7b7" stroke-width="2.4" stroke-linecap="round"/><path d="M14.8 9.2l1.7-1.7a4.6 4.6 0 016.5 6.5l-1.7 1.7" stroke="#7aa2ff" stroke-width="2.4" stroke-linecap="round"/><path d="M17.2 22.8l-1.7 1.7a4.6 4.6 0 01-6.5-6.5l1.7-1.7" stroke="#6ee7b7" stroke-width="2.4" stroke-linecap="round"/></svg>`;

/* ---------- run ---------- */
const assetCount = copyAssets();
const koAll = loadPosts(path.join(CONTENT, "posts"));
const enAll = loadPosts(path.join(CONTENT, "en", "posts"));
const koPosts = published(koAll);
const enPosts = published(enAll);
// 초안은 검사 대상이 아닙니다(아직 다듬는 중이므로). 공개되는 글만 봅니다.
const koSeo = checkSeo(koPosts, "ko");
const enSeo = checkSeo(enPosts, "en");
reportSeo([koSeo, enSeo]);
const urls = [];
// 홈·목록의 lastmod 는 가장 최근 글의 날짜로 — 새 글이 나가면 크롤러가 다시 훑도록
const latestKo = koPosts[0] && koPosts[0].date;
const latestEn = enPosts[0] && enPosts[0].date;

write("index.html", buildHome("ko", koPosts)); urls.push({ loc: "/", lastmod: latestKo });
write("about/index.html", buildAbout("ko")); urls.push({ loc: "/about/" });
koPosts.forEach((p) => { write(`posts/${p.slug}/index.html`, buildPost("ko", p)); urls.push({ loc: `/posts/${p.slug}/`, lastmod: p.date }); });

write("en/index.html", buildHome("en", enPosts)); urls.push({ loc: "/en/", lastmod: latestEn });
write("en/about/index.html", buildAbout("en")); urls.push({ loc: "/en/about/" });
enPosts.forEach((p) => { write(`en/posts/${p.slug}/index.html`, buildPost("en", p)); urls.push({ loc: `/en/posts/${p.slug}/`, lastmod: p.date }); });

write("feed.xml", buildFeed(koPosts));
write("sitemap.xml", buildSitemap(urls));
// assets/favicon.svg 를 직접 두면 그걸 쓰고, 없으면 기본 파비콘을 생성.
if (!fs.existsSync(path.join(ASSETS, "favicon.svg"))) write("assets/favicon.svg", FAVICON);
write("404.html", layout({ lang: "ko", title: "404", description: "페이지를 찾을 수 없습니다.", canonical: "/404.html", langAltHref: "/en/", active: "", noAlt: true, body: `<section class="hero"><h1>404</h1><p>이 링크는 아직 사슬에 없네요.</p><div class="cta"><a class="btn btn-primary" href="/">홈으로</a></div></section>` }));
write(".nojekyll", "");
// 커스텀 도메인은 site.json의 customDomain이 채워졌을 때만 생성.
// (DNS 연결 전에 CNAME이 있으면 github.io 접속이 깨질 수 있음)
if (site.customDomain) write("CNAME", site.customDomain + "\n");
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);

/* ---------- 로컬 전용 콘텐츠 관리 페이지 ----------
   기본은 "만든다" 입니다. 배포 빌드일 때만 만들지 않고, 남아 있던 것도 지웁니다.

   반대로(배포가 기본, 로컬은 옵션) 두면 npm run build 처럼 평범한 로컬 빌드가
   관리 페이지를 지워버려서, 새로고침해도 안 보이는 일이 계속 생깁니다.
   배포 경로는 GitHub Actions 하나뿐이고 그쪽은 아래 두 조건에 모두 걸리므로,
   기본값을 로컬 쪽에 맞추는 편이 안전하면서 덜 헷갈립니다.
   sitemap·feed 에는 어느 경우에도 넣지 않습니다. */
const DEPLOY = process.env.CC_DEPLOY === "1" || process.env.CI === "true";
const ADMIN = !DEPLOY;
const ADMIN_DIR = path.join(OUT, "admin");
if (ADMIN) {
  const { buildAdmin } = require("./admin");
  write("admin/index.html", buildAdmin({
    koAll,
    enAll,
    issuesBySlug: { ko: koSeo.bySlug, en: enSeo.bySlug },
    contentDir: CONTENT,
    builtAt: new Date().toLocaleString("ko-KR"),
    // 파일 열기 링크의 기본 프로토콜. 화면의 선택 상자로도 바꿀 수 있습니다.
    editor: process.env.CC_EDITOR || "cursor",
  }));
} else if (fs.existsSync(ADMIN_DIR)) {
  // 배포용 빌드에서는 이전에 만들어 둔 관리 페이지를 지웁니다(실수로 공개되는 경로를 아예 없앰)
  fs.rmSync(ADMIN_DIR, { recursive: true, force: true });
}

const draftCount = (koAll.length - koPosts.length) + (enAll.length - enPosts.length);
console.log(
  `Built ${koPosts.length} KO + ${enPosts.length} EN posts, ${urls.length} URLs, ${assetCount} asset file(s) copied.` +
  (draftCount ? ` (초안 ${draftCount}개 제외)` : "") +
  (ADMIN ? ` 관리 페이지: http://localhost:${process.env.PORT || 4000}/admin/` : " (배포 빌드: 관리 페이지 제외)")
);
