/* ============================================================
   codechains blog — 쓰레드 원고 (1단계: 원고를 쌓고 큐로 관리하기)

   운영 모델
     블로그 글 한 편이 쓰레드 서너 편에서 열 편까지의 소재가 됩니다.
     그 편들은 이어 붙인 체인이 아니라 며칠에 걸쳐 따로 나가는 독립 포스팅입니다.
     사이사이에는 일 얘기가 아닌 글이 섞여야 합니다. 업무 이야기만 늘어놓는 계정은 읽히지 않습니다.

   그래서 파일은 "쓰레드 한 편"이 아니라 "한 배치"입니다.
     content/threads/<이름>.md 한 파일 = 한 묶음(보통 블로그 글 하나에서 뽑은 것)
     === 로 시작하는 줄이 그 안에서 편을 나눕니다.
     한 편 안에서 답글로 이어 붙일 때만 --- 를 씁니다.

   파일 모양
     ---
     source: wix-to-cloudflare   # 소재가 된 블로그 글의 슬러그. 없으면 비웁니다
     kind: work                  # 이 파일의 기본 성격(work | life). 편마다 덮어쓸 수 있습니다
     ---

     === 2026-08-04 08:20 work ready
     첫 편 본문

     === 2026-08-04 21:10 life
     둘째 편 본문

   === 뒤의 토큰은 순서를 가리지 않고, 없어도 됩니다.
     날짜 2026-08-04 · 시각 08:20 · 성격 work|life · 상태 draft|ready|posted
   <!-- 이렇게 --> 적은 메모는 글자 수에도 복사에도 들어가지 않습니다.

   쓰기:  node scripts/threads.js <블로그슬러그>   (그 글에서 배치 뼈대를 만듭니다)
          node scripts/threads.js                  (큐 상태와 남은 소재를 봅니다)
   보기:  npm run dev → http://localhost:4000/admin 의 "쓰레드" 탭
   ============================================================ */
const fs = require("fs");
const path = require("path");
const fm = require("front-matter");

/* 쓰레드 한 편의 글자 수 상한. SOFT 를 넘으면 아직 올라가긴 하지만 미리 알려줍니다.
   (여백을 남겨두는 이유: 올리기 직전에 한 문장 덧붙이는 일이 대부분이라) */
const LIMIT = 500;
const SOFT = 460;

/* 상태는 세 가지뿐이고 뜻이 정해져 있습니다.
     draft   원고가 아직 안 끝났습니다. 뼈대만 있거나 쓰는 중입니다. 상태를 안 적으면 이것으로 봅니다.
     ready   원고를 다 썼습니다. 지금 그대로 올려도 되는 상태입니다.
     posted  쓰레드에 실제로 올렸습니다. 여기까지 와야 큐에서 빠집니다. */
const STATUS = { draft: "초안", ready: "준비됨", posted: "발행됨" };
/* 성격. 업무 이야기만 이어지면 계정이 광고판이 됩니다.
   섞으라고 말로만 정해두면 안 지켜지므로, 편마다 표시하고 배합을 세어서 보여줍니다. */
const KIND = { work: "업무", life: "일상" };

/* 메모(<!-- -->)는 원고가 아닙니다. 글자 수를 셀 때도, 복사할 때도 없는 것으로 봅니다. */
const stripNotes = (s) => String(s).replace(/<!--[\s\S]*?-->/g, "");

/* 쓰레드는 글자를 셉니다. 한글도 영문도 한 자입니다.
   [...s] 로 나누는 이유는 s.length 가 이모지 하나를 둘로 세기 때문입니다.
   (조합형 이모지는 여전히 실제보다 크게 나올 수 있어, 그래서 SOFT 여백을 둡니다) */
const countChars = (s) => [...String(s)].length;

const hasLink = (s) => /https?:\/\//.test(s);

/* === 뒤에 붙는 토큰들. 순서를 외우지 않아도 되도록 종류로 알아봅니다.
   날짜만, 시각만, 성격만 적어도 됩니다. 못 알아본 토큰은 조용히 버리지 않고 그대로 돌려주어
   오타(예: redy)가 화면에서 눈에 띄게 합니다. */
function parseMeta(line) {
  const out = { date: "", time: "", kind: "", status: "", unknown: [] };
  String(line).trim().split(/\s+/).filter(Boolean).forEach((tok) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) out.date = tok;
    else if (/^\d{1,2}:\d{2}$/.test(tok)) out.time = tok.padStart(5, "0");
    else if (Object.prototype.hasOwnProperty.call(KIND, tok)) out.kind = tok;
    else if (Object.prototype.hasOwnProperty.call(STATUS, tok)) out.status = tok;
    else out.unknown.push(tok);
  });
  return out;
}

