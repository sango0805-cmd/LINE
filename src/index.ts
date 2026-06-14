import { Hono } from "hono";
import type { AppBindings, Env } from "./env.js";
import { resolveAccount } from "./config/accounts.js";
import type { LineAccount } from "./config/accounts.js";
import { verifyLineSignature } from "./line/signature.js";
import { LineClient } from "./line/client.js";
import { getImageBase64 } from "./line/content.js";
import { buildConfirmFlex, formatJst } from "./line/flex.js";
import type { WebhookRequestBody, WebhookEvent } from "./line/types.js";
import { runScheduler } from "./ai/agent.js";
import type { InputBlock } from "./ai/agent.js";
import { savePending, takePending } from "./store/pending.js";
import { loadRecentTurns, appendTurn } from "./store/conversation.js";
import { cleanup } from "./store/cleanup.js";
import { insertEvent } from "./calendar/google.js";

const app = new Hono<AppBindings>();

// ── ヘルスチェック ──────────────────────────────────────────────────
app.get("/", (c) => c.text("line-ai-scheduler: ok"));

// ── LINE Webhook 受け口（アカウント分岐）────────────────────────────
// 個人アカウント①の受け皿 → /webhook/a
// 個人アカウント②の受け皿 → /webhook/b
app.post("/webhook/:account", async (c) => {
  const account = resolveAccount(c.env, c.req.param("account"));
  if (!account) return c.json({ error: "unknown account" }, 404);

  // 署名検証は生ボディに対して行う
  const rawBody = await c.req.text();
  const valid = await verifyLineSignature(
    account.channelSecret,
    rawBody,
    c.req.header("x-line-signature"),
  );
  if (!valid) return c.json({ error: "invalid signature" }, 401);

  let payload: WebhookRequestBody;
  try {
    payload = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  // 重い処理（画像取得・Claude解析・カレンダー登録）は waitUntil で後続実行。
  // LINE には即 200 を返す。
  const client = new LineClient(account);
  for (const event of payload.events) {
    c.executionCtx.waitUntil(handleEvent(c.env, client, account, event));
  }
  return c.json({ ok: true });
});

async function handleEvent(
  env: Env,
  client: LineClient,
  account: LineAccount,
  event: WebhookEvent,
): Promise<void> {
  try {
    if (event.type === "message") {
      await handleMessage(
        env,
        client,
        account,
        event.replyToken,
        event.message,
        event.source?.userId,
      );
    } else if (event.type === "postback") {
      await handlePostback(env, client, account, event.replyToken, event.postback.data);
    }
  } catch (e) {
    console.error(`[${account.label}] handleEvent error:`, e);
  }
}

// ── メッセージ（テキスト/画像）→ 抽出 → Flex確認 ───────────────────
async function handleMessage(
  env: Env,
  client: LineClient,
  account: LineAccount,
  replyToken: string,
  message: { type: string; text?: string; id: string },
  userId: string | undefined,
): Promise<void> {
  const input: InputBlock[] = [];
  // 会話履歴に残す、このユーザー発話のテキスト表現
  let userTurnText = "";

  if (message.type === "text" && message.text) {
    input.push({ kind: "text", text: message.text });
    userTurnText = message.text;
  } else if (message.type === "image") {
    const img = await getImageBase64(account, message.id);
    if (!img) {
      await client.replyText(replyToken, "画像を取得できませんでした。もう一度送ってください。");
      return;
    }
    input.push({ kind: "image", base64: img.base64, mediaType: img.mediaType });
    // スクショだけのときも、何のメッセージか分かるよう補足
    input.push({
      kind: "text",
      text: "この画像（LINEのトーク等のスクリーンショット）から予定を読み取って登録してください。",
    });
    userTurnText = "[画像(スクショ)を送信]";
  } else {
    // テキスト・画像以外（スタンプ等）は無視
    return;
  }

  // 文脈保持: 1:1チャットで userId が取れる場合だけ履歴を使う
  const history = userId ? await loadRecentTurns(env, account.id, userId) : [];

  const result = await runScheduler(env, account.label, input, history);

  if (result.type === "message") {
    // 先にユーザーへ返信（replyTokenの鮮度を優先・履歴保存に依存させない）
    await client.replyText(replyToken, result.text);
    if (userId) {
      await appendTurn(env, account.id, userId, "user", userTurnText);
      await appendTurn(env, account.id, userId, "assistant", result.text);
    }
    return;
  }

  // 確定候補 → 一時保存して Flex 確認を送る（まだ登録しない）
  const token = crypto.randomUUID();
  await savePending(env, {
    token,
    accountId: account.id,
    accountLabel: account.label,
    userId: userId ?? null,
    appointment: result.appointment,
  });

  const flex = buildConfirmFlex(
    result.appointment,
    account.label,
    token,
    env.APP_TIMEZONE,
  );
  await client.replyMessages(replyToken, flex);

  // 返信後に履歴を記録（ベストエフォート）
  if (userId) {
    const a = result.appointment;
    await appendTurn(env, account.id, userId, "user", userTurnText);
    await appendTurn(
      env,
      account.id,
      userId,
      "assistant",
      `（予定候補を提示）${a.title} / ${a.start_time}〜${a.end_time}`,
    );
  }
}

// ── 承認(postback) → カレンダー登録 ────────────────────────────────
async function handlePostback(
  env: Env,
  client: LineClient,
  account: LineAccount,
  replyToken: string,
  data: string,
): Promise<void> {
  const params = new URLSearchParams(data);
  if (params.get("action") !== "approve") return;

  const token = params.get("token");
  if (!token) return;

  const pending = await takePending(env, token);
  if (!pending) {
    await client.replyText(
      replyToken,
      "この確認は期限切れか、すでに処理済みです。もう一度送ってください。",
    );
    return;
  }

  const appt = pending.appointment;
  try {
    const ev = await insertEvent(env, {
      // どのアカウント由来か一目で分かるようプレフィックスを付与
      summary: `[${pending.accountLabel}] ${appt.title}`,
      description: appt.notes,
      location: appt.location,
      startISO: appt.start_time,
      endISO: appt.end_time,
    });
    await client.replyText(
      replyToken,
      `カレンダーに登録しました ✅\n${appt.title}\n${formatJst(appt.start_time, env.APP_TIMEZONE)}\n${ev.htmlLink}`,
    );
  } catch (e) {
    console.error(`[${account.label}] insertEvent error:`, e);
    await client.replyText(replyToken, "カレンダー登録に失敗しました。時間をおいて再度お試しください。");
  }
}

// Cron Triggers から呼ばれる定期掃除（wrangler.jsonc の triggers.crons）
async function scheduled(
  _event: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const result = await cleanup(env);
  console.log(
    `[cleanup] pending=${result.pending} conversation=${result.conversation}`,
  );
}

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;
