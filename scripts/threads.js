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

/* ---------- 편 고유번호 ----------
   알파벳 두 자 + 숫자 두 자. AA01 부터 시작해 AA99 다음이 AB01, AZ99 다음이 BA01 입니다.
   26 x 26 x 99 = 66,924 편까지 갑니다.

   한 번 붙은 번호는 절대 바뀌지 않습니다. 날짜를 다시 배정하든 순서를 섞든 그대로입니다.
   그래야 "AA07 그 글 말이야" 라고 부를 수 있고, 나중에 발행 결과나 반응을 이 번호로 이어 붙일 수 있습니다.
   자리 수가 고정이라 문자열 비교만으로 순서가 나옵니다(AA01 < AA02 < AB01). */
const ID_RE = /^[A-Z]{2}\d{2}$/;
const FIRST_ID = "AA01";

function nextId(id) {
  if (!id) return FIRST_ID;
  let a = id.charCodeAt(0);
  let b = id.charCodeAt(1);
  let n = Number(id.slice(2)) + 1;
  if (n > 99) { n = 1; b += 1; }
  if (b > 90) { b = 65; a += 1; } // 'Z' = 90, 'A' = 65
  if (a > 90) return null; // 다 썼습니다. 66,924 편이라 실제로는 오지 않습니다.
  return String.fromCharCode(a) + String.fromCharCode(b) + String(n).padStart(2, "0");
}

/* === 뒤에 붙는 토큰들. 순서를 외우지 않아도 되도록 종류로 알아봅니다.
   날짜만, 시각만, 성격만 적어도 됩니다. 못 알아본 토큰은 조용히 버리지 않고 그대로 돌려주어
   오타(예: redy)가 화면에서 눈에 띄게 합니다. */
function parseMeta(line) {
  const out = { id: "", date: "", time: "", kind: "", status: "", postedAt: "", unknown: [] };
  String(line).trim().split(/\s+/).filter(Boolean).forEach((tok) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) out.date = tok;
    else if (ID_RE.test(tok)) out.id = tok;
    // @2026-08-03T09:02 는 실제로 올라간 시각입니다. 발행 자동화가 남깁니다.
    else if (/^@/.test(tok)) out.postedAt = tok.slice(1);
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
      id: meta.id,
      date: meta.date,
      time: meta.time,
      at: meta.date ? `${meta.date}${meta.time ? ` ${meta.time}` : " 00:00"}` : "",
      // 정렬용. 시각을 안 적은 편은 그날 맨 뒤로 갑니다(아직 안 정한 것이므로)
      sortKey: meta.date ? Number(new Date(`${meta.date}T${meta.time || "23:59"}:00+09:00`)) : Infinity,
      kind: meta.kind || baseKind,
      status: meta.status || "draft",
      postedAt: meta.postedAt,
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

  if (!p.id) add("warn", "고유번호가 없습니다. npm run thread -- --ids 로 채우세요.");
  if (!p.date) add("warn", "나갈 날짜가 없습니다. === 뒤에 2026-08-04 08:37 처럼 적어두세요.");
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
  const out = batches
    .filter((b) => b.source && b.posts.length % PER_DAY !== 0)
    .map((b) => {
      const short = PER_DAY - (b.posts.length % PER_DAY);
      const down = b.posts.length - (b.posts.length % PER_DAY);
      return `${b.file}: ${b.posts.length}편입니다. ${b.posts.length + short}편으로 늘리거나 ${down}편으로 줄이세요(3의 배수).`;
    });

  /* 고유번호가 겹치면 번호로 글을 가리키는 일이 전부 어긋납니다.
     손으로 복사해서 편을 늘릴 때 실제로 생기는 실수라 여기서 잡습니다. */
  const seen = new Map();
  batches.forEach((b) => b.posts.forEach((p) => {
    if (!p.id) return;
    if (seen.has(p.id)) out.push(`고유번호 ${p.id} 가 ${seen.get(p.id)} 와 ${b.file} 에서 겹칩니다.`);
    else seen.set(p.id, b.file);
  }));
  return out;
}