/* 한 편 안에서 답글로 이어 붙일 때만 쓰는 경계.
   \s* 대신 [ \t]* 를 쓰는 이유는, \s 가 줄바꿈까지 먹어 빈 줄이 경계로 오인되기 때문입니다. */
function splitReplies(body) {
  return body
    .split(/^[ \t]*---[ \t]*$/m)
    .map((s) => s.replace(/\n{3,}/g, "\n\n").trim())
    .filter(Boolean)
    .map((text, i) => ({ n: i + 1, text, len: countChars(text) }));
}

/* 배치 하나(파일 하나) 읽기 */
function parseBatch(file, raw) {
  const parsed = fm(raw);
  const a = parsed.attributes || {};
  const source = a.source ? String(a.source).trim() : "";
  const baseKind = Object.prototype.hasOwnProperty.call(KIND, String(a.kind)) ? String(a.kind) : "work";

  const body = stripNotes(parsed.body);
  /* === 로 자릅니다. 첫 조각은 === 앞의 머리말이라 원고가 아닙니다(보통 비어 있음).
     캡처 그룹을 쓰면 [본문0, 메타1, 본문1, 메타2, 본문2, ...] 순으로 나옵니다. */
  const chunks = body.split(/^[ \t]*===[ \t]*(.*)$/m);
  const posts = [];
  for (let i = 1; i < chunks.length; i += 2) {
    const meta = parseMeta(chunks[i]);
    const parts = splitReplies(chunks[i + 1] || "");
    posts.push({
      n: posts.length + 1,
      date: meta.date,
      time: meta.time,
      at: meta.date ? `${meta.date}${meta.time ? ` ${meta.time}` : " 00:00"}` : "",
      // 정렬용. 시각을 안 적은 편은 그날 맨 뒤로 갑니다(아직 안 정한 것이므로)
      sortKey: meta.date ? Number(new Date(`${meta.date}T${meta.time || "23:59"}:00+09:00`)) : Infinity,
      kind: meta.kind || baseKind,
      status: meta.status || "draft",
      unknown: meta.unknown,
      parts,
      len: parts.reduce((m, p) => Math.max(m, p.len), 0),
    });
  }
  return { file, name: file.replace(/\.md$/, ""), source, baseKind, posts };
}

