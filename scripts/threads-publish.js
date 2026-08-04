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

   예약 시각을 지키는 방법
     깃허브의 예약 실행은 시각을 지켜주지 않습니다. 몇 분에서 몇십 분씩 밀려서 시작합니다.
     그래서 회차가 도는 시각에 올리지 않고, 예약 시각보다 일찍 잡힌 회차가 그 편을 맡아
     남은 시간을 이 안에서 자면서 기다렸다가 정확히 그 시각에 올립니다.
     관리 화면에 적힌 시각이 곧 실제로 올라가는 시각입니다.

   안전장치
     · 한 번 실행에 한 편만 올립니다. 버그가 나도 큐가 통째로 나가지 않습니다.
     · 하루 상한을 넘기면 올리지 않습니다.
     · status 가 ready 인 편만 올립니다. draft 는 건드리지 않습니다.
     · 언제나 큐에서 가장 이른 편부터 올립니다. 건너뛰지 않습니다.
       예약 시각이 너무 지났으면 그 편을 건너뛰는 대신 아예 멈춥니다.
       건너뛰면 순서가 뒤집혀 계정의 첫 글이 인사가 아니라 본론이 되어 버립니다.
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
const SETTLE_MS = 30000;    // 컨테이너를 만든 뒤 발행까지 두는 시간(메타 권장)

/* 예약 시각을 지키기 위한 두 값.

   LEAD_MIN  이만큼 앞이면 이 회차가 그 편을 맡아 예약 시각까지 기다립니다.
             깃허브 예약 실행이 밀리는 폭을 덮을 만큼 넉넉해야 합니다.
             짧으면 아무 회차도 못 맡아서 예약 시각을 지나친 뒤에야 올라갑니다.
   LATE_LIMIT_MIN  이보다 더 지났으면 아예 멈춥니다.
             건너뛰고 다음 편을 올리면 순서가 뒤집히므로, 늦은 채로 올리거나 멈추거나 둘 중 하나입니다.
             두 시간까지는 늦더라도 올리는 편이 낫고, 그 이상이면 사람이 봐야 합니다. */
const LEAD_MIN = 25;
const LATE_LIMIT_MIN = 120;

/* 시각 다루기.
   깃허브 액션은 UTC 로 돌고 우리 예약 시각은 한국 시각이라, 둘을 섞으면 아홉 시간이 어긋납니다.

   그래서 역할을 나눕니다.
     비교는 항상 진짜 시각(epoch)으로 합니다.
     한국 시각은 화면에 찍거나 "오늘"을 가를 때만 씁니다.
   보정한 값을 그대로 비교에 쓰면 아홉 시간 뒤의 편까지 "시각이 됐다"고 잡습니다. */
const KST = 9 * 60 * 60 * 1000;
const kstStamp = (ms) => new Date(ms + KST).toISOString().slice(0, 16); // 2026-08-03T09:02
const kstDate = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
const scheduledAt = (p) => new Date(`${p.date}T${p.time}:00+09:00`).getTime();

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

/* 올린 글의 실제 주소.
   발행 응답은 media id 만 줍니다. 사람이 눌러서 볼 수 있는 주소는 따로 물어봐야 나옵니다.
   못 받아와도 발행 자체는 이미 끝난 일이라, 알림에 주소가 빠지는 것으로 그칩니다. */
