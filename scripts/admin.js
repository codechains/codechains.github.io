/* ============================================================
   codechains blog — 로컬 전용 콘텐츠 관리 페이지
   npm run dev 로 띄웠을 때만 생성되고, http://localhost:4000/admin 에서 봅니다.

   왜 로컬 전용인가:
   - 파일 열기 링크(vscode://)는 이 PC에서만 동작합니다.
   - 초안 제목과 로컬 파일 경로가 들어 있어 공개될 이유가 없습니다.
   배포용 빌드(node scripts/build.js)는 이 파일을 부르지 않으므로
   site/admin 은 배포 산출물에 아예 포함되지 않습니다.

   목록은 손으로 관리하지 않습니다. content/ 를 읽는 빌드가 매번 다시 그리므로
   글과 목록이 어긋날 수가 없습니다.
   ============================================================ */
const path = require("path");

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* 에디터에서 파일을 바로 여는 링크.
   cursor://file/C:/Users/.../content/posts/글.md 형태여야 하므로
   윈도우 역슬래시를 슬래시로 바꾸고, 공백·한글이 섞인 경로를 인코딩합니다.

   프로토콜은 설치된 에디터마다 다릅니다(Cursor 는 cursor://, VS Code 는 vscode://).
   등록되지 않은 프로토콜을 링크에 쓰면 클릭해도 아무 일이 일어나지 않으므로,
   경로만 data-path 에 담아두고 실제 href 는 화면에서 고른 에디터로 그때그때 만듭니다. */
const EDITORS = [
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "vscode-insiders", label: "VS Code Insiders" },
  { id: "windsurf", label: "Windsurf" },
];
const DEFAULT_EDITOR = "cursor";

let EDITOR = DEFAULT_EDITOR; // buildAdmin 이 시작할 때 실제 값으로 채웁니다

