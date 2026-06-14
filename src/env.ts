/**
 * Worker の環境バインディング。
 * - vars は wrangler.jsonc の "vars"
 * - secret は `.dev.vars` / `wrangler secret put` で注入
 * - DB は D1 バインディング（ステップ4で使用）
 */
export interface Env {
  // D1（会話履歴の保持用。ステップ4で本格利用）
  DB: D1Database;

  // 非機密 vars
  APP_TIMEZONE: string;
  ANTHROPIC_MODEL: string;

  // LINE 公式アカウント A
  LINE_A_CHANNEL_SECRET: string;
  LINE_A_CHANNEL_ACCESS_TOKEN: string;

  // LINE 公式アカウント B
  LINE_B_CHANNEL_SECRET: string;
  LINE_B_CHANNEL_ACCESS_TOKEN: string;

  // Anthropic
  ANTHROPIC_API_KEY: string;

  // Google Calendar（ステップ3で使用）
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  GOOGLE_CALENDAR_ID: string;
}

/** Hono の型引数で使う共通定義 */
export type AppBindings = { Bindings: Env };
