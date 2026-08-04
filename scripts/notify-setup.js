/* ============================================================
   발행 알림 켜기 (이 PC 에서 한 번만 돌립니다)

   실행:  npm run notify

   하는 일
     1. 봇 토큰을 물어보고 진짜 봇인지 확인합니다
     2. 봇에게 아무 말이나 보내라고 하고, 대화방 번호를 알아서 찾아냅니다
     3. 그 자리에서 시험 알림을 한 통 보냅니다
     4. 도착한 것을 확인하고 나서야 깃허브 시크릿에 넣습니다

   대화방 번호를 직접 찾게 하지 않는 이유는, 그게 이 과정에서 제일 헤매는 지점이기 때문입니다.
   시험을 먼저 보내는 이유는, 값이 틀렸을 때 내일 아침에야 아는 일을 막기 위해서입니다.
   알림이 안 와도 글은 그대로 올라가므로, 안 온 것을 눈치채기까지 며칠이 걸립니다.

   토큰은 명령줄 인자로 받지 않고 물어봅니다.
   인자로 주면 파워셸 명령 기록(ConsoleHost_history.txt)에 그대로 남습니다.

   봇 만드는 법
     1. 텔레그램에서 @BotFather 를 찾아 대화를 시작합니다
     2. /newbot 을 보냅니다
     3. 봇 이름을 정합니다 (아무거나. 예: kadecho 발행알림)
     4. 봇 아이디를 정합니다 (반드시 bot 으로 끝나야 합니다. 예: kadecho_publish_bot)
     5. 토큰이 나옵니다. 숫자:영문 꼴입니다
   ============================================================ */
const { spawnSync } = require("child_process");

const API = "https://api.telegram.org";

/* 여러 번 물어봅니다. 그래서 한 줄 읽을 때마다 stdin 을 놓아 버리면 안 됩니다.
   놓아 버리면(unref) 다음 물음을 기다리는 동안 프로세스가 그냥 끝나 버립니다.
   읽는 동안에는 붙잡아 두고(ref), 다 물어본 뒤에 done() 으로 한 번만 놓아 줍니다.
   끝까지 안 놓으면 윈도우에서 종료할 때 핸들이 남아 오류가 찍힙니다.

   남은 줄은 buf 에 모아 둡니다. 파이프로 여러 줄이 한꺼번에 들어오면
   첫 줄만 쓰고 나머지를 버리게 되어, 그다음 물음이 영영 답을 못 받습니다. */
let buf = "";
let wired = false;

function ask(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.ref();
    process.stdin.resume();

    const take = () => {
      const at = buf.indexOf("\n");
      if (at < 0) return false;
      const line = buf.slice(0, at);
      buf = buf.slice(at + 1);
      process.stdin.off("data", onData);
      resolve(line.trim());
      return true;
    };
    const onData = (d) => {
      buf += d;
      take();
    };

    if (take()) return; // 앞서 들어와 쌓여 있던 줄이 있으면 그것부터
    process.stdin.on("data", onData);
    wired = true;
  });
}

function done() {
  if (!wired) return;
  process.stdin.pause();
  process.stdin.unref();
}

async function tg(token, method) {
  const r = await fetch(`${API}/bot${token}/${method}`, { signal: AbortSignal.timeout(20000) });
  const body = await r.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    throw new Error(`텔레그램이 이상한 답을 보냈습니다: ${body.slice(0, 200)}`);
  }
  if (!json.ok) throw new Error(`${method} 실패: ${json.description || body.slice(0, 200)}`);
  return json.result;
}

const set = (name, value) => {
  const p = spawnSync("gh", ["secret", "set", name], {
    input: value, encoding: "utf8", shell: process.platform === "win32",
  });
  if (p.status !== 0) throw new Error(`gh secret set ${name} 실패: ${(p.stderr || p.stdout || "").trim()}`);
  console.log(`  ${name} 저장`);
};

/* 봇에게 온 말들 중에서 대화방 번호를 꺼냅니다.
   여러 번 확인하는 이유는, 엔터를 누른 순간과 메시지가 텔레그램 서버에 닿는 순간이
   몇 초 어긋나는 일이 흔하기 때문입니다. 한 번 보고 없다고 끝내면 대부분 실패합니다. */