const uriPath = (absPath) => encodeURI(absPath.replace(/\\/g, "/"));
const editorHref = (absPath) => `${EDITOR}://file/${uriPath(absPath)}`;

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0e1116;color:#e6e9ef;font:14px/1.5 ui-sans-serif,system-ui,"Segoe UI","Malgun Gothic",sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:2rem 1.2rem 4rem}
h1{font-size:1.3rem;margin:0 0 .3rem}
.sub{color:#8b93a7;font-size:.85rem;margin:0 0 1.4rem}
.bar{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem;position:sticky;top:0;background:#0e1116;padding:.8rem 0;z-index:2}
input[type=search]{flex:1;min-width:240px;background:#161b23;border:1px solid #262d3a;color:#e6e9ef;border-radius:8px;padding:.55rem .8rem;font:inherit}
input[type=search]:focus{outline:none;border-color:#7aa2ff}
.count{color:#8b93a7;font-size:.85rem;white-space:nowrap}
select{background:#161b23;border:1px solid #262d3a;color:#a7b0c2;border-radius:8px;padding:.5rem .55rem;font:inherit;font-size:.82rem}
select:focus{outline:none;border-color:#7aa2ff}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:.6rem .5rem;border-bottom:1px solid #1c222c;vertical-align:top}
th{color:#8b93a7;font-weight:500;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
td.n{color:#5c6478;font-variant-numeric:tabular-nums;width:3rem}
td.date{color:#a7b0c2;font-variant-numeric:tabular-nums;white-space:nowrap;width:6.5rem}
.title{color:#e6e9ef;text-decoration:none;font-weight:600}
.title:hover{color:#6ee7b7}
.desc{color:#6f7789;font-size:.8rem;margin-top:.2rem;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.slug{color:#5c6478;font-size:.76rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
a.edit{display:inline-block;color:#7aa2ff;text-decoration:none;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.78rem;white-space:nowrap}
a.edit:hover{text-decoration:underline}
.badge{display:inline-block;padding:.1rem .45rem;border-radius:5px;font-size:.72rem;white-space:nowrap;margin-right:.25rem}
.b-live{background:#12301f;color:#6ee7b7}
.b-draft{background:#3a2a10;color:#f0c674}
.b-ok{background:#1a2233;color:#7aa2ff}
.b-none{background:#241a1f;color:#c98b9b}
.warn{color:#f0c674;font-size:.76rem;margin-top:.25rem}
.err{color:#ff8f8f;font-size:.76rem;margin-top:.25rem}
.tags{margin-top:.3rem}
.tag{display:inline-block;background:#161b23;color:#8b93a7;border-radius:5px;padding:.05rem .4rem;font-size:.72rem;margin-right:.25rem}
h2.sec{font-size:.95rem;color:#a7b0c2;margin:2.4rem 0 .6rem}
.empty{color:#5c6478;padding:2rem 0}
.pager{display:flex;gap:.3rem;align-items:center;flex-wrap:wrap;margin-top:1.1rem}
.pager button{background:#161b23;border:1px solid #262d3a;color:#a7b0c2;border-radius:6px;padding:.35rem .62rem;font:inherit;font-size:.82rem;font-variant-numeric:tabular-nums;cursor:pointer}
.pager button:hover:not(:disabled){border-color:#7aa2ff;color:#e6e9ef}
.pager button[aria-current=page]{background:#1a2233;border-color:#7aa2ff;color:#e6e9ef;font-weight:600}
.pager button:disabled{opacity:.35;cursor:default}
.pager .gap{color:#5c6478;padding:0 .15rem}
.pager .range{color:#8b93a7;font-size:.8rem;margin-left:auto;font-variant-numeric:tabular-nums}
footer{color:#5c6478;font-size:.78rem;margin-top:2.5rem;border-top:1px solid #1c222c;padding-top:1rem}
footer a{color:#7aa2ff}
`;

/* 검색 + 페이징.
   페이지는 "검색으로 걸러진 결과" 위에서 나뉩니다. 필터를 걸면 1페이지로 돌아갑니다.
   표가 둘일 수 있으므로(한국어 목록, 영문 전용 목록) 각 표가 자기 페이지를 따로 셉니다. */
const PAGE_SIZE = 50;

const CONTROL_JS = `<script>
(function(){
  var PAGE = ${PAGE_SIZE};
  var q = document.getElementById('q');
  var shown = document.getElementById('shown');
  var panels = [].slice.call(document.querySelectorAll('[data-panel]')).map(function(el){
    return {
      el: el,
      rows: [].slice.call(el.querySelectorAll('tr[data-search]')),
      pager: el.querySelector('.pager'),
      page: 1,
      matched: []
    };
  });

  // 페이지가 많아지면 처음·끝과 현재 주변만 남기고 접습니다
  function pageList(cur, last){
    var out = [], i;
    if (last <= 9){ for(i=1;i<=last;i++) out.push(i); return out; }
    var keep = {};
    keep[1] = 1; keep[last] = 1;
    for (i = cur-2; i <= cur+2; i++) if (i >= 1 && i <= last) keep[i] = 1;
    var nums = Object.keys(keep).map(Number).sort(function(a,b){ return a-b; });
    var prev = 0;
    nums.forEach(function(n){
      if (prev && n - prev > 1) out.push('gap');
      out.push(n);
      prev = n;
    });
    return out;
  }

  function render(p){
    var last = Math.max(1, Math.ceil(p.matched.length / PAGE));
    if (p.page > last) p.page = last;
    if (p.page < 1) p.page = 1;
    var start = (p.page - 1) * PAGE;

    p.rows.forEach(function(r){ r.style.display = 'none'; });
    p.matched.slice(start, start + PAGE).forEach(function(r){ r.style.display = ''; });

    if (last <= 1){ p.pager.innerHTML = ''; return; }
    var h = '<button data-go="' + (p.page-1) + '"' + (p.page === 1 ? ' disabled' : '') + '>← 이전</button>';
    pageList(p.page, last).forEach(function(x){
      h += x === 'gap'
        ? '<span class="gap">…</span>'
        : '<button data-go="' + x + '"' + (x === p.page ? ' aria-current="page"' : '') + '>' + x + '</button>';
    });
    h += '<button data-go="' + (p.page+1) + '"' + (p.page === last ? ' disabled' : '') + '>다음 →</button>';
    h += '<span class="range">' + (start+1) + '-' + Math.min(start+PAGE, p.matched.length) + ' / ' + p.matched.length + '개</span>';
    p.pager.innerHTML = h;
  }

  function apply(resetPage){
    var v = (q.value || '').trim().toLowerCase(), total = 0;
    panels.forEach(function(p){
      if (resetPage) p.page = 1;
      p.matched = v
        ? p.rows.filter(function(r){ return r.getAttribute('data-search').indexOf(v) !== -1; })
        : p.rows;
      total += p.matched.length;
      render(p);
    });
    shown.textContent = total;
  }

  panels.forEach(function(p){
    p.pager.addEventListener('click', function(e){
      var b = e.target.closest('button[data-go]');
      if (!b || b.disabled) return;
      p.page = Number(b.getAttribute('data-go'));
      render(p);
      // 페이지를 넘기면 표 머리로 되돌려, 목록 중간에서 시작하지 않게 합니다
      window.scrollTo({ top: Math.max(0, p.el.getBoundingClientRect().top + window.pageYOffset - 90), behavior: 'smooth' });
    });
  });

  q.addEventListener('input', function(){ apply(true); });
  apply(true);
  q.focus();

  /* 파일 열기 링크의 프로토콜.
     설치된 에디터에 맞는 것을 골라야 클릭이 먹습니다. 선택은 이 브라우저에 남습니다. */
  var KEY = 'cc-editor';
  var sel = document.getElementById('editor');
  var fallback = sel.value;
  try {
    var saved = localStorage.getItem(KEY);
    if (saved) {
      sel.value = saved;
      if (!sel.value) sel.value = fallback; // 예전에 저장된 값이 목록에 없으면 기본값으로
    }
  } catch (e) {}

  function applyEditor(){
    var scheme = sel.value;
    [].slice.call(document.querySelectorAll('a[data-path]')).forEach(function(a){
      a.href = scheme + '://file/' + a.getAttribute('data-path');
    });
    try { localStorage.setItem(KEY, scheme); } catch (e) {}
  }
  sel.addEventListener('change', applyEditor);
  applyEditor();
})();
</script>`;

/* 한 글을 표의 한 줄로. */
function row(p) {
  const tags = (p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  const search = [p.title, p.slug, p.file, p.description || "", (p.tags || []).join(" ")]
    .join(" ")
    .toLowerCase();

  const status = p.draft
    ? `<span class="badge b-draft">초안</span>`
    : `<span class="badge b-live">공개</span>`;
  const en = p.hasEn
    ? `<span class="badge b-ok">EN</span>`
    : `<span class="badge b-none">EN 없음</span>`;

  const issues = (p.issues || [])
    .map((i) => `<div class="${i.level === "error" ? "err" : "warn"}">${i.level === "error" ? "오류" : "경고"}: ${esc(i.msg)}</div>`)
    .join("");

  // 초안은 아직 페이지가 없으므로 제목에 링크를 걸지 않습니다(404 로 가지 않도록)
  const titleCell = p.draft
    ? `<span class="title">${esc(p.title || "(제목 없음)")}</span>`
    : `<a class="title" href="${p.url}" target="_blank" rel="noopener">${esc(p.title || "(제목 없음)")}</a>`;

  return `<tr data-search="${esc(search)}">
  <td class="n">${p.n}</td>
  <td class="date">${esc(p.date || "?")}</td>
  <td>
    ${titleCell}
    ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ""}
    ${tags ? `<div class="tags">${tags}</div>` : ""}
    ${issues}
  </td>
  <td>${status}${en}</td>
  <td><div class="slug">${esc(p.slug)}</div></td>
  <td>
    <a class="edit" data-path="${uriPath(p.koPath)}" href="${editorHref(p.koPath)}" title="에디터에서 열기">KO ${esc(p.file)}</a>
    ${p.hasEn ? `<br><a class="edit" data-path="${uriPath(p.enPath)}" href="${editorHref(p.enPath)}" title="에디터에서 열기">EN ${esc(p.file)}</a>` : ""}
  </td>
</tr>`;
}

/* 표 하나 = 페이징 단위 하나(data-panel).
   행은 전부 HTML 에 넣어두고 화면에 보이는 50개만 스크립트가 고릅니다.
   글이 수천 개가 되기 전까지는 이 방식이 가장 단순하고, 검색이 즉시 반응합니다. */
function table(rows) {
  const body = !rows.length
    ? `<p class="empty">글이 없습니다.</p>`
    : `<table>
<thead><tr><th>#</th><th>발행일</th><th>제목</th><th>상태</th><th>슬러그(URL)</th><th>파일 열기</th></tr></thead>
<tbody>
${rows.map(row).join("\n")}
</tbody></table>`;
  return `<div data-panel>${body}
<nav class="pager" aria-label="페이지"></nav>
</div>`;
}

/* ---------- 진입점 ----------
   koAll / enAll : 초안 포함 전체 글 (build.js 의 loadPosts 결과)
   issuesBySlug  : { ko: Map<slug, [{level,msg}]>, en: ... }  SEO 검사 결과 */
function buildAdmin({ koAll, enAll, issuesBySlug, contentDir, builtAt, editor }) {
  EDITOR = EDITORS.some((e) => e.id === editor) ? editor : DEFAULT_EDITOR;
  const koDir = path.join(contentDir, "posts");
  const enDir = path.join(contentDir, "en", "posts");
  const enBySlug = new Map(enAll.map((p) => [p.slug, p]));

  // 번호는 발행 순서(가장 오래된 글이 1번). 새 글이 나와도 기존 번호가 밀리지 않습니다.
  const total = koAll.length;
  const koRows = koAll.map((p, i) => ({
    ...p,
    n: total - i, // koAll 은 최신순 정렬
    hasEn: enBySlug.has(p.slug),
    url: `http://localhost:4000/posts/${p.slug}/`,
    koPath: path.join(koDir, p.file),
    enPath: path.join(enDir, p.file),
    issues: issuesBySlug.ko.get(p.slug) || [],
  }));

  // 한국어판 없이 영문만 있는 글 — 목록·홈 어디에도 짝이 없어 눈에 잘 띄지 않습니다
  const koSlugs = new Set(koAll.map((p) => p.slug));
  const orphanEn = enAll
    .filter((p) => !koSlugs.has(p.slug))
    .map((p, i) => ({
      ...p,
      n: i + 1,
      hasEn: false,
      url: `http://localhost:4000/en/posts/${p.slug}/`,
      koPath: path.join(enDir, p.file),
      enPath: path.join(enDir, p.file),
      issues: issuesBySlug.en.get(p.slug) || [],
    }));

  const drafts = koAll.filter((p) => p.draft).length;
  const live = total - drafts;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>콘텐츠 관리 · codechains</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <h1>콘텐츠 관리</h1>
  <p class="sub">
    로컬 전용 페이지입니다. 배포되지 않습니다.
    파일 열기를 누르면 VS Code 에서 해당 마크다운이 바로 열립니다.
    · 마지막 빌드 ${esc(builtAt)}
  </p>

  <div class="bar">
    <input id="q" type="search" placeholder="제목 · 슬러그 · 태그 · 설명으로 찾기" autocomplete="off">
    <select id="editor" title="파일 열기 링크가 어느 에디터로 갈지 고릅니다. 선택은 이 브라우저에 기억됩니다.">
      ${EDITORS.map((e) => `<option value="${e.id}"${e.id === EDITOR ? " selected" : ""}>${esc(e.label)} 로 열기</option>`).join("\n      ")}
    </select>
    <span class="count">검색 결과 <b id="shown">${total}</b> / 전체 ${total} (공개 ${live} · 초안 ${drafts}) · 한 페이지 ${PAGE_SIZE}개</span>
  </div>

  ${table(koRows)}

  ${orphanEn.length ? `<h2 class="sec">영문만 있는 글 (한국어판 없음)</h2>${table(orphanEn)}` : ""}

  <footer>
    새 글: <code>content/_post-template.md</code> 를 <code>content/posts/YYYY-MM-DD-슬러그.md</code> 로 복사
    · <a data-path="${uriPath(path.join(contentDir, "_post-template.md"))}" href="${editorHref(path.join(contentDir, "_post-template.md"))}">템플릿 열기</a>
    · <a href="http://localhost:4000/">사이트 홈</a>
    <br>
    슬러그는 URL 입니다. 이미 발행한 글의 파일명을 바꾸면 주소가 바뀌어 기존 링크와 검색 유입이 끊깁니다.
    <br>
    파일이 안 열리면 위 선택 상자에서 쓰는 에디터를 고르세요. 처음 누를 때 브라우저가 에디터를 열지 한 번 묻습니다.
  </footer>
</div>
${CONTROL_JS}
</body>
</html>`;
}

module.exports = { buildAdmin };
