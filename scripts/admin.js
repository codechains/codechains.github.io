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
const { LIMIT, SOFT, loadThreads, queueOf, queueStats, checkPost, batchIssues } = require("./threads");

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* 에디터에서 파일을 바로 여는 링크.
   cursor://file/C:/Users/.../content/posts-kr/글.md 형태여야 하므로
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

/* 탭 — 글 목록과 쓰레드 원고를 오갑니다 */
.tabs{display:flex;gap:.4rem;border-bottom:1px solid #1c222c;margin-bottom:1.2rem}
.tabs button{background:none;border:0;border-bottom:2px solid transparent;color:#8b93a7;padding:.6rem .9rem;font:inherit;font-size:.88rem;cursor:pointer;margin-bottom:-1px}
.tabs button:hover{color:#e6e9ef}
.tabs button[aria-current=page]{color:#e6e9ef;border-bottom-color:#6ee7b7;font-weight:600}
.tabs .n{color:#5c6478;font-variant-numeric:tabular-nums;margin-left:.35rem}

/* 쓰레드 원고 카드 */
.th{border:1px solid #1c222c;border-radius:10px;padding:1rem 1.1rem;margin-bottom:1rem;background:#11151c}
.th-head{display:flex;gap:.5rem;align-items:baseline;flex-wrap:wrap;margin-bottom:.2rem}
.th-title{font-weight:600;color:#e6e9ef}
.th-meta{color:#5c6478;font-size:.78rem;font-variant-numeric:tabular-nums}
.th-head .spacer{flex:1}
.seg{border:1px solid #1c222c;border-radius:8px;margin-top:.7rem;overflow:hidden}
.seg-head{display:flex;gap:.6rem;align-items:center;background:#161b23;padding:.35rem .6rem;font-size:.78rem}
.seg-head .no{color:#8b93a7;font-variant-numeric:tabular-nums}
.seg-head .len{font-variant-numeric:tabular-nums;color:#6ee7b7}
.seg-head .len.near{color:#f0c674}
.seg-head .len.over{color:#ff8f8f;font-weight:600}
.seg-head .grow{flex:1}
button.copy{background:#1a2233;border:1px solid #262d3a;color:#7aa2ff;border-radius:6px;padding:.2rem .55rem;font:inherit;font-size:.76rem;cursor:pointer}
button.copy:hover{border-color:#7aa2ff;color:#e6e9ef}
button.copy.done{color:#6ee7b7;border-color:#2c5a44}
pre.seg-body{margin:0;padding:.7rem .75rem;white-space:pre-wrap;word-break:break-word;font:inherit;color:#cdd3df;background:#0e1116}
.b-ready{background:#12222f;color:#7dd3fc}
.b-posted{background:#1c1c24;color:#8b93a7}
.b-th-none{background:#241a1f;color:#c98b9b}
.b-work{background:#1a2233;color:#9db4e8}
.b-life{background:#2a1f30;color:#d8a9e8}
.when{font-variant-numeric:tabular-nums;color:#a7b0c2;font-size:.82rem;white-space:nowrap}

/* 하루가 한 줄, 한 줄에 카드 세 장 */
section.day{margin-bottom:1.4rem}
.day-head{display:flex;gap:.7rem;align-items:baseline;flex-wrap:wrap;padding:0 .1rem .5rem;border-bottom:1px solid #1c222c;margin-bottom:.8rem}
.day-head .when{font-size:.95rem;font-weight:600;color:#e6e9ef}
/* 열은 셋으로 고정합니다. 하루 세 편이 운영 기준이라, 폭에 따라 열 수가 달라지면
   같은 요일이 어제와 다른 모양으로 보여 계획표로 못 씁니다. */
.day-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem;align-items:start}
@media (max-width:900px){.day-grid{grid-template-columns:1fr}}
.day-grid .th{margin:0;height:100%;display:flex;flex-direction:column}
.day-grid .th .seg{flex:1}
.th-foot{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:.6rem;padding-top:.5rem;border-top:1px solid #1c222c}
.th-foot .edit,.th-foot .th-src,.th-foot .th-meta{font-size:.74rem}
/* 원고는 통째로 보여야 합니다. 잘라서 스크롤을 만들면 카드 안에서 또 스크롤을 해야 하고,
   그러면 한눈에 훑으려고 격자로 만든 의미가 없어집니다. 길면 그 줄이 길어지는 편이 낫습니다. */
.day-grid pre.seg-body{font-size:.8rem;line-height:1.65;overflow:visible;max-height:none}
#thPager{margin-top:.4rem}
a.th-src{color:#6f7789;font-size:.78rem;text-decoration:none}
a.th-src:hover{color:#6ee7b7;text-decoration:underline}
.howto{color:#8b93a7;font-size:.82rem;background:#11151c;border:1px solid #1c222c;border-radius:10px;padding:.9rem 1.1rem;margin-bottom:1.2rem;line-height:1.7}
.howto code{background:#161b23;color:#7aa2ff;border-radius:4px;padding:.05rem .35rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
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
  // 검색·페이징은 글 목록에만 겁니다. 쓰레드 원고는 수가 적어 통째로 보이는 편이 낫습니다.
  var panels = [].slice.call(document.querySelectorAll('#view-posts [data-panel]')).map(function(el){
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

  /* 탭. 고른 탭은 이 브라우저에 기억합니다(원고를 다듬는 동안 새로고침이 잦으므로). */
  var TKEY = 'cc-admin-view';
  var tabs = [].slice.call(document.querySelectorAll('.tabs button[data-view]'));
  function show(name){
    if (!tabs.some(function(b){ return b.getAttribute('data-view') === name; })) name = 'posts';
    tabs.forEach(function(b){
      if (b.getAttribute('data-view') === name) b.setAttribute('aria-current','page');
      else b.removeAttribute('aria-current');
    });
    ['posts','threads'].forEach(function(v){
      var el = document.getElementById('view-' + v);
      if (el) el.style.display = (v === name ? '' : 'none');
    });
    try { localStorage.setItem(TKEY, name); } catch(e) {}
  }
  tabs.forEach(function(b){ b.addEventListener('click', function(){ show(b.getAttribute('data-view')); }); });
  var savedView = 'posts';
  try { savedView = localStorage.getItem(TKEY) || 'posts'; } catch(e) {}
  show(savedView);

  /* 쓰레드 큐의 페이징. 한 페이지에 7일치.
     글 목록과 따로 두는 이유는 세는 단위가 다르기 때문입니다. 저쪽은 글 50개, 이쪽은 하루 7개.
     여기에는 검색을 걸지 않습니다. 이 화면이 답해야 하는 건 "이번 주에 뭐가 나가나" 하나라서요. */
  var DAYS_PER_PAGE = 7;
  var weeks = document.getElementById('weeks');
  var thPager = document.getElementById('thPager');
  if (weeks && thPager) {
    var days = [].slice.call(weeks.querySelectorAll('[data-day]'));
    var wpage = 1;
    var wlast = function(){ return Math.max(1, Math.ceil(days.length / DAYS_PER_PAGE)); };

    function wrender(){
      var last = wlast();
      if (wpage > last) wpage = last;
      if (wpage < 1) wpage = 1;
      var start = (wpage - 1) * DAYS_PER_PAGE;
      days.forEach(function(d, i){ d.style.display = (i >= start && i < start + DAYS_PER_PAGE) ? '' : 'none'; });

      if (last <= 1){ thPager.innerHTML = ''; return; }
      var h = '<button data-wgo="' + (wpage-1) + '"' + (wpage === 1 ? ' disabled' : '') + '>← 이전</button>';
      pageList(wpage, last).forEach(function(x){
        h += x === 'gap'
          ? '<span class="gap">…</span>'
          : '<button data-wgo="' + x + '"' + (x === wpage ? ' aria-current="page"' : '') + '>' + x + '주</button>';
      });
      h += '<button data-wgo="' + (wpage+1) + '"' + (wpage === last ? ' disabled' : '') + '>다음 →</button>';
      h += '<span class="range">' + (start+1) + '-' + Math.min(start+DAYS_PER_PAGE, days.length) + ' / ' + days.length + '일</span>';
      thPager.innerHTML = h;
    }

    thPager.addEventListener('click', function(e){
      var b = e.target.closest('button[data-wgo]');
      if (!b || b.disabled) return;
      wpage = Number(b.getAttribute('data-wgo'));
      wrender();
      window.scrollTo({ top: Math.max(0, weeks.getBoundingClientRect().top + window.pageYOffset - 90), behavior: 'smooth' });
    });

    // 아직 안 올린 날이 처음 나오는 주부터 보여줍니다. 지난 주를 다시 넘기는 일이 없도록.
    var firstLeft = days.map(function(d){ return d.getAttribute('data-left') === '1'; }).indexOf(true);
    if (firstLeft > 0) wpage = Math.floor(firstLeft / DAYS_PER_PAGE) + 1;
    wrender();
  }

  /* 편 단위 복사.
     화면에 보이는 것이 곧 올릴 원고입니다(메모는 읽는 단계에서 이미 빠졌습니다).
     그래서 pre 의 textContent 를 그대로 복사합니다. 따로 옮겨 담으면 둘이 어긋납니다. */
  function flash(btn, label){
    var old = btn.getAttribute('data-label') || btn.textContent;
    btn.setAttribute('data-label', old);
    btn.textContent = label;
    btn.classList.add('done');
    setTimeout(function(){ btn.textContent = old; btn.classList.remove('done'); }, 1200);
  }
  function legacyCopy(text){
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(text, btn, label){
    // localhost 는 보안 컨텍스트라 clipboard API 가 동작합니다. 안 될 때만 옛 방식으로 내려갑니다.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){ flash(btn, label); }, function(){
        if (legacyCopy(text)) flash(btn, label); else alert('복사하지 못했습니다. 직접 선택해서 복사하세요.');
      });
    } else if (legacyCopy(text)) flash(btn, label);
    else alert('복사하지 못했습니다. 직접 선택해서 복사하세요.');
  }
  document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    var one = e.target.closest('button.copy[data-seg]');
    if (one) {
      copyText(one.closest('.seg').querySelector('pre.seg-body').textContent, one, '복사됨');
      return;
    }
    var all = e.target.closest('button.copy[data-all]');
    if (all) {
      var texts = [].slice.call(all.closest('.th').querySelectorAll('pre.seg-body')).map(function(p){ return p.textContent; });
      copyText(texts.join('\\n\\n---\\n\\n'), all, '전체 복사됨');
    }
  });
})();
</script>`;

/* 상태 배지. 뜻은 threads.js 의 STATUS 주석에 있습니다.
   초안은 아직 쓸 게 남았다는 뜻이라 눈에 띄는 색(호박색)으로 둡니다. */
const THREAD_BADGE = {
  draft: ["b-draft", "초안"],
  ready: ["b-ready", "준비됨"],
  posted: ["b-posted", "발행됨"],
};

const issueLines = (issues) =>
  (issues || [])
    .map((i) => `<div class="${i.level === "error" ? "err" : "warn"}">${i.level === "error" ? "오류" : "경고"}: ${esc(i.msg)}</div>`)
    .join("");

const KIND_BADGE = { work: ["b-work", "업무"], life: ["b-life", "일상"] };

/* 쓰레드 한 편.
   화면에 보이는 <pre> 그대로가 복사됩니다. 복사용 사본을 따로 만들지 않는 이유는,
   눈으로 확인한 글자 수와 실제로 붙여넣는 글이 어긋날 여지를 아예 없애기 위해서입니다. */
function postCard(p) {
  const [scls, slabel] = THREAD_BADGE[p.status] || THREAD_BADGE.draft;
  const [kcls, klabel] = KIND_BADGE[p.kind] || KIND_BADGE.work;

  const parts = p.parts
    .map((s) => {
      const state = s.len > LIMIT ? " over" : s.len > SOFT ? " near" : "";
      return `<div class="seg">
      <div class="seg-head">
        <span class="no">${p.parts.length > 1 ? `${s.n}번째` : "본문"}</span>
        <span class="len${state}">${s.len}자</span>
        <span class="grow"></span>
        <button class="copy" type="button" data-seg="${s.n}">복사</button>
      </div>
      <pre class="seg-body">${esc(s.text)}</pre>
    </div>`;
    })
    .join("\n");

  // 소재가 된 블로그 글. 초안인 글은 아직 페이지가 없으므로 링크를 걸지 않습니다.
  const src = !p.source
    ? ""
    : !p.post
      ? `<span class="th-meta">${esc(p.source)} (없는 글)</span>`
      : p.post.draft
        ? `<span class="th-meta">${esc(p.post.title)} (초안)</span>`
        : `<a class="th-src" href="${p.postUrl}" target="_blank" rel="noopener" title="소재가 된 글">${esc(p.post.title)}</a>`;

  /* 카드가 세 개씩 가로로 서므로 머리에는 시각과 배지만 둡니다.
     날짜는 줄 머리에 한 번만 나오고, 파일 경로처럼 폭을 잡아먹는 것은 아래로 내립니다. */
  return `<article class="th">
    <div class="th-head">
      <span class="when">${esc(p.time || "시각 미정")}</span>
      <span class="badge ${kcls}">${klabel}</span>
      <span class="badge ${scls}">${slabel}</span>
    </div>
    ${issueLines(p.issues)}
    ${parts || `<p class="empty">내용이 비어 있습니다.</p>`}
    <div class="th-foot">
      <a class="edit" data-path="${uriPath(p.absPath)}" href="${editorHref(p.absPath)}" title="에디터에서 열기">${esc(p.file)} · ${p.n}번째</a>
      ${src}
      ${p.parts.length > 1 ? `<button class="copy" type="button" data-all="1">답글까지 전체</button>` : ""}
    </div>
  </article>`;
}

/* 큐. 화면이 답해야 하는 질문은 하나입니다. 다음에 뭐가, 언제 나가나.
   그래서 파일별로 묶지 않고 나갈 시각 순으로 폅니다. 올린 것은 아래로 내립니다. */
function threadsView(queue, stats, contentDir, batches) {
  const tplPath = path.join(contentDir, "_thread-template.md");

  const mix = stats.left
    ? `남은 ${stats.left}편 · 업무 ${stats.work} / 일상 ${stats.life}` +
      ` · 준비됨 ${stats.ready}${stats.draft ? ` / 초안 ${stats.draft}` : ""}` +
      (stats.undated ? ` · 날짜 미정 ${stats.undated}` : "") +
      (stats.posted ? ` · 발행 ${stats.posted}` : "")
    : `남은 편이 없습니다${stats.posted ? ` (발행 ${stats.posted}편)` : ""}`;

  /* 업무 이야기가 연달아 나가면 계정이 광고판이 됩니다.
     "섞어야지" 라는 다짐은 숫자로 보이지 않으면 지켜지지 않아서, 여기서 세어 보여줍니다. */
  const runWarn = stats.longestWorkRun >= 4
    ? `<div class="warn">경고: 업무 글이 연속 ${stats.longestWorkRun}편입니다. 사이에 일상 편을 끼우세요.</div>`
    : "";

  /* 블로그 글 하나에서 뽑는 배치는 3의 배수여야 합니다. 하루 세 편이 기준이라서요.
     편수는 원고를 다 쓴 뒤에야 확정되므로, 규칙을 말로 적어두는 대신 여기서 세어 알려줍니다. */
  const batchWarn = batchIssues(batches || [])
    .map((m) => `<div class="warn">경고: ${esc(m)}</div>`)
    .join("");

  /* 사용법 설명은 화면에 두지 않습니다. 매일 보는 화면이라 한 번 익히고 나면 자리만 차지합니다.
     쓰는 방법은 템플릿(content/_thread-template.md) 안에 주석으로 붙어 있어, 원고를 열면 거기 있습니다. */
  const howto = `<div class="howto">
  <b>큐</b> · ${mix}
  · <a data-path="${uriPath(tplPath)}" href="${editorHref(tplPath)}">템플릿 열기</a>${runWarn}${batchWarn}
</div>`;

  if (!queue.length) {
    return `${howto}<p class="empty">아직 원고가 없습니다. 터미널에서 <code>npm run thread</code> 를 실행해 어느 글부터 쓸지 고르세요.</p>`;
  }
  return howto + dayList(queue);
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
// 날짜 문자열만 요일로. UTC 자정으로 읽어야 이 PC 의 시간대와 상관없이 같은 요일이 나옵니다.
const dowOf = (date) => DOW[new Date(`${date}T00:00:00Z`).getUTCDay()];

/* 하루가 한 줄, 한 줄에 카드 세 장. 한 페이지에 일주일.
   하루에 세 편을 올리는 운영이라 이 격자가 곧 실제 발행 계획표가 됩니다.
   세로로 늘어놓으면 "이번 주에 뭐가 나가나"를 스크롤로 재구성해야 하는데, 그건 매일 할 일이 못 됩니다.
   하루에 네 편 이상 넣으면 그 줄만 아래로 접혀 내려갑니다(격자가 무너지지 않게 열 수는 셋으로 고정).

   한 줄 안에서는 늦은 시각이 왼쪽입니다. 큐 자체는 시간순으로 두고 그릴 때만 뒤집습니다.
   통계와 발행 순서는 시간순이어야 하므로 데이터 쪽 정렬은 건드리지 않습니다. */
function dayList(queue) {
  const groups = [];
  const index = new Map();
  queue.forEach((p) => {
    const key = p.date || "";
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ date: key, posts: [] });
    }
    groups[index.get(key)].posts.push(p);
  });

  const rows = groups
    .map((g) => {
      const done = g.posts.every((p) => p.status === "posted");
      const work = g.posts.filter((p) => p.kind === "work").length;
      const life = g.posts.length - work;
      const bad = g.posts.filter((p) => (p.issues || []).some((x) => x.level === "error")).length;

      return `<section class="day" data-day${done ? "" : ' data-left="1"'}>
  <div class="day-head">
    <span class="when">${g.date ? `${g.date} (${dowOf(g.date)})` : "날짜 미정"}</span>
    <span class="th-meta">${g.posts.length}편 · 업무 ${work} / 일상 ${life}</span>
    <span class="spacer"></span>
    ${bad ? `<span class="badge b-th-none">오류 ${bad}</span>` : ""}
    ${done ? `<span class="badge b-posted">발행 완료</span>` : ""}
  </div>
  <div class="day-grid">
${g.posts.slice().reverse().map(postCard).join("\n")}
  </div>
</section>`;
    })
    .join("\n");

  return `<div id="weeks">${rows}</div>
<nav class="pager" id="thPager" aria-label="주"></nav>`;
}

/* 한 글을 표의 한 줄로. */
function row(p) {
  const tags = (p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  // "쓰레드없음" 으로 검색하면 아직 소재로 안 쓴 글만 남습니다
  const search = [p.title, p.slug, p.file, p.description || "", (p.tags || []).join(" "),
    p.trackThread ? (p.threadCount ? "쓰레드" : "쓰레드없음") : ""]
    .join(" ")
    .toLowerCase();

  const status = p.draft
    ? `<span class="badge b-draft">초안</span>`
    : `<span class="badge b-live">공개</span>`;
  const en = p.hasEn
    ? `<span class="badge b-ok">EN</span>`
    : `<span class="badge b-none">EN 없음</span>`;
  /* 이 글에서 쓰레드를 몇 편이나 뽑았는지. 한국어 글에만 답니다(쓰레드는 한국어 계정 하나로 운영).
     "없음"을 굳이 붉게 보여주는 이유는, 아직 안 쓴 소재가 눈에 안 띄면 그대로 잊히기 때문입니다. */
  const th = !p.trackThread
    ? ""
    : p.threadCount
      ? `<span class="badge b-ready">쓰레드 ${p.threadCount}편${p.threadLeft ? ` (남은 ${p.threadLeft})` : ""}</span>`
      : `<span class="badge b-th-none">쓰레드 없음</span>`;

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
  <td>${status}${en}${th}</td>
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
  const koDir = path.join(contentDir, "posts-kr");
  const enDir = path.join(contentDir, "posts-en");
  const enBySlug = new Map(enAll.map((p) => [p.slug, p]));

  /* 쓰레드 원고. 여기서 읽고 여기서 검사합니다.
     블로그 빌드와 엮지 않는 이유는, 원고가 깨졌다고 사이트 배포가 막히면 안 되기 때문입니다. */
  const threadsDir = path.join(contentDir, "threads");
  const koBySlug = new Map(koAll.map((p) => [p.slug, p]));
  const batches = loadThreads(threadsDir);
  const queue = queueOf(batches).map((p) => ({
    ...p,
    post: p.source ? koBySlug.get(p.source) || null : null,
    postUrl: `http://localhost:4000/posts/${p.source}/`,
    absPath: path.join(threadsDir, p.file),
    issues: checkPost(p, koBySlug),
  }));
  const stats = queueStats(queue);

  // 글 목록에 "이 글에서 몇 편 뽑았고 몇 편이 남았나"를 달기 위한 집계
  const perSource = new Map();
  queue.forEach((p) => {
    if (!p.source) return;
    const cur = perSource.get(p.source) || { count: 0, left: 0 };
    cur.count += 1;
    if (p.status !== "posted") cur.left += 1;
    perSource.set(p.source, cur);
  });
  const threadTodo = koAll.filter((p) => !p.draft && !perSource.has(p.slug)).length;

  // 번호는 발행 순서(가장 오래된 글이 1번). 새 글이 나와도 기존 번호가 밀리지 않습니다.
  const total = koAll.length;
  const koRows = koAll.map((p, i) => ({
    ...p,
    n: total - i, // koAll 은 최신순 정렬
    hasEn: enBySlug.has(p.slug),
    trackThread: true,
    threadCount: (perSource.get(p.slug) || {}).count || 0,
    threadLeft: (perSource.get(p.slug) || {}).left || 0,
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

  <nav class="tabs">
    <button type="button" data-view="posts" aria-current="page">글<span class="n">${total}</span></button>
    <button type="button" data-view="threads">쓰레드<span class="n">${stats.left} 대기${threadTodo ? ` / 안 쓴 글 ${threadTodo}` : ""}</span></button>
  </nav>

  <section id="view-posts">
  <div class="bar">
    <input id="q" type="search" placeholder="제목 · 슬러그 · 태그 · 설명으로 찾기 (쓰레드없음 으로도)" autocomplete="off">
    <select id="editor" title="파일 열기 링크가 어느 에디터로 갈지 고릅니다. 선택은 이 브라우저에 기억됩니다.">
      ${EDITORS.map((e) => `<option value="${e.id}"${e.id === EDITOR ? " selected" : ""}>${esc(e.label)} 로 열기</option>`).join("\n      ")}
    </select>
    <span class="count">검색 결과 <b id="shown">${total}</b> / 전체 ${total} (공개 ${live} · 초안 ${drafts}) · 한 페이지 ${PAGE_SIZE}개</span>
  </div>

  ${table(koRows)}

  ${orphanEn.length ? `<h2 class="sec">영문만 있는 글 (한국어판 없음)</h2>${table(orphanEn)}` : ""}
  </section>

  <section id="view-threads" style="display:none">
  ${threadsView(queue, stats, contentDir, batches)}
  </section>

  <footer>
    새 글: <code>content/_post-template.md</code> 를 <code>content/posts-kr/YYYY-MM-DD-슬러그.md</code> 로 복사
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