/* 번호가 없는 편에만 번호를 붙입니다. 이미 붙은 번호는 건드리지 않습니다.
   붙는 순서는 나갈 순서(큐 순서)입니다. AA01 이 가장 먼저 나가는 편이 되도록. */
function fillIds(batches) {
  const used = batches.flatMap((b) => b.posts.map((p) => p.id)).filter(Boolean).sort();
  let last = used.length ? used[used.length - 1] : "";
  const assigned = new Map();
  queueOf(batches).forEach((p) => {
    if (p.id) return;
    last = nextId(last);
    if (!last) throw new Error("고유번호를 다 썼습니다(ZZ99).");
    assigned.set(`${p.file}#${p.n}`, last);
  });
  return assigned;
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

  /* 같은 블로그 글에서 뽑은 편이 연달아 나가는 길이.
     편수보다 이쪽이 피로를 만듭니다. 나흘 내리 같은 주제면 기록이 아니라 연재 광고로 읽히고,
     첫 편에 흥미를 느껴 팔로우한 사람이 사흘째에 언팔합니다.
     그래서 배치를 순서대로 흘리지 않고 겹쳐서 흘립니다. */
  let topicRun = 0;
  let worstTopic = 0;
  queue.forEach((p, i) => {
    topicRun = i > 0 && p.source && p.source === queue[i - 1].source ? topicRun + 1 : 1;
    worstTopic = Math.max(worstTopic, topicRun);
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
    longestTopicRun: worstTopic,
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

/* ---------- 발행 시각 ----------
   쓰레드는 아직 팔로우하지 않은 계정의 글을 넓게 노출시키는 단계라, 올리는 횟수가 곧 기회입니다.
   하루 한두 편이면 그 기회를 거의 안 쓰고, 열 편을 넘기면 한 계정이 피드를 덮어 오히려 언팔이 늡니다.
   그래서 평일 3~4편, 주말 2편을 기준으로 둡니다.

   규칙적일수록 손해입니다. 매일 정확히 세 번, 그것도 같은 분에 올라가면 사람이 아니라
   예약 발행으로 읽힙니다. 그렇게 보이는 계정에는 댓글이 안 붙고, 댓글이 안 붙으면 노출이 떨어집니다.
   그래서 편수도 분도 매번 다시 뽑습니다. 시간대만 지킵니다. */

// 하루 편수별 시간대. 21시대는 한국 사용자가 가장 붐비는 시간이라 몇 편이든 항상 씁니다.
const HOUR_SETS = {
  1: [[21]],
  2: [[8, 21], [12, 21], [8, 12]],
  3: [[8, 12, 21]],
  4: [[8, 12, 18, 21]],
};
const pad = (n) => String(n).padStart(2, "0");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isWeekend = (date) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

/* 그날 몇 편을 올릴지. 주말은 줄이고 평일은 3~4편을 오가되 가끔 2편으로 쉽니다.
   남은 편수를 같이 보는 이유는, 마지막 날에 한 편만 덩그러니 남으면
   그날 계정이 쉬는 것처럼 보이기 때문입니다. */
function daySize(date, left) {
  if (left <= 2) return left;
  // 요일을 먼저 봅니다. 남은 편수로 먼저 자르면 마지막 주말에 네 편이 몰립니다.
  /* 평일 2~3편, 주말 2편. 상한을 3으로 둔 이유는 두 가지입니다.
     하나, 소재가 마르는 속도. 블로그 한 편에서 아홉 편이 나오는데 하루 네 편이면 이틀 반이면 끝납니다.
     둘, 줄이는 건 눈에 띕니다. 네 편 하다가 두 편으로 내려가면 식은 계정으로 읽히지만,
     두세 편으로 시작해서 올리는 건 아무도 눈치채지 못하면서 계정이 커지는 것처럼 보입니다. */
  let size = Math.min(isWeekend(date) ? 2 : pick([2, 3, 3]), left);
  if (left - size === 1) size = Math.min(size + 1, 4, left); // 다음 날 한 편만 남기지 않기
  if (left - size === 1) size = Math.max(size - 1, 2); // 그래도 하나 남으면 두 편을 넘기기
  return Math.min(size, left);
}

/* 날짜만 더하는 계산이라 UTC 자정을 기준으로 잡습니다.
   +09:00 으로 만들면 toISOString 이 UTC 로 되돌리면서 하루 앞 날짜가 찍힙니다. */
function scheduleFor(startDate, count) {
  const out = [];
  let day = new Date(`${startDate}T00:00:00Z`);
  while (out.length < count) {
    const date = day.toISOString().slice(0, 10);
    const size = daySize(date, count - out.length);
    // 분은 1~59. 정각을 빼는 이유는 08:00 같은 시각이 예약 발행처럼 보이는 대표적인 모양이라서입니다.
    pick(HOUR_SETS[size]).forEach((h) => out.push(`${date} ${pad(h)}:${pad(1 + Math.floor(Math.random() * 59))}`));
    day = new Date(day.getTime() + 86400000);
  }
  return out;
}

function seedFrom(post, startDate, afterId) {
  const hooks = hookCandidates(post);
  const heads = outline(post);
  let id = afterId || "";
  // 소제목 수에서 출발하되 3의 배수로 맞춥니다(3, 6, 9). 하루 세 편이 기준이라 딱 떨어져야 합니다.
  const count = Math.min(Math.max(Math.round(heads.length / PER_DAY) * PER_DAY, PER_DAY), PER_DAY * 3);
  const when = scheduleFor(startDate, count);

  const body = when
    .map((at, i) => {
      const angle = heads[i] ? `소재: ${heads[i]}` : "소재: 글에서 하나 더 고르세요";
      const hook = hooks[i] ? `\n     첫 줄 후보: ${hooks[i]}` : "";
      const tail = i === count - 1 ? "\n     마지막 편에서만 블로그 링크를 겁니다." : "";
      const [d, t] = at.split(" ");
      id = nextId(id);
      return `=== ${d} ${id} ${t} work\n<!-- ${angle}${hook}${tail} -->\n(여기에 한 편)\n`;
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

/* 번호가 없는 편에 번호를 써 넣고, === 줄을 표준 형태로 정리합니다.
   표준 형태:  === 날짜 번호 시각 성격 상태
   (파서는 순서를 가리지 않지만, 파일을 눈으로 볼 때 자리가 고정돼 있어야 읽힙니다) */
function writeIds(dir) {
  const batches = loadThreads(dir);
  const assigned = fillIds(batches);
  let added = 0;
  batches.forEach((b) => {
    const file = path.join(dir, b.file);
    let seen = 0;
    const out = fs.readFileSync(file, "utf8").replace(/^=== .*$/gm, (line) => {
      seen += 1;
      const m = parseMeta(line.replace(/^=== */, ""));
      const id = m.id || assigned.get(`${b.file}#${seen}`) || "";
      if (!m.id && id) added += 1;
      return `=== ${[m.date, id, m.time, m.kind, m.status, ...m.unknown].filter(Boolean).join(" ")}`;
    });
    fs.writeFileSync(file, out);
  });
  return added;
}

/* 발행한 편에 표시를 남깁니다. 고유번호로 찾아 상태만 바꿉니다.
   발행 자동화가 성공한 직후에 부릅니다. 이게 안 되면 다음 실행이 같은 편을 또 올립니다.
   그래서 찾지 못하면 조용히 넘어가지 않고 예외를 던집니다. */
function markPosted(dir, id, when) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  for (const f of files) {
    const p = path.join(dir, f);
    const src = fs.readFileSync(p, "utf8");
    let hit = false;
    const out = src.replace(/^=== .*$/gm, (line) => {
      const m = parseMeta(line.replace(/^=== */, ""));
      if (m.id !== id || hit) return line;
      hit = true;
      const parts = [m.date, m.id, m.time, m.kind, "posted", ...m.unknown].filter(Boolean);
      // 올린 시각을 뒤에 남깁니다. 예약 시각과 실제 시각이 얼마나 벌어졌는지 나중에 볼 수 있게.
      return `=== ${parts.join(" ")}${when ? ` @${when}` : ""}`;
    });
    if (hit) {
      fs.writeFileSync(p, out);
      return f;
    }
  }
  throw new Error(`${id} 를 찾지 못했습니다. 표시를 못 남기면 다음 실행이 같은 편을 또 올립니다.`);
}

/* 관리 화면에서 고친 본문을 파일에 다시 씁니다.
   원고의 원본은 언제나 content/threads 의 마크다운입니다. 화면은 그것을 비추기만 합니다.
   그래서 여기서도 그 파일을 직접 고치고, 나머지 줄은 한 글자도 건드리지 않습니다.

   준비됨(ready) 인 편만 고칠 수 있습니다.
   발행됨은 이미 쓰레드에 올라간 글이라 여기서 고쳐봐야 화면과 실제가 어긋나기만 합니다.
   초안은 아직 뼈대라 에디터에서 통째로 쓰는 편이 낫고요. */
function writeText(dir, id, part, text) {
  /* 브라우저의 편집기가 섞어 넣는 것들을 걷어냅니다.
     줄바꿈은 \n 으로, 안 보이는 공백(nbsp)은 보통 공백으로. 안 그러면 파일에 눈에 안 띄는 글자가 남습니다. */
  const clean = String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) throw new Error("내용이 비어 있습니다.");
  // === 나 --- 를 본문에 넣으면 저장하는 순간 한 편이 두 편으로 쪼개집니다.
  if (/^[ \t]*(===|---)[ \t]*$/m.test(clean)) throw new Error("본문에 === 나 --- 만 있는 줄은 넣을 수 없습니다. 편이 쪼개집니다.");
  if (countChars(clean) > LIMIT) throw new Error(`${countChars(clean)}자입니다. 상한 ${LIMIT}자를 넘어 저장하지 않습니다.`);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  for (const f of files) {
    const p = path.join(dir, f);
    /* 줄 끝이 파일마다 다를 수 있습니다.
       깃이 윈도우에서 체크아웃하면 CRLF 로 쓰고, 이 스크립트가 쓰면 LF 입니다.
       읽을 때 LF 로 맞춰서 다루고, 쓸 때 원래 방식으로 되돌립니다.
       안 그러면 손대지 않은 줄까지 전부 바뀐 것으로 잡혀 무엇을 고쳤는지 알아볼 수 없게 됩니다. */
    const raw = fs.readFileSync(p, "utf8");
    const crlf = /\r\n/.test(raw);
    const lines = (crlf ? raw.replace(/\r\n/g, "\n") : raw).split("\n");

    let head = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^=== /.test(lines[i])) continue;
      const m = parseMeta(lines[i].replace(/^=== */, ""));
      if (m.id !== id) continue;
      if (m.status === "posted") throw new Error(`${id} 은 이미 발행된 편입니다. 여기서는 고칠 수 없습니다.`);
      if (m.status !== "ready") throw new Error(`${id} 은 준비됨 상태가 아닙니다. 에디터에서 여세요.`);
      head = i;
      break;
    }
    if (head < 0) continue;

    let end = lines.length;
    for (let i = head + 1; i < lines.length; i += 1) if (/^=== /.test(lines[i])) { end = i; break; }

    const body = lines.slice(head + 1, end).join("\n");
    /* 메모가 섞인 본문은 손대지 않습니다. 화면에는 메모가 지워진 채로 보이므로
       그대로 저장하면 파일에서 메모가 조용히 사라집니다. */
    if (body.includes("<!--")) throw new Error(`${id} 본문에 메모(<!-- -->)가 있습니다. 파일을 직접 여세요.`);

    // 답글 경계는 남기고 해당 조각만 갈아 끼웁니다. 빈 조각은 편으로 세지 않습니다(splitReplies 와 같은 기준).
    const chunks = body.split(/^[ \t]*---[ \t]*$/m);
    const live = chunks.map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);
    const at = live[Number(part || 1) - 1];
    if (at === undefined) throw new Error(`${id} 에 ${part}번째 조각이 없습니다.`);
    /* 앞뒤 빈 줄은 원래 있던 만큼 그대로 둡니다.
       그래야 안 고치고 저장했을 때 파일이 한 바이트도 안 바뀝니다.
       매번 여백이 한 줄씩 달라지면 무엇을 실제로 고쳤는지 커밋 기록에서 알아볼 수 없게 됩니다. */
    const lead = at === 0 ? "" : (chunks[at].match(/^\n*/) || ["\n"])[0] || "\n";
    const tail = (chunks[at].match(/\n*$/) || ["\n"])[0] || "\n";
    chunks[at] = `${lead}${clean}${tail}`;

    const out = [...lines.slice(0, head + 1), ...chunks.join("---").split("\n"), ...lines.slice(end)].join("\n");
    fs.writeFileSync(p, crlf ? out.replace(/\n/g, "\r\n") : out);
    return { file: f, len: countChars(clean) };
  }
  throw new Error(`${id} 을 찾지 못했습니다.`);
}

/* 아직 안 올린 편들의 날짜를 통째로 미룹니다.
   큐를 짜둔 뒤 며칠 미루는 일은 늘 생깁니다. 그때 마흔 줄을 손으로 고치면 실수가 납니다.
   이미 posted 인 편은 건드리지 않습니다. 지나간 기록이라서요. */
function shiftDays(dir, days) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  let moved = 0;
  files.forEach((f) => {
    const p = path.join(dir, f);
    const out = fs.readFileSync(p, "utf8").replace(/^=== .*$/gm, (line) => {
      const m = parseMeta(line.replace(/^=== */, ""));
      if (!m.date || m.status === "posted") return line;
      const d = new Date(`${m.date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      moved += 1;
      return `=== ${[d.toISOString().slice(0, 10), m.id, m.time, m.kind, m.status, ...m.unknown].filter(Boolean).join(" ")}`;
    });
    fs.writeFileSync(p, out);
  });
  return moved;
}

/* ---------- CLI ---------- */
function cli(argv) {
  const { loadPosts } = require("./posts");
  const ROOT = path.join(__dirname, "..");
  const CONTENT = path.join(ROOT, "content");
  const THREADS = path.join(CONTENT, "threads");

  if (argv.includes("--ids")) {
    const added = writeIds(THREADS);
    console.log(added ? `고유번호 ${added}개를 붙였습니다.` : "번호가 빠진 편이 없습니다.");
    return;
  }

  const shift = argv.find((a) => /^--shift=-?\d+$/.test(a));
  if (shift) {
    const days = Number(shift.split("=")[1]);
    const moved = shiftDays(THREADS, days);
    console.log(`아직 안 올린 ${moved}편을 ${days > 0 ? `${days}일 뒤로` : `${-days}일 앞으로`} 옮겼습니다.`);
    console.log("발행한 편은 건드리지 않았습니다.");
    return;
  }

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
    // 이미 쓰인 번호 다음부터 이어 붙입니다
    const used = loadThreads(THREADS).flatMap((b) => b.posts.map((p) => p.id)).filter(Boolean).sort();
    fs.writeFileSync(out, seedFrom(post, start, used[used.length - 1] || ""), "utf8");
    console.log(`만들었습니다: ${path.relative(ROOT, out)} (${start} 부터)`);
  });

  console.log("\n관리 페이지의 쓰레드 탭에서 나갈 순서와 편별 글자 수를 봅니다.");
  console.log("  npm run dev → http://localhost:4000/admin");
}

if (require.main === module) cli(process.argv.slice(2));

module.exports = { LIMIT, SOFT, PER_DAY, STATUS, KIND, loadThreads, queueOf, queueStats, checkPost, batchIssues, countChars, seedFrom, scheduleFor, nextId, fillIds, writeIds, markPosted, writeText };