function loadThreads(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((f) => parseBatch(f, fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/* 배치들을 나갈 순서 하나로 폅니다. 화면이 답해야 하는 질문이 "다음에 뭐가 나가나" 라서요. */
function queueOf(batches) {
  const all = [];
  batches.forEach((b) => b.posts.forEach((p) => all.push({ ...p, file: b.file, source: b.source })));
  return all.sort((a, b) => a.sortKey - b.sortKey || a.file.localeCompare(b.file) || a.n - b.n);
}

/* 한 편 검사. 블로그의 SEO 검사와 달리 빌드를 멈추지 않습니다.
   쓰레드는 아직 안 올린 상태가 정상이고, 그 상태로 며칠씩 있기 때문입니다. */
function checkPost(p, postsBySlug) {
  const issues = [];
  const add = (level, msg) => issues.push({ level, msg });
  const where = (part) => (p.parts.length > 1 ? `${part.n}번째 답글: ` : "");

  if (!p.parts.length) add("error", "내용이 비어 있습니다.");

  p.parts.forEach((part) => {
    if (part.len > LIMIT) {
      add("error", `${where(part)}${part.len}자입니다. ${part.len - LIMIT}자를 줄이거나 --- 로 나누세요(상한 ${LIMIT}자).`);
    } else if (part.len > SOFT) {
      add("warn", `${where(part)}${part.len}자로 상한(${LIMIT}자)에 거의 닿았습니다.`);
    }
    if (/[—–]/.test(part.text)) {
      add("warn", `${where(part)}긴 하이픈(— 또는 –)이 있습니다. 쉼표나 마침표로 바꾸세요.`);
    }
  });

  /* 링크가 붙은 글은 도달이 눈에 띄게 떨어집니다.
     그래서 링크는 아껴 씁니다. 여기서는 첫 편에 걸리는 것만 막습니다. */
  if (p.parts.length > 1 && hasLink(p.parts[0].text)) {
    add("warn", "링크가 첫 편에 있습니다. 링크가 붙은 글은 덜 퍼지므로 답글로 내리세요.");
  }

  if (!p.date) add("warn", "나갈 날짜가 없습니다. === 뒤에 2026-08-04 08:20 처럼 적어두세요.");
  if (p.unknown.length) add("warn", `=== 줄에서 못 알아본 말: ${p.unknown.join(", ")}. 오타인지 보세요.`);
  if (p.source && postsBySlug && !postsBySlug.has(p.source)) {
    add("error", `source: ${p.source} 에 해당하는 블로그 글이 없습니다.`);
  }
  return issues;
}

/* 블로그 글 하나에서 뽑는 배치는 3의 배수(3, 6, 9)로만 만듭니다.
   하루에 세 편을 올리므로, 3의 배수가 아니면 배치 끝에서 하루가 어중간하게 남습니다.
   소재가 없는 파일(일상 편 등)은 쌓아가는 성격이라 이 규칙에서 뺍니다. */
const PER_DAY = 3;
function batchIssues(batches) {
  return batches
    .filter((b) => b.source && b.posts.length % PER_DAY !== 0)
    .map((b) => {
      const short = PER_DAY - (b.posts.length % PER_DAY);
      const down = b.posts.length - (b.posts.length % PER_DAY);
      return `${b.file}: ${b.posts.length}편입니다. ${b.posts.length + short}편으로 늘리거나 ${down}편으로 줄이세요(3의 배수).`;
    });
}

/* 큐 배합. 업무 이야기만 줄줄이 이어지면 알려줍니다.
   숫자로 보이지 않으면 "섞어야지" 라는 다짐은 지켜지지 않습니다. */
function queueStats(queue) {
  const left = queue.filter((p) => p.status !== "posted");
  const count = (k) => left.filter((p) => p.kind === k).length;
  let run = 0;
  let worst = 0;
  left.forEach((p) => {
    run = p.kind === "work" ? run + 1 : 0;
    worst = Math.max(worst, run);
  });
  return {
    total: queue.length,
    left: left.length,
    posted: queue.length - left.length,
    work: count("work"),
    life: count("life"),
    // 아직 원고가 안 끝난 편. 이 숫자가 0이어야 큐가 그대로 나갈 수 있습니다.
    draft: left.filter((p) => p.status === "draft").length,
    ready: left.filter((p) => p.status === "ready").length,
    undated: left.filter((p) => !p.date).length,
    longestWorkRun: worst,
  };
}

/* ---------- 초안 씨앗 ----------
   문구를 대신 써주지는 않습니다. 나올 수도 없습니다.
   쓰레드에서 읽힐지 말지를 정하는 것은 첫 두 줄인데, 그건 글 요약이 아니라 장면이라서요.
   대신 빈 화면 앞에 앉지 않도록, 글에서 뽑은 재료를 각 편 옆에 붙여 둡니다. */

// 본문에서 소제목·표·코드·목록을 걷어낸 평문
function plainBody(post) {
  return String(post.rawBody || "")
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((l) => !/^\s*(#{1,6}\s|>|\||[-*+]\s|\d+\.\s)/.test(l))
    .join("\n");
}

/* 훅 후보. 숫자가 들어간 문장을 먼저 봅니다.
   "연 59만원", "이틀 만에" 같은 문장이 그대로 첫 줄이 되는 경우가 많기 때문입니다. */
function hookCandidates(post) {
  const out = [];
  plainBody(post)
    .split(/(?<=[.!?])\s+/)
    .forEach((raw) => {
      const s = raw
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (s.length < 12 || s.length > 110) return;
      if (!/\d/.test(s)) return;
      if (out.includes(s)) return;
      out.push(s);
    });
  if (!out.length && post.description) out.push(String(post.description).trim());
  return out.slice(0, 6);
}

// 글의 소제목 = 편을 나눌 자연스러운 경계
const outline = (post) =>
  String(post.rawBody || "")
    .split("\n")
    .filter((l) => /^##\s+/.test(l))
    .map((l) => l.replace(/^#+\s+/, "").trim());

/* 하루 세 편. 아침 출근길, 점심, 밤.
   쓰레드는 아직 팔로우하지 않은 계정의 글을 넓게 노출시키는 단계라, 올리는 횟수가 곧 기회입니다.
   하루 한두 편이면 그 기회를 거의 안 쓰고, 열 편을 넘기면 한 계정이 피드를 덮어 오히려 언팔이 늡니다.
   밤 21시대를 넣은 이유는 한국 사용자가 가장 붐비는 시간이라서입니다.
   이 시각이 정답이라서가 아니라, 빈 칸으로 두면 결국 하루에 몰아서 올리게 되기 때문에 미리 박아 둡니다. */
const SLOTS = ["08:20", "12:40", "21:10"];
function slotDates(startDate, count) {
  const out = [];
  /* 날짜만 더하는 계산이라 UTC 자정을 기준으로 잡습니다.
     +09:00 으로 만들면 toISOString 이 UTC 로 되돌리면서 하루 앞 날짜가 찍힙니다. */
  const base = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getTime() + Math.floor(i / SLOTS.length) * 86400000);
    out.push(`${d.toISOString().slice(0, 10)} ${SLOTS[i % SLOTS.length]}`);
  }
  return out;
}

function seedFrom(post, startDate) {
  const hooks = hookCandidates(post);
  const heads = outline(post);
  // 소제목 수에서 출발하되 3의 배수로 맞춥니다(3, 6, 9). 하루 세 편이 기준이라 딱 떨어져야 합니다.
  const count = Math.min(Math.max(Math.round(heads.length / PER_DAY) * PER_DAY, PER_DAY), PER_DAY * 3);
  const when = slotDates(startDate, count);

  const body = when
    .map((at, i) => {
      const angle = heads[i] ? `소재: ${heads[i]}` : "소재: 글에서 하나 더 고르세요";
      const hook = hooks[i] ? `\n     첫 줄 후보: ${hooks[i]}` : "";
      const tail = i === count - 1 ? "\n     마지막 편에서만 블로그 링크를 겁니다." : "";
      return `=== ${at} work\n<!-- ${angle}${hook}${tail} -->\n(여기에 한 편)\n`;
    })
    .join("\n");

  return `---
source: ${post.slug}
kind: work
---

<!-- 한 편에 한 가지만 담습니다. 각 편은 이것만 봐도 말이 되어야 합니다(앞 편을 안 본 사람이 대부분이라).
     업무 이야기가 연달아 서너 편 이어지면 사이에 일상 편을 끼워 넣으세요.
     일상 편은 content/threads/life-*.md 에 따로 모읍니다. -->

${body}`;
}

/* ---------- CLI ---------- */
function cli(argv) {
  const { loadPosts } = require("./posts");
  const ROOT = path.join(__dirname, "..");
  const CONTENT = path.join(ROOT, "content");
  const THREADS = path.join(CONTENT, "threads");

  const posts = loadPosts(path.join(CONTENT, "posts-kr"));
  const batches = loadThreads(THREADS);
  const queue = queueOf(batches);
  const stats = queueStats(queue);
  const args = argv.filter((a) => !a.startsWith("-"));

  if (!args.length) {
    console.log(`큐: 남은 ${stats.left}편 (업무 ${stats.work} · 일상 ${stats.life} / 준비됨 ${stats.ready} · 초안 ${stats.draft}), 발행 ${stats.posted}편`);
    if (stats.undated) console.log(`  날짜 없는 편 ${stats.undated}개`);
    if (stats.longestWorkRun >= 4) console.log(`  업무 글이 연속 ${stats.longestWorkRun}편입니다. 사이에 일상 편을 끼우세요.`);
    batchIssues(batches).forEach((m) => console.log(`  ${m}`));

    const next = queue.filter((p) => p.status !== "posted").slice(0, 5);
    if (next.length) {
      console.log("\n다음에 나갈 순서:");
      next.forEach((p) => {
        const head = (p.parts[0] ? p.parts[0].text : "").split("\n")[0].slice(0, 34);
        console.log(`  ${(p.at || "날짜미정").padEnd(17)} ${KIND[p.kind]}  ${head}...`);
      });
    }

    const covered = new Set(batches.map((b) => b.source).filter(Boolean));
    const todo = posts.filter((p) => !p.draft && !covered.has(p.slug));
    if (todo.length) {
      console.log("\n아직 안 쓴 소재(블로그 글):");
      todo.forEach((p) => console.log(`  ${p.slug}\n    ${p.title}`));
      console.log(`\n배치 만들기:  npm run thread ${todo[0].slug}`);
    }
    return;
  }

  // 시작 날짜는 인자로 받습니다. 안 주면 오늘. (배치를 언제부터 흘릴지는 그때그때 다르므로)
  const startArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const start = startArg || new Date().toISOString().slice(0, 10);

  args.filter((a) => a !== startArg).forEach((slug) => {
    const post = posts.find((p) => p.slug === slug);
    if (!post) {
      console.error(`[건너뜀] ${slug} : 그런 글이 없습니다. (인자 없이 실행하면 목록이 나옵니다)`);
      return;
    }
    const out = path.join(THREADS, `${slug}.md`);
    if (fs.existsSync(out)) {
      // 덮어쓰기는 하지 않습니다. 손으로 쓴 원고가 한 번의 오타로 날아가는 쪽이 훨씬 비쌉니다.
      console.error(`[건너뜀] ${slug} : 배치가 이미 있습니다. ${path.relative(ROOT, out)}`);
      return;
    }
    fs.mkdirSync(THREADS, { recursive: true });
    fs.writeFileSync(out, seedFrom(post, start), "utf8");
    console.log(`만들었습니다: ${path.relative(ROOT, out)} (${start} 부터)`);
  });

  console.log("\n관리 페이지의 쓰레드 탭에서 나갈 순서와 편별 글자 수를 봅니다.");
  console.log("  npm run dev → http://localhost:4000/admin");
}

if (require.main === module) cli(process.argv.slice(2));

module.exports = { LIMIT, SOFT, PER_DAY, STATUS, KIND, loadThreads, queueOf, queueStats, checkPost, batchIssues, countChars, seedFrom };
