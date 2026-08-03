/* ============================================================
   쓰레드 자동 발행

   content/threads/ 의 큐를 보고, 나갈 시각이 된 편 하나를 올립니다.
   깃허브 액션이 주기적으로 부르고, 성공하면 그 편에 posted 표시를 남깁니다.

   실행
     npm run thread:publish            무엇을 올릴지만 보여줍니다(드라이런)
     THREADS_LIVE=1 npm run thread:publish   실제로 올립니다

   기본이 드라이런인 이유는, 쓰레드는 올린 뒤 5분이 지나면 수정이 안 되기 때문입니다.
   삭제하고 다시 올리는 방법뿐이고 그러면 반응이 다 날아갑니다.
   며칠 드라이런으로 돌려 시각이 맞는지 본 뒤에 실제 발행으로 넘어가세요.

   안전장치
     · 한 번 실행에 한 편만 올립니다. 버그가 나도 큐가 통째로 나가지 않습니다.
     · 하루 상한을 넘기면 올리지 않습니다.
     · status 가 ready 인 편만 올립니다. draft 는 건드리지 않습니다.
     · 예약 시각이 너무 지난 편은 건너뜁니다. 새벽 세 시에 아침 글이 나가는 게 제일 이상합니다.
   ============================================================ */
const path = require("path");
const T = require("./threads");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "content", "threads");
const API = "https://graph.threads.net/v1.0";

const LIVE = process.env.THREADS_LIVE === "1";
const USER_ID = process.env.THREADS_USER_ID;
const TOKEN = process.env.THREADS_ACCESS_TOKEN;

const DAILY_CAP = 3;        // 하루에 올릴 수 있는 최대 편수
const LATE_LIMIT_MIN = 120; // 예약 시각이 이만큼 넘게 지났으면 건너뜁니다
const SETTLE_MS = 30000;    // 컨테이너를 만든 뒤 발행까지 두는 시간(메타 권장)

/* 한국 시각 기준으로 계산합니다. 깃허브 액션은 UTC 로 돌기 때문에
   여기서 시간대를 고정하지 않으면 아홉 시간이 어긋납니다. */
const KST = 9 * 60 * 60 * 1000;
const nowKst = () => new Date(Date.now() + KST);
const kstStamp = (d) => d.toISOString().slice(0, 16); // 2026-08-03T09:02
const kstDate = (d) => d.toISOString().slice(0, 10);

async function call(endpoint, params) {
  const r = await fetch(`${API}/${USER_ID}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: TOKEN }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${endpoint} ${r.status} ${body}`);
  return JSON.parse(body);
}

async function publish(text) {
  const container = await call("threads", { media_type: "TEXT", text });
  // 컨테이너가 서버에서 처리될 시간을 줍니다. 바로 발행하면 간헐적으로 실패합니다.
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const posted = await call("threads_publish", { creation_id: container.id });
  return posted.id;
}

function main() {
  const batches = T.loadThreads(DIR);
  const queue = T.queueOf(batches);
  const now = nowKst();
  const today = kstDate(now);

  /* 오늘 이미 몇 편 나갔는지. 실제로 올라간 시각을 먼저 보고, 없으면 예약 날짜로 셉니다.
     (자동 발행 전에 손으로 올려 표시만 해둔 편도 같이 세야 상한이 맞습니다) */
  const sentToday = queue.filter(
    (p) => p.status === "posted" && (p.postedAt ? p.postedAt.slice(0, 10) : p.date) === today
  ).length;

  const due = queue.filter((p) => {
    if (p.status !== "ready" || !p.date || !p.time) return false;
    return new Date(`${p.date}T${p.time}:00+09:00`) <= now;
  });

  const late = (p) => (now - new Date(`${p.date}T${p.time}:00+09:00`)) / 60000;
  const skipped = due.filter((p) => late(p) > LATE_LIMIT_MIN);
  const ready = due.filter((p) => late(p) <= LATE_LIMIT_MIN);

  console.log(`지금 ${kstStamp(now)} (한국 시각)`);
  console.log(`큐 ${queue.length}편 · 오늘 나간 것 ${sentToday}/${DAILY_CAP} · 시각이 된 것 ${due.length}편`);

  skipped.forEach((p) => {
    console.warn(`  건너뜀: ${p.id} (${p.at}) 예약 시각이 ${Math.round(late(p) / 60)}시간 지났습니다.`);
    console.warn(`          올리려면 === 줄의 시각을 지금으로 고치세요.`);
  });

  if (sentToday >= DAILY_CAP) {
    console.log(`오늘 상한(${DAILY_CAP}편)을 채웠습니다. 올리지 않습니다.`);
    return;
  }
  if (!ready.length) {
    console.log("지금 올릴 편이 없습니다.");
    return;
  }

  const post = ready[0];
  const text = post.parts.map((x) => x.text).join("\n\n");

  if (post.parts.length > 1) {
    console.error(`${post.id} 은 답글이 딸린 편입니다. 아직 자동 발행을 지원하지 않습니다.`);
    console.error("손으로 올리고 === 줄에 posted 를 적어 두세요.");
    process.exit(1);
  }
  if (post.len > T.LIMIT) {
    console.error(`${post.id} 이 ${post.len}자입니다. 상한 ${T.LIMIT}자를 넘어 올리지 않습니다.`);
    process.exit(1);
  }

  console.log(`\n대상: ${post.id}  ${post.at}  ${T.KIND[post.kind]}  ${post.len}자  (${post.file})`);
  console.log("-".repeat(60));
  console.log(text);
  console.log("-".repeat(60));

  if (!LIVE) {
    console.log("\n드라이런입니다. 실제로는 아무것도 올리지 않았습니다.");
    console.log("실제로 올리려면 THREADS_LIVE=1 을 주세요.");
    return;
  }

  if (!USER_ID || !TOKEN) {
    console.error("\nTHREADS_USER_ID 와 THREADS_ACCESS_TOKEN 이 필요합니다.");
    process.exit(1);
  }

  return publish(text).then((mediaId) => {
    const file = T.markPosted(DIR, post.id, kstStamp(nowKst()));
    console.log(`\n올렸습니다. media id ${mediaId}`);
    console.log(`${file} 의 ${post.id} 에 posted 표시를 남겼습니다.`);
  });
}

Promise.resolve()
  .then(main)
  .catch((e) => {
    console.error("실패:", e.message);
    process.exit(1);
  });