async function findChat(token, tries = 10) {
  for (let i = 0; i < tries; i += 1) {
    const updates = await tg(token, "getUpdates");
    const hit = updates
      .map((u) => u.message || u.edited_message || u.channel_post)
      .filter(Boolean)
      .pop();
    if (hit) return hit.chat;
    if (i === 0) process.stdout.write("  기다리는 중");
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function main() {
  console.log("쓰레드 발행 알림을 켭니다 (텔레그램).\n");
  console.log("아직 봇이 없다면 먼저 이것부터 하세요.");
  console.log("  1. 텔레그램에서 @BotFather 를 찾아 대화 시작");
  console.log("  2. /newbot 보내기");
  console.log("  3. 봇 이름 정하기 (아무거나)");
  console.log("  4. 봇 아이디 정하기 (반드시 bot 으로 끝나야 합니다)");
  console.log("  5. 나온 토큰을 복사\n");

  const token = await ask("봇 토큰: ");
  if (!/^\d+:[\w-]+$/.test(token)) {
    console.error("토큰이 이상합니다. 숫자:영문 꼴이어야 합니다. BotFather 가 준 줄을 그대로 붙여넣으세요.");
    process.exitCode = 1;
    return;
  }

  const me = await tg(token, "getMe");
  console.log(`\n봇 확인: @${me.username}\n`);

  /* 봇은 먼저 말을 걸 수 없습니다. 사람이 한 번 말을 걸어야 대화방이 생깁니다.
     그 대화방 번호를 알아야 발행할 때 그리로 보낼 수 있습니다. */
  console.log(`아래 주소를 열어 그 봇에게 아무 말이나 보내세요. 시작 버튼만 눌러도 됩니다.`);
  console.log(`  https://t.me/${me.username}\n`);
  await ask("보냈으면 엔터: ");

  const chat = await findChat(token);
  if (!chat) {
    console.error("\n\n봇에게 온 말을 찾지 못했습니다.");
    console.error(`https://t.me/${me.username} 에서 메시지를 보낸 뒤 다시 실행하세요.`);
    process.exitCode = 1;
    return;
  }
  const who = chat.username ? `@${chat.username}` : [chat.first_name, chat.last_name].filter(Boolean).join(" ");
  console.log(`\n대화방 확인: ${who || chat.id}\n`);

  // 시험 알림. 진짜 발행 때와 같은 코드를 그대로 씁니다.
  process.env.TELEGRAM_TOKEN = token;
  process.env.TELEGRAM_CHAT_ID = String(chat.id);
  console.log("시험 알림을 보냅니다...");
  /* 진짜 발행 때는 여기에 쓰레드 글 주소가 들어갑니다.
     시험에 블로그 주소 같은 진짜 링크를 넣으면, 나중에 그게 원래 오는 것인 줄 알게 됩니다.
     그래서 시험이라는 것이 문구에서 바로 드러나게 둡니다. */
  const sent = await require("./notify").notifyPosted({
    id: "시험 (실제 발행이 아닙니다)",
    at: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " "),
    len: 0,
    link: "여기에 실제 쓰레드 글 주소가 들어갑니다",
  });
  if (!sent) {
    console.error("\n보내지 못했습니다. 깃허브에는 아무것도 넣지 않았습니다.");
    process.exitCode = 1;
    return;
  }

  console.log("텔레그램을 확인해 보세요. 바로 옵니다.\n");
  const ok = await ask("알림이 도착했나요? (y 를 누르면 깃허브에 저장합니다): ");
  if (ok.toLowerCase() !== "y") {
    console.log("저장하지 않았습니다. 값을 고쳐서 다시 실행하세요.");
    return;
  }

  console.log("\n깃허브 시크릿에 넣는 중...");
  set("TELEGRAM_TOKEN", token);
  set("TELEGRAM_CHAT_ID", String(chat.id));
  console.log("\n됐습니다. 이제 글이 올라갈 때마다 링크가 텔레그램으로 옵니다.");
}

main()
  .catch((e) => {
    console.error("실패:", e.message);
    /* process.exit 로 즉시 끊지 않습니다. 열어 둔 stdin 이 정리되는 중에 강제로 끝내면
       윈도우에서 libuv 어설션이 찍혀 진짜 오류 메시지가 묻힙니다. */
    process.exitCode = 1;
  })
  // 어디로 빠져나가든 stdin 을 놓아 줍니다. 안 놓으면 명령이 안 끝난 것처럼 매달려 있습니다.
  .finally(done);
