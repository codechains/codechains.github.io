/* ============================================================
   쓰레드 액세스 토큰 발급·갱신 (이 PC에서 한 번만 돌립니다)

   토큰은 두 단계를 거칩니다.
     1. 브라우저에서 권한을 허락하면 주소창에 code 가 찍힙니다 (몇 분짜리)
     2. code 를 짧은 토큰으로, 짧은 토큰을 60일짜리 긴 토큰으로 바꿉니다

   그런데 앱 대시보드에 User Token Generator 가 있으면 이 두 단계를 건너뜁니다.
   본인 계정을 Threads Tester 로 추가하고 수락하면, 버튼 하나로 60일 토큰이 나옵니다.
   (공개 계정만 됩니다. 비공개면 토큰이 안 나옵니다)

   쓰는 순서
     [쉬운 길] 대시보드에서 토큰을 받은 뒤
       npm run thread:token me <토큰>       사용자 ID 를 알아냅니다.

     [OAuth 로 직접 받는 길] 토큰 생성기가 없거나 남의 계정에 올릴 때
       npm run thread:token auth            권한 요청 주소를 찍어 줍니다. 브라우저에서 여세요.
       npm run thread:token code <코드>     주소창에 찍힌 code 로 60일 토큰을 받습니다.

     npm run thread:token refresh <토큰>    60일을 다시 60일로 늘립니다.

   앞의 것들은 사람이 한 번만 합니다. refresh 는 깃허브 액션이 주마다 자동으로 돕니다.

   앱 정보는 환경변수로 넣습니다. 셸에 그대로 치면 명령 기록에 남으니
   .env.threads 파일에 적어두고 쓰는 편이 낫습니다(이 파일은 커밋되지 않습니다).
     THREADS_APP_ID, THREADS_APP_SECRET, THREADS_REDIRECT_URI
   ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.threads");

/* .env.threads 를 읽어 환경변수에 얹습니다. 이미 환경변수가 있으면 그쪽이 우선입니다.
   (깃허브 액션에서는 파일이 없고 시크릿이 환경변수로 들어옵니다) */
if (fs.existsSync(ENV_FILE)) {
  fs.readFileSync(ENV_FILE, "utf8").split("\n").forEach((line) => {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
}

const APP_ID = process.env.THREADS_APP_ID;
const APP_SECRET = process.env.THREADS_APP_SECRET;
const REDIRECT = process.env.THREADS_REDIRECT_URI;
const SCOPE = "threads_basic,threads_content_publish";
const API = "https://graph.threads.net";

function need(name, value) {
  if (!value) {
    console.error(`${name} 이 없습니다. .env.threads 에 적거나 환경변수로 넣으세요.`);
    process.exit(1);
  }
  return value;
}

async function post(url, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body}`);
  return JSON.parse(body);
}

async function get(url) {
  const r = await fetch(url);
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body}`);
  return JSON.parse(body);
}

const days = (sec) => Math.round(sec / 86400);

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === "auth") {
    need("THREADS_APP_ID", APP_ID);
    need("THREADS_REDIRECT_URI", REDIRECT);
    const url = `https://threads.net/oauth/authorize?client_id=${APP_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
      `&scope=${encodeURIComponent(SCOPE)}&response_type=code`;
    console.log("아래 주소를 브라우저에서 여세요.\n");
    console.log(url);
    console.log("\n허락하면 주소창이 이렇게 바뀝니다.");
    console.log(`  ${REDIRECT}?code=AQB...#_`);
    console.log("\ncode= 뒤부터 #_ 앞까지를 복사해서 다음을 실행하세요.");
    console.log("  npm run thread:token code <복사한 코드>");
    console.log("\n코드는 몇 분이면 만료됩니다. 바로 이어서 하세요.");
    return;
  }

  if (cmd === "code") {
    need("THREADS_APP_ID", APP_ID);
    need("THREADS_APP_SECRET", APP_SECRET);
    need("THREADS_REDIRECT_URI", REDIRECT);
    if (!arg) { console.error("코드를 붙여 주세요. npm run thread:token code <코드>"); process.exit(1); }

    // 1) code → 짧은 토큰(한 시간짜리)
    const short = await post(`${API}/oauth/access_token`, {
      client_id: APP_ID,
      client_secret: APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT,
      code: arg.replace(/#_$/, ""),
    });

    // 2) 짧은 토큰 → 60일 토큰
    const long = await get(`${API}/access_token?grant_type=th_exchange_token` +
      `&client_secret=${encodeURIComponent(APP_SECRET)}` +
      `&access_token=${encodeURIComponent(short.access_token)}`);

    console.log("\n깃허브 시크릿에 아래 두 개를 넣으세요.");
    console.log("  Settings → Secrets and variables → Actions → New repository secret\n");
    console.log(`THREADS_USER_ID       ${short.user_id}`);
    console.log(`THREADS_ACCESS_TOKEN  ${long.access_token}`);
    console.log(`\n만료까지 약 ${days(long.expires_in)}일. 갱신은 액션이 주마다 자동으로 합니다.`);
    return;
  }

  if (cmd === "me") {
    /* 앱 대시보드의 User Token Generator 로 토큰을 받으면 토큰만 나오고 사용자 ID 는 안 나옵니다.
       발행 스크립트에는 둘 다 필요해서, 토큰으로 ID 를 되물어 봅니다. */
    const token = arg || process.env.THREADS_ACCESS_TOKEN;
    if (!token) { console.error("토큰을 붙여 주세요. npm run thread:token me <토큰>"); process.exit(1); }
    const r = await get(`${API}/v1.0/me?fields=id,username,threads_profile_picture_url` +
      `&access_token=${encodeURIComponent(token)}`);
    console.log(`\n계정: @${r.username}`);
    console.log("\n깃허브 시크릿에 아래 두 개를 넣으세요.");
    console.log("  Settings → Secrets and variables → Actions → New repository secret\n");
    console.log(`THREADS_USER_ID       ${r.id}`);
    console.log(`THREADS_ACCESS_TOKEN  ${token}`);
    return;
  }

  if (cmd === "refresh") {
    const token = arg || process.env.THREADS_ACCESS_TOKEN;
    if (!token) { console.error("토큰이 없습니다. npm run thread:token refresh <토큰>"); process.exit(1); }
    /* 발급 후 24시간이 지나야 갱신됩니다. 그전에 부르면 오류가 납니다.
       주마다 도는 이유는, 한 번 실패해도 다음 주에 다시 시도할 여유를 두기 위해서입니다. */
    const r = await get(`${API}/refresh_access_token?grant_type=th_refresh_token` +
      `&access_token=${encodeURIComponent(token)}`);
    // 액션이 표준출력에서 값을 집어가므로 형식을 바꾸지 마세요
    console.log(`TOKEN=${r.access_token}`);
    console.error(`갱신했습니다. 만료까지 약 ${days(r.expires_in)}일.`);
    return;
  }

  console.log("쓰는 법:");
  console.log("  npm run thread:token auth              권한 요청 주소 보기");
  console.log("  npm run thread:token code <코드>       60일 토큰 받기");
  console.log("  npm run thread:token refresh <토큰>    60일 더 늘리기");
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
