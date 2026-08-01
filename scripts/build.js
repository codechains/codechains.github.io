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
function fmtDate(iso, lang) {
  const [y, m, d] = iso.split("-").map(Number);
  if (lang === "en") {
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${months[m - 1]} ${d}, ${y}`;
  }
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
}
function loadPosts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const parsed = fm(read(path.join(dir, f)));
      return {
        slug: slugOf(f),
        ...parsed.attributes,
        date: normDate(parsed.attributes.date),
        bodyHtml: marked.parse(parsed.body),
      };
    })
    .filter((p) => !p.draft) // draft: true → 공개 안 함(버전 관리는 됨)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LOGO = `<svg class="logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12.5 19.5l7-7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/><path d="M14.8 9.2l1.7-1.7a4.6 4.6 0 016.5 6.5l-1.7 1.7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/><path d="M17.2 22.8l-1.7 1.7a4.6 4.6 0 01-6.5-6.5l1.7-1.7" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round"/><defs><linearGradient id="g" x1="6" y1="8" x2="26" y2="24" gradientUnits="userSpaceOnUse"><stop stop-color="#6ee7b7"/><stop offset="1" stop-color="#7aa2ff"/></linearGradient></defs></svg>`;

const THEME_SCRIPT = `<script>(function(){try{var t=localStorage.getItem('cc-theme');if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();</script>`;
const THEME_TOGGLE_JS = `<script>(function(){var b=document.getElementById('themeBtn');if(!b)return;function cur(){return document.documentElement.getAttribute('data-theme')||'dark';}function set(v){document.documentElement.setAttribute('data-theme',v);try{localStorage.setItem('cc-theme',v);}catch(e){}b.textContent=v==='dark'?'☀':'☾';}b.textContent=cur()==='dark'?'☀':'☾';b.addEventListener('click',function(){set(cur()==='dark'?'light':'dark');});})();</script>`;
const SUBSCRIBE_JS = `<script>(function(){var f=document.getElementById('subForm');if(!f)return;f.addEventListener('submit',function(e){e.preventDefault();var n=document.getElementById('subNote');if(n)n.style.display='block';});})();</script>`;

const T = {
  ko: { nav_about: "소개", home: "홈", posts: "글", langAlt: "EN", nl_h: "새 글을 이메일로 받아보기", nl_p: "AI 트랜스폼 여정의 새 글을 가장 먼저 받아보세요. 스팸은 없습니다.", nl_btn: "구독", nl_ph: "이메일 주소", nl_note: "구독 기능은 곧 연결됩니다. 우선 hello@codechains.dev 로 연락 주셔도 좋아요!", ad: "광고 영역 (애드센스 승인 후 표시됩니다)", latest: "최근 글", back: "← 목록으로", readmore: "읽기" },
  en: { nav_about: "About", home: "Home", posts: "Posts", langAlt: "한국어", nl_h: "Get new posts by email", nl_p: "Be first to read new posts from the AI transformation journey. No spam.", nl_btn: "Subscribe", nl_ph: "your email", nl_note: "Subscriptions are being wired up. For now, reach me at hello@codechains.dev!", ad: "Ad slot (shown after AdSense approval)", latest: "Latest posts", back: "← All posts", readmore: "Read" },
};

/* ---------- layout ---------- */
function layout({ lang, title, description, canonical, langAltHref, active, body }) {
  const t = T[lang];
  const isEn = lang === "en";
  const homeHref = isEn ? "/en/" : "/";
  const aboutHref = isEn ? "/en/about/" : "/about/";
  const fullTitle = title ? `${title} · ${site.brand}` : `${site.brand} — ${isEn ? site.taglineEn : site.taglineKo}`;
  const desc = description || (isEn ? site.descriptionEn : site.descriptionKo);
  const adBlock = `<div class="ad-slot">${t.ad}</div>\n<!-- AdSense: 승인 후 아래에 <ins class="adsbygoogle"> 코드를 넣고 위 .ad-slot 문구를 교체하세요. -->`;
  return `<!doctype html>
<html lang="${isEn ? "en" : "ko"}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${site.url}${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${site.url}${canonical}">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/rss+xml" title="${site.brand}" href="/feed.xml">
<link rel="icon" href="/assets/favicon.svg">
<link rel="stylesheet" href="/assets/style.css">
${THEME_SCRIPT}
</head>
<body>
<header class="site-header"><div class="wrap">
  <a class="brand" href="${homeHref}">${LOGO}<span>codechains</span></a>
  <nav class="nav">
    <a href="${homeHref}">${t.home}</a>
    <a href="${aboutHref}">${t.nav_about}</a>
    <span class="sep"></span>
    <a href="${langAltHref}" title="${t.langAlt}">${t.langAlt}</a>
    <button class="iconbtn" id="themeBtn" aria-label="theme">☀</button>
  </nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="site-footer"><div class="wrap">
  <span>© ${String(site.author)} · ${isEn ? "Built with care" : "코드체인"}</span>
  <span class="foot-links">
    <a href="mailto:${site.email}">Email</a>
    <a href="${site.github}">GitHub</a>
    <a href="/feed.xml">RSS</a>
  </span>
</div></footer>
${THEME_TOGGLE_JS}
${SUBSCRIBE_JS}
</body>
</html>`;
}

function newsletter(lang) {
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

function postListItems(posts, lang) {
  const base = lang === "en" ? "/en/posts/" : "/posts/";
  return posts
    .map((p) => {
      const tags = (p.tags || []).map((x) => `<span class="tag">${esc(x)}</span>`).join("");
      return `<li><a class="post-item" href="${base}${p.slug}/">
      <time>${fmtDate(p.date, lang)}</time>
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
    ? "The journey of moving into AI — built and documented in the open, one link at a time."
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
  return layout({ lang, title: "", description: intro, canonical, langAltHref: langAlt, active: "home", body });
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
  return layout({ lang, title: parsed.attributes.title, description: parsed.attributes.description, canonical, langAltHref: langAlt, active: "about", body });
}

function buildPost(lang, post) {
  const t = T[lang];
  const isEn = lang === "en";
  const tags = (post.tags || []).map((x) => `<span class="tag">${esc(x)}</span>`).join("");
  const body = `<article class="article">
  <div class="article-head">
    <time>${fmtDate(post.date, lang)}</time>
    <h1>${esc(post.title)}</h1>
    ${tags ? `<div class="tags" style="margin-top:.8rem">${tags}</div>` : ""}
  </div>
  <div class="prose">${post.bodyHtml}</div>
  ${(function(){return `<div class="ad-slot">${t.ad}</div>`;})()}
  <a class="backlink" href="${isEn ? "/en/" : "/"}">${t.back}</a>
</article>
${newsletter(lang)}`;
  const canonical = `${isEn ? "/en/posts/" : "/posts/"}${post.slug}/`;
  const langAlt = `${isEn ? "/posts/" : "/en/posts/"}${post.slug}/`;
  return layout({ lang, title: post.title, description: post.description, canonical, langAltHref: langAlt, active: "home", body });
}

/* ---------- feeds ---------- */
function buildFeed(posts) {
  const items = posts.slice(0, 20).map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${site.url}/posts/${p.slug}/</link>
    <guid>${site.url}/posts/${p.slug}/</guid>
    <pubDate>${new Date(p.date + "T09:00:00+09:00").toUTCString()}</pubDate>
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
function buildSitemap(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${site.url}${u}</loc></url>`).join("\n")}
</urlset>`;
}
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0e1116"/><path d="M12.5 19.5l7-7" stroke="#6ee7b7" stroke-width="2.4" stroke-linecap="round"/><path d="M14.8 9.2l1.7-1.7a4.6 4.6 0 016.5 6.5l-1.7 1.7" stroke="#7aa2ff" stroke-width="2.4" stroke-linecap="round"/><path d="M17.2 22.8l-1.7 1.7a4.6 4.6 0 01-6.5-6.5l1.7-1.7" stroke="#6ee7b7" stroke-width="2.4" stroke-linecap="round"/></svg>`;

/* ---------- run ---------- */
const assetCount = copyAssets();
const koPosts = loadPosts(path.join(CONTENT, "posts"));
const enPosts = loadPosts(path.join(CONTENT, "en", "posts"));
const urls = [];

urls.push(write("index.html", buildHome("ko", koPosts)) && "/");
urls.push(write("about/index.html", buildAbout("ko")) && "/about/");
koPosts.forEach((p) => { write(`posts/${p.slug}/index.html`, buildPost("ko", p)); urls.push(`/posts/${p.slug}/`); });

write("en/index.html", buildHome("en", enPosts)); urls.push("/en/");
write("en/about/index.html", buildAbout("en")); urls.push("/en/about/");
enPosts.forEach((p) => { write(`en/posts/${p.slug}/index.html`, buildPost("en", p)); urls.push(`/en/posts/${p.slug}/`); });

write("feed.xml", buildFeed(koPosts));
write("sitemap.xml", buildSitemap(urls));
// assets/favicon.svg 를 직접 두면 그걸 쓰고, 없으면 기본 파비콘을 생성.
if (!fs.existsSync(path.join(ASSETS, "favicon.svg"))) write("assets/favicon.svg", FAVICON);
write("404.html", layout({ lang: "ko", title: "404", description: "페이지를 찾을 수 없습니다.", canonical: "/404.html", langAltHref: "/en/", active: "", body: `<section class="hero"><h1>404</h1><p>이 링크는 아직 사슬에 없네요.</p><div class="cta"><a class="btn btn-primary" href="/">홈으로</a></div></section>` }));
write(".nojekyll", "");
// 커스텀 도메인은 site.json의 customDomain이 채워졌을 때만 생성.
// (DNS 연결 전에 CNAME이 있으면 github.io 접속이 깨질 수 있음)
if (site.customDomain) write("CNAME", site.customDomain + "\n");
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);

console.log(`Built ${koPosts.length} KO + ${enPosts.length} EN posts, ${urls.length} URLs, ${assetCount} asset file(s) copied.`);
