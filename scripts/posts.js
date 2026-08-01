/* ============================================================
   글 읽기 공통 모듈
   build.js(사이트 생성)와 make-og.js(공유 카드 생성)가 같은 규칙으로 글을 읽습니다.

   따로 두면 슬러그나 날짜 해석이 조금씩 어긋나면서
   "글은 /posts/foo/ 인데 카드는 bar.png" 같은 짝 잃은 상태가 조용히 생깁니다.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const fm = require("front-matter");

const read = (p) => fs.readFileSync(p, "utf8");

// 파일명 앞의 날짜는 URL에서 뺍니다. 2026-08-01-why-ai.md → why-ai
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

/* 글 하나가 쓰는 공유 카드의 경로(사이트 기준). 실제 파일 유무는 부르는 쪽에서 확인합니다. */
const ogCardPath = (lang, slug) => `/assets/og/${lang === "en" ? "en/" : ""}${slug}.png`;

module.exports = { read, slugOf, normDate, normStamp, fmtDate, loadPosts, published, ogCardPath };