async function permalinkOf(mediaId) {
  try {
    const r = await fetch(`${API}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(TOKEN)}`);
    const body = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${body}`);
    return JSON.parse(body).permalink || "";
  } catch (e) {
    console.warn(`주소를 받아오지 못했습니다: ${e.message}`);
    return "";
  }
}

/* 기다리는 동안 관리 화면에서 원고를 고쳤을 수 있습니다.
   깃허브 액션은 회차가 시작할 때 받아온 파일을 그대로 들고 있어서, 그대로 올리면 옛 글이 나갑니다.
   올리기 직전에 한 번 더 받아와 지금 원고를 씁니다.

   그사이 발행됨으로 바뀌었거나 큐에서 빠졌으면 올리지 않습니다.
   받아오는 데 실패하면 들고 있던 원고로 올립니다. 안 올리는 것보다는 낫습니다. */
function refresh(post, text) {
  if (process.env.GITHUB_ACTIONS !== "true") return text; // 이 PC 에서는 작업 중인 파일을 건드리지 않습니다
  const r = require("child_process").spawnSync("git", ["pull", "--rebase", "origin", "main"], {
    cwd: ROOT, encoding: "utf8", timeout: 60000,
  });
  if (r.status !== 0) {
    console.warn("\n받아오지 못했습니다. 회차가 시작할 때의 원고로 올립니다.");
    console.warn(((r.stderr || "") + (r.stdout || "")).trim());
    return text;
  }
  const cur = T.queueOf(T.loadThreads(DIR)).find((p) => p.id === post.id);
  if (!cur) throw new Error(`${post.id} 이 큐에서 사라졌습니다. 올리지 않습니다.`);
  if (cur.status !== "ready") throw new Error(`${post.id} 이 ${T.STATUS[cur.status]} 으로 바뀌었습니다. 올리지 않습니다.`);
  const fresh = cur.parts.map((x) => x.text).join("\n\n");
  if (fresh !== text) {
    console.log(`\n기다리는 사이에 원고가 바뀌었습니다. 고친 글로 올립니다 (${cur.len}자).`);
    console.log("-".repeat(60));
    console.log(fresh);
    console.log("-".repeat(60));
  }
  return fresh;
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
  const now = Date.now();

  console.log(`지금 ${kstStamp(now)} (한국 시각)`);

  /* 언제나 큐에서 가장 이른, 아직 안 올린 편 하나만 봅니다.
     "시각이 된 편들" 중에서 고르지 않는 이유는, 그러면 앞 편을 건너뛸 길이 생기기 때문입니다.
     순서가 뒤집히면 계정의 첫 글이 인사가 아니라 본론이 되는 식으로 망가집니다. */
  const post = queue.find((p) => p.status === "ready" && p.date && p.time);
  if (!post) {
    console.log("올릴 편이 남지 않았습니다.");
    return;
  }

  const at = scheduledAt(post);
  const offMin = (at - now) / 60000; // 양수면 아직 남은 것, 음수면 이미 지난 것
  console.log(`큐 ${queue.length}편 · 다음 편 ${post.id} ${post.at} (${T.KIND[post.kind]})`);

  if (offMin > LEAD_MIN) {
    console.log(`예약 시각까지 ${Math.round(offMin)}분 남았습니다. 이번 회차는 그냥 지나갑니다.`);
    return;
  }
  if (-offMin > LATE_LIMIT_MIN) {
    console.warn(`\n멈춥니다. ${post.id} (${post.at}) 의 예약 시각이 ${Math.round(-offMin / 60)}시간 지났습니다.`);
    console.warn("이 편을 건너뛰고 다음 편을 올리면 순서가 뒤집히므로 아무것도 올리지 않습니다.");
    console.warn("큐를 다시 맞추세요:  npm run thread -- --shift=N");
    return;
  }

  /* 그날 상한. 실제로 올라간 시각을 먼저 보고, 없으면 예약 날짜로 셉니다.
     지금 날짜가 아니라 이 편의 예약 날짜로 세는 이유는, 자정 직전에 다음 날 편을 기다리는 경우에도
     상한이 그 편이 나갈 날 기준으로 맞아야 하기 때문입니다. */
  const sameDay = queue.filter(
    (p) => p.status === "posted" && (p.postedAt ? p.postedAt.slice(0, 10) : p.date) === post.date
  ).length;
  console.log(`${post.date} 에 나간 것 ${sameDay}/${DAILY_CAP}편`);
  if (sameDay >= DAILY_CAP) {
    console.log(`그날 상한(${DAILY_CAP}편)을 채웠습니다. 올리지 않습니다.`);
    return;
  }

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

  /* 예약 시각까지 이 안에서 기다립니다.

     깃허브의 예약 실행은 시각을 지켜주지 않습니다. 15분마다 돌라고 적어도 실제 시작은
     몇 분에서 몇십 분씩 밀립니다. 회차가 도는 시각에 맞춰 올리면 화면에 적힌 08:58 이
     실제로는 09:11 이 됩니다. 시각을 흩어 놓은 이유가 사람이 올리는 것처럼 보이려는 것인데
     매번 밀리면 그 의도가 사라집니다.

     그래서 회차는 예약 시각보다 조금 일찍 잡히게 두고(LEAD_MIN), 남은 시간은 여기서 잡니다.
     쓰레드는 글을 두 번에 나눠 올립니다(만들고, 잠시 뒤 발행). 그 사이 시간만큼 앞당겨 시작해야
     실제로 발행되는 순간이 예약 시각에 맞습니다. */
  const startAt = at - SETTLE_MS;
  const waitMs = Math.max(0, startAt - Date.now());

  const plan = waitMs > 0
    ? `${Math.round(waitMs / 1000)}초 기다렸다가 ${post.time} 에 올립니다.`
    : offMin > 0
      ? `지금 만들면 ${post.time} 에 올라갑니다. 바로 시작합니다.`
      : `예약 시각이 ${Math.round(-offMin)}분 지났습니다. 바로 올립니다.`;

  if (!LIVE) {
    console.log(`\n드라이런입니다. 실제로는 ${plan}`);
    console.log("실제로 올리려면 THREADS_LIVE=1 을 주세요.");
    return;
  }

  if (!USER_ID || !TOKEN) {
    console.error("\nTHREADS_USER_ID 와 THREADS_ACCESS_TOKEN 이 필요합니다.");
    process.exit(1);
  }

  console.log(`\n${plan}`);

  return new Promise((r) => setTimeout(r, waitMs))
    .then(() => refresh(post, text))
    .then((fresh) => publish(fresh))
    .then(async (mediaId) => {
      const done = Date.now();
      const file = T.markPosted(DIR, post.id, kstStamp(done));
      console.log(`\n올렸습니다. media id ${mediaId}`);
      console.log(`예약 ${post.at} · 실제 ${kstStamp(done).replace("T", " ")} (${Math.round((done - at) / 1000)}초 차이)`);
      console.log(`${file} 의 ${post.id} 에 posted 표시를 남겼습니다.`);

      /* 알림은 여기서, 표시를 남긴 뒤에 보냅니다.
         알림이 먼저 나가고 표시가 실패하면 다음 회차가 같은 편을 또 올립니다. 순서가 중요합니다. */
      const link = await permalinkOf(mediaId);
      if (link) console.log(`주소 ${link}`);
      await require("./notify").notifyPosted({
        id: post.id,
        at: kstStamp(done).replace("T", " "),
        len: post.len,
        link,
      });
    });
}

Promise.resolve()
  .then(main)
  .catch((e) => {
    console.error("실패:", e.message);
    /* process.exit 로 즉시 끊지 않습니다. 정리 중인 타이머가 남아 있으면 윈도우에서
       libuv 어설션이 찍혀 진짜 오류 메시지가 묻힙니다. 종료 코드는 그대로 1 입니다. */
    process.exitCode = 1;
  });
