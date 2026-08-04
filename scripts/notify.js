/* ============================================================
   발행 알림 (왓츠앱)

   쓰레드에 글이 올라가면 링크와 함께 알려 줍니다.
   자동 발행은 사람이 안 보는 사이에 도는 일이라, 잘 나갔는지 확인할 길이 하나는 있어야 합니다.

   세 가지 길이 있고, 설정된 쪽으로 보냅니다. 아무것도 설정하지 않으면 조용히 넘어갑니다.

   [0] 텔레그램 (기본)
       봇을 하나 만들어 나에게만 보냅니다. 공식 API 라 승인도 과금도 없습니다.
       받는 사람이 나 하나뿐이라, 왓츠앱 쪽의 제약(템플릿 승인, 24시간 창)이 아예 안 걸립니다.
         TELEGRAM_TOKEN    BotFather 가 준 봇 토큰
         TELEGRAM_CHAT_ID  내 대화방 번호

   [1] 왓츠앱 클라우드 API (메타 공식)
       쓰레드 앱을 만든 그 메타 계정에서 그대로 이어서 씁니다. 중간에 남의 서비스가 없습니다.
       대신 미리 승인받은 서식(템플릿)으로만 보낼 수 있습니다.
         WA_PHONE_ID   보내는 번호의 ID (앱 대시보드에 있습니다)
         WA_TOKEN      왓츠앱용 액세스 토큰
         WA_TO         받을 번호. 국가번호까지 숫자만. 한국이면 8210xxxxxxxx
         WA_TEMPLATE   승인받은 템플릿 이름
         WA_LANG       템플릿 언어 코드 (기본 ko)

   [2] CallMeBot (제삼자 무료 서비스)
       왓츠앱으로 문자 한 통 보내면 열쇠가 나옵니다. 승인 절차가 없습니다.
       대신 알림 내용이 남의 서버를 거칩니다.
         CALLMEBOT_PHONE  내 번호. 국가번호까지 숫자만
         CALLMEBOT_KEY    받은 열쇠

   알림이 실패해도 발행은 실패로 치지 않습니다.
   글은 이미 올라갔는데 알림 때문에 액션이 빨간불이 되면, 다음 회차가 같은 편을 또 올리려 듭니다.
   ============================================================ */

const timeout = (ms) => AbortSignal.timeout(ms);

async function telegram({ head, link }) {
  const token = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: link ? `${head}\n${link}` : head }),
    signal: timeout(20000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`텔레그램 ${r.status} ${body.slice(0, 300)}`);
  return true;
}

async function whatsappCloud({ head, link }) {
  const id = process.env.WA_PHONE_ID;
  const token = process.env.WA_TOKEN;
  const to = process.env.WA_TO;
  const name = process.env.WA_TEMPLATE;
  if (!id || !token || !to || !name) return false;

  /* 템플릿 본문에 자리 두 개를 둡니다.  {{1}} 무엇을 올렸는지,  {{2}} 주소.
     줄바꿈은 자리값에 넣을 수 없어서, 한 줄로 이어지는 문장으로 씁니다. */
  const r = await fetch(`https://graph.facebook.com/v21.0/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: process.env.WA_LANG || "ko" },
        components: [{
          type: "body",
          parameters: [{ type: "text", text: head }, { type: "text", text: link || "(주소 없음)" }],
        }],
      },
    }),
    signal: timeout(20000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`왓츠앱 ${r.status} ${body}`);
  return true;
}

async function callMeBot({ head, link }) {
  const phone = process.env.CALLMEBOT_PHONE;
  const key = process.env.CALLMEBOT_KEY;
  if (!phone || !key) return false;

  const text = link ? `${head}\n${link}` : head;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}` +
    `&apikey=${encodeURIComponent(key)}&text=${encodeURIComponent(text)}`;
  const r = await fetch(url, { signal: timeout(20000) });
  /* 이쪽은 열쇠가 틀려도 200 을 돌려주고 본문에만 ERROR 라고 적어 보냅니다.
     상태 코드만 보면 안 간 알림을 갔다고 여기게 되므로 본문까지 봅니다. */
  const body = (await r.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!r.ok || /error/i.test(body)) throw new Error(`CallMeBot ${r.status} ${body.slice(0, 200)}`);
  return true;
}

/* 올렸다고 알립니다. 실패해도 예외를 밖으로 던지지 않습니다. */
async function notifyPosted({ id, at, len, link }) {
  /* 조사를 붙이지 않습니다. 편 번호가 AA01 이든 시험이든 어색해지지 않고,
     폰 알림 창에 잘려 보여도 앞부분만으로 무슨 일인지 알 수 있습니다.

     주소를 못 받았을 때 그냥 빼면, 알림을 받고도 왜 링크가 없는지 몰라 한참 찾게 됩니다.
     그래서 없으면 없다고 적습니다. */
  const head = `쓰레드 발행: ${id} · ${at} · ${len}자`;
  if (!link) link = "(주소를 받지 못했습니다. 쓰레드 앱에서 확인하세요)";
  // 설정된 첫 번째 것으로 보냅니다. 텔레그램이 앞에 있는 이유는 이게 기본이기 때문입니다.
  for (const [label, send] of [["텔레그램", telegram], ["왓츠앱", whatsappCloud], ["CallMeBot", callMeBot]]) {
    try {
      if (await send({ head, link })) {
        console.log(`알림을 보냈습니다 (${label}).`);
        return true;
      }
    } catch (e) {
      console.warn(`알림 실패 (${label}): ${e.message}`);
      return false;
    }
  }
  console.log("알림은 설정되지 않았습니다. 건너뜁니다.");
  return false;
}

module.exports = { notifyPosted };
