/* ============================================================
   발행 알림 켜기 (이 PC 에서 한 번만 돌립니다)

   실행:  npm run notify

   하는 일
     1. 번호와 열쇠를 물어봅니다
     2. 그 자리에서 시험 알림을 한 통 보내 봅니다
     3. 잘 갔으면 깃허브 시크릿에 넣습니다

   시험을 먼저 보내는 이유는, 값이 틀렸을 때 내일 아침에야 아는 일을 막기 위해서입니다.
   알림이 안 와도 글은 그대로 올라가므로, 안 온 것을 눈치채기까지 며칠이 걸립니다.

   열쇠는 명령줄 인자로 받지 않고 물어봅니다.
   인자로 주면 파워셸 명령 기록(ConsoleHost_history.txt)에 그대로 남습니다.

   CallMeBot 열쇠 받는 법
     1. 왓츠앱에서 +34 644 05 92 17 을 연락처에 추가합니다
     2. 그 번호로 아래 문장을 그대로 보냅니다
          I allow callmebot to send me messages
     3. 2분 안에 답장으로 열쇠(apikey)가 옵니다

   봇 번호는 종종 바뀝니다. 옛 번호로 보내면 읽음 표시는 뜨는데 열쇠가 오지 않습니다.
   안 오면 이 번호부터 현재 것인지 확인하세요.
     https://www.callmebot.com/blog/free-api-whatsapp-messages/
   번호가 맞는데도 2분 안에 안 오면, 안내에 따르면 24시간 뒤에 다시 시도해야 합니다.
   ============================================================ */
const { spawnSync } = require("child_process");

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

const set = (name, value) => {
  const p = spawnSync("gh", ["secret", "set", name], {
    input: value, encoding: "utf8", shell: process.platform === "win32",
  });
  if (p.status !== 0) throw new Error(`gh secret set ${name} 실패: ${(p.stderr || p.stdout || "").trim()}`);
  console.log(`  ${name} 저장`);
};

async function main() {
  console.log("쓰레드 발행 알림을 켭니다 (CallMeBot).\n");
  console.log("아직 열쇠가 없다면 먼저 이것부터 하세요.");
  console.log("  1. 왓츠앱에서 +34 644 05 92 17 을 연락처에 추가");
  console.log("  2. 그 번호로 보내기:  I allow callmebot to send me messages");
  console.log("  3. 2분 안에 답장으로 오는 열쇠를 복사\n");
  console.log("  열쇠가 안 오면 봇 번호가 바뀐 것입니다. 아래에서 현재 번호를 확인하세요.");
  console.log("  https://www.callmebot.com/blog/free-api-whatsapp-messages/\n");

  const phone = await ask("받을 번호 (국가번호까지 숫자만, 예 821012345678): ");
  if (!/^\d{8,15}$/.test(phone)) {
    console.error("번호가 이상합니다. + 나 - 없이 숫자만, 국가번호까지 붙여 적으세요.");
    process.exitCode = 1;
    return;
  }
  const key = await ask("열쇠(apikey): ");
  if (!key) {
    console.error("열쇠가 없습니다.");
    process.exitCode = 1;
    return;
  }

  // 시험 알림. 진짜 발행 때와 같은 코드를 그대로 씁니다.
  process.env.CALLMEBOT_PHONE = phone;
  process.env.CALLMEBOT_KEY = key;
  console.log("\n시험 알림을 보냅니다...");
  const sent = await require("./notify").notifyPosted({
    id: "시험",
    at: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " "),
    len: 0,
    link: "https://kadecho.dev/",
  });
  if (!sent) {
    console.error("\n보내지 못했습니다. 번호나 열쇠를 다시 보세요. 깃허브에는 아무것도 넣지 않았습니다.");
    process.exitCode = 1;
    return;
  }

  console.log("왓츠앱을 확인해 보세요. 몇 초 안에 옵니다.\n");
  const ok = await ask("알림이 도착했나요? (y 를 누르면 깃허브에 저장합니다): ");
  if (ok.toLowerCase() !== "y") {
    console.log("저장하지 않았습니다. 값을 고쳐서 다시 실행하세요.");
    return;
  }

  console.log("\n깃허브 시크릿에 넣는 중...");
  set("CALLMEBOT_PHONE", phone);
  set("CALLMEBOT_KEY", key);
  console.log("\n됐습니다. 이제 글이 올라갈 때마다 링크가 왓츠앱으로 옵니다.");
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
