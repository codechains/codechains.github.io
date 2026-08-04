/* ============================================================
   발행 알림 (왓츠앱)

   쓰레드에 글이 올라가면 링크와 함께 알려 줍니다.
   자동 발행은 사람이 안 보는 사이에 도는 일이라, 잘 나갔는지 확인할 길이 하나는 있어야 합니다.

   두 가지 길이 있고, 설정된 쪽으로 보냅니다. 아무것도 설정하지 않으면 조용히 넘어갑니다.

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
  const head = `쓰레드 ${id} 를 ${at} 에 올렸습니다 (${len}자)`;
  for (const [label, send] of [["왓츠앱", whatsappCloud], ["CallMeBot", callMeBot]]) {
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
