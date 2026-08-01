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

const ROOT = path.join(__dirname, "..");
const CONTENT = path.join(ROOT, "content");
const ASSETS = path.join(ROOT, "assets"); // 커밋되는 정적 원본(css 등) → site/assets/ 로 복사
const OUT = path.join(ROOT, "site");
const site = JSON.parse(fs.readFileSync(path.join(CONTENT, "site.json"), "utf8"));

marked.setOptions({ gfm: true, breaks: false });

/* ---------- helpers ---------- */
const read = (p) => fs.readFileSync(p, "utf8");
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

function slugOf(file) {
  return file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
}
function normDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
/* 발행 시각. 목록 정렬과 RSS·구조화 데이터의 시각이 모두 이 값을 씁니다.

   date 에 날짜만 적으면(2026-08-01) 그날 오전 9시로 봅니다.
   같은 날에 두 편 이상 낼 때는 시각까지 적으면 나중 시각이 위로 옵니다.
     date: 2026-08-01 14:00:00 +09:00
   파일 수정시각이나 git 이력을 쓰지 않는 이유는, 배포 서버가 저장소를 새로 받아갈 때
   그 값들이 전부 초기화되어 로컬과 배포본의 순서가 달라지기 때문입니다. */
function normStamp(v, isoDate) {
  const raw = v instanceof Date ? v.toISOString() : String(v).trim().replace(" ", "T");
  const hasTime = /T\d{2}:\d{2}/.test(raw) && !/T00:00:00(\.000)?Z?$/.test(raw);
  return hasTime ? raw : `${isoDate}T09:00:00+09:00`;
}
function fmtDate(iso, lang) {
  const [y, m, d] = iso.split("-").map(Number);
  if (lang === "en") {
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${months[m - 1]} ${d}, ${y}`;
  }
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
}
/* 초안까지 포함한 전체 글을 최신순으로 읽습니다.
   공개용으로 쓸 때는 published() 로 한 번 걸러서 씁니다.
   (초안도 읽는 이유: 로컬 관리 페이지가 "아직 안 낸 글"을 보여줘야 하기 때문) */
function loadPosts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const parsed = fm(read(path.join(dir, f)));
      const date = normDate(parsed.attributes.date);
      return {
        slug: slugOf(f),
        file: f, // 원본 파일명. 관리 페이지에서 이 파일을 바로 열기 위해 남깁니다.
        ...parsed.attributes,
        date,
        stamp: normStamp(parsed.attributes.date, date),
        rawBody: parsed.body, // 검사용 원문(마크다운). 렌더링에는 bodyHtml 을 씁니다.
        bodyHtml: marked.parse(parsed.body),
      };
    })
    /* 나중에 발행한 글이 항상 위로. 시각이 완전히 같으면 파일명 역순으로 갈라
       로컬과 배포본이 같은 순서를 내도록 합니다(읽어들인 순서에 기대지 않음). */
    .sort((a, b) => (new Date(b.stamp) - new Date(a.stamp)) || String(b.file).localeCompare(String(a.file)));
}
const published = (posts) => posts.filter((p) => !p.draft); // draft: true → 공개 안 함(버전 관리는 됨)
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

/* 언어 자동 분기 — 한국어 홈(/)에서만 동작.
   1) 사용자가 언어 링크로 직접 고른 적이 있으면(cc-lang) 그 선택을 최우선으로 존중
   2) 선택 이력이 없으면 브라우저 언어(navigator.languages)를 보고 한국어가 아니면 /en/ 으로 이동
   국가(IP)가 아니라 언어 설정으로 판단합니다 — 해외의 한국인은 한국어를,
   국내의 외국인은 영어를 원하기 때문입니다.
   깜빡임을 없애려고 <head>에서 본문 렌더 전에 실행하고, 히스토리를 더럽히지 않도록 replace 를 씁니다. */
const LANG_REDIRECT = `<script>(function(){try{var p=localStorage.getItem('cc-lang');if(p==='ko')return;if(p==='en'){location.replace('/en/');return;}var l=navigator.languages||[navigator.language||''];for(var i=0;i<l.length;i++){if(/^ko/i.test(l[i]))return;}location.replace('/en/');}catch(e){}})();</script>`;

/* 언어 링크를 직접 눌렀을 때 그 선택을 기억 → 이후로는 자동 분기가 끼어들지 않음 */
const LANG_REMEMBER_JS = `<script>(function(){var a=document.getElementById('langLink');if(!a)return;a.addEventListener('click',function(){try{localStorage.setItem('cc-lang',a.getAttribute('data-lang'));}catch(e){}});})();</script>`;

const T = {
  ko: { nav_about: "소개", home: "홈", posts: "글", langAlt: "EN", author_label: "글쓴이", author_more: "소개 보기", nl_h: "새 글을 이메일로 받아보기", nl_p: "AI 트랜스폼 여정의 새 글을 가장 먼저 받아보세요. 스팸은 없습니다.", nl_btn: "구독", nl_ph: "이메일 주소", nl_note: "구독 기능은 곧 연결됩니다. 우선 hello@codechains.dev 로 연락 주셔도 좋아요!", ad: "광고 영역 (애드센스 승인 후 표시됩니다)", latest: "최근 글", back: "← 목록으로", readmore: "읽기" },
  en: { nav_about: "About", home: "Home", posts: "Posts", langAlt: "한국어", author_label: "Written by", author_more: "About me", nl_h: "Get new posts by email", nl_p: "Be first to read new posts from the AI transformation journey. No spam.", nl_btn: "Subscribe", nl_ph: "your email", nl_note: "Subscriptions are being wired up. For now, reach me at hello@codechains.dev!", ad: "Ad slot (shown after AdSense approval)", latest: "Latest posts", back: "← All posts", readmore: "Read" },
};

/* ---------- layout ---------- */
/* JSON-LD 를 <script> 안에 안전하게 넣기 — 본문에 </script> 가 섞여도 태그가 깨지지 않도록 < 를 이스케이프 */
function jsonLdTag(obj) {
  if (!obj) return "";
  const json = JSON.stringify(obj).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>\n`;
}

function layout({ lang, title, description, canonical, langAltHref, active, body, autoLang, noAlt, ogType, published, jsonLd }) {
  const t = T[lang];
  const isEn = lang === "en";
  // hreflang: 검색엔진에 "같은 글의 다른 언어판"을 알려 각 언어권에 맞는 페이지가 노출되게 함
  const koHref = isEn ? langAltHref : canonical;
  const enHref = isEn ? canonical : langAltHref;
  const altLinks = noAlt
    ? ""
    : `<link rel="alternate" hreflang="ko" href="${site.url}${koHref}">
<link rel="alternate" hreflang="en" href="${site.url}${enHref}">
<link rel="alternate" hreflang="x-default" href="${site.url}${koHref}">
`;
  /* 공유 카드 이미지. site.json 의 ogImage 에 경로(예: "/assets/og.png")를 채우면 활성화됩니다.
     이미지가 없는데 summary_large_image 를 선언하면 SNS에서 빈 카드가 뜨므로,
     이미지가 있을 때만 큰 카드를 쓰고 없으면 summary 로 낮춥니다. */
  const ogImage = site.ogImage
    ? `<meta property="og:image" content="${site.url}${site.ogImage}">
<meta property="og:image:alt" content="${esc(site.brand)}">
<meta name="twitter:image" content="${site.url}${site.ogImage}">
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
    ...(site.ogImage ? { image: `${site.url}${site.ogImage}` } : {}),
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
  const body = `<section class="hero">
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
   npm run dev (serve.js) 가 CC_ADMIN=1 을 넣어줄 때만 만듭니다.
   GitHub Actions 는 이 변수 없이 build.js 를 돌리므로 배포본에는 들어가지 않습니다.
   sitemap·feed 에도 넣지 않습니다. */
const ADMIN = process.env.CC_ADMIN === "1";
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
  (ADMIN ? ` 관리 페이지: http://localhost:${process.env.PORT || 4000}/admin/` : "")
);
