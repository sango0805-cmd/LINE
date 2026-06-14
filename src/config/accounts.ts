import type { Env } from "../env.js";

/**
 * Webhook の URL パスでアカウントを識別する。
 *   POST /webhook/a → アカウントA
 *   POST /webhook/b → アカウントB
 *
 * 予定タイトルのプレフィックス（[LINE-A] / [LINE-B]）にもこの id を使う。
 */
export type AccountId = "a" | "b";

export interface LineAccount {
  /** 識別子（"a" | "b"） */
  id: AccountId;
  /** 予定タイトル等に付ける表示用ラベル（例: "LINE-A"） */
  label: string;
  /** 署名検証に使う Channel secret */
  channelSecret: string;
  /** 返信・プッシュに使う Channel access token */
  channelAccessToken: string;
}

const SUPPORTED: readonly AccountId[] = ["a", "b"] as const;

function isAccountId(value: string): value is AccountId {
  return (SUPPORTED as readonly string[]).includes(value);
}

/**
 * パスパラメータから対応する LINE アカウント設定を解決する。
 * 未知のアカウントIDや、シークレット未設定の場合は null を返す。
 */
export function resolveAccount(env: Env, raw: string): LineAccount | null {
  const id = raw.toLowerCase();
  if (!isAccountId(id)) return null;

  const map: Record<AccountId, Omit<LineAccount, "id" | "label">> = {
    a: {
      channelSecret: env.LINE_A_CHANNEL_SECRET,
      channelAccessToken: env.LINE_A_CHANNEL_ACCESS_TOKEN,
    },
    b: {
      channelSecret: env.LINE_B_CHANNEL_SECRET,
      channelAccessToken: env.LINE_B_CHANNEL_ACCESS_TOKEN,
    },
  };

  const creds = map[id];
  // 該当アカウントのシークレットが未設定なら無効扱い
  if (!creds.channelSecret || !creds.channelAccessToken) return null;

  return {
    id,
    label: `LINE-${id.toUpperCase()}`,
    ...creds,
  };
}
