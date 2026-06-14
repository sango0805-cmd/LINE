import type { LineAccount } from "../config/accounts.js";

const LINE_API_BASE = "https://api.line.me/v2/bot";

/**
 * LINE Messaging API への薄いクライアント。アカウントごとの access token を束ねる。
 * ステップ2では reply（テキスト）だけ。Flex Message やプッシュはステップ5以降で拡張する。
 */
export class LineClient {
  constructor(private readonly account: LineAccount) {}

  /** replyToken を使って返信する（textMessages は最大5件まで） */
  async replyText(replyToken: string, ...texts: string[]): Promise<void> {
    const messages = texts.slice(0, 5).map((text) => ({ type: "text", text }));
    await this.post("/message/reply", { replyToken, messages });
  }

  /** 任意のメッセージオブジェクト（Flex 等）で返信する */
  async replyMessages(
    replyToken: string,
    ...messages: Record<string, unknown>[]
  ): Promise<void> {
    await this.post("/message/reply", { replyToken, messages: messages.slice(0, 5) });
  }

  private async post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${LINE_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.account.channelAccessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // 返信失敗は致命的ではない（replyToken期限切れ等）。ログに残して握りつぶす。
      console.error(
        `[LINE ${this.account.label}] ${path} failed: ${res.status} ${detail}`,
      );
    }
  }
}
