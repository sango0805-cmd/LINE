import { Hono } from "hono";
import type { AppBindings } from "./env.js";
import { resolveAccount } from "./config/accounts.js";
import { verifyLineSignature } from "./line/signature.js";
import { LineClient } from "./line/client.js";
import type { WebhookRequestBody, WebhookEvent } from "./line/types.js";

const app = new Hono<AppBindings>();

// ── ヘルスチェック ──────────────────────────────────────────────────
app.get("/", (c) => c.text("line-ai-scheduler: ok"));

// ── LINE Webhook 受け口（アカウント分岐）────────────────────────────
// LINE Developers Console の Webhook URL に以下を設定:
//   アカウントA: https://<your-worker>/webhook/a
//   アカウントB: https://<your-worker>/webhook/b
app.post("/webhook/:account", async (c) => {
  // 1. パスからアカウントを識別し、対応する secret / token を解決
  const account = resolveAccount(c.env, c.req.param("account"));
  if (!account) {
    // 未知のアカウント or シークレット未設定
    return c.json({ error: "unknown account" }, 404);
  }

  // 2. 署名検証は「生のボディ」に対して行う（parse前のテキストが必要）
  const rawBody = await c.req.text();
  const signature = c.req.header("x-line-signature");
  const valid = await verifyLineSignature(
    account.channelSecret,
    rawBody,
    signature,
  );
  if (!valid) {
    return c.json({ error: "invalid signature" }, 401);
  }

  // 3. パース
  let payload: WebhookRequestBody;
  try {
    payload = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  // 4. 各イベントを処理。LINE は10秒以内の200応答を要求するため、
  //    重い処理（Claude解析・カレンダー登録）は waitUntil でバックグラウンド化する。
  //    ステップ2では疎通確認用のエコー返信のみ。
  const client = new LineClient(account);
  for (const event of payload.events) {
    c.executionCtx.waitUntil(handleEvent(client, account.label, event));
  }

  // 5. LINE には常に即座に 200 を返す
  return c.json({ ok: true });
});

/**
 * 1イベントの処理（ステップ2: エコー返信のみ）。
 * ステップ5以降でここを Claude 解析 → Flex 確認 → カレンダー登録に差し替える。
 */
async function handleEvent(
  client: LineClient,
  label: string,
  event: WebhookEvent,
): Promise<void> {
  if (event.type === "message" && event.message.type === "text") {
    await client.replyText(
      event.replyToken,
      `[${label}] 受信しました: ${event.message.text}`,
    );
  }
}

export default app;
