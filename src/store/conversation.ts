import type { Env } from "../env.js";

/**
 * 会話履歴の保持。(account_id, user_id) ごとに直近のやり取りを残し、
 * 次の解析時に Claude へ渡すことで「①の件」「同じ時間で」のような
 * 後追い・相対表現を解釈できるようにする。
 *
 * 画像そのものは保存せず、テキスト（画像は要約/プレースホルダ）だけを残す。
 */

export type Role = "user" | "assistant";

export interface Turn {
  role: Role;
  text: string;
}

/** 文脈として読み込む直近の件数・時間窓 */
const MAX_TURNS = 10;
const WINDOW_MS = 60 * 60 * 1000; // 直近1時間のみ文脈とみなす

export async function loadRecentTurns(
  env: Env,
  accountId: string,
  userId: string,
): Promise<Turn[]> {
  const since = Date.now() - WINDOW_MS;
  const rows = await env.DB.prepare(
    `SELECT role, text FROM conversation_messages
      WHERE account_id = ? AND user_id = ? AND created_at >= ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
  )
    .bind(accountId, userId, since, MAX_TURNS)
    .all<{ role: Role; text: string }>();

  // 取得は新しい順なので、時系列（古い順）に戻す
  return (rows.results ?? []).reverse();
}

/**
 * 履歴の保存はベストエフォート。失敗してもユーザーへの返信を止めないよう、
 * ここでエラーを握りつぶす（ログのみ）。
 */
export async function appendTurn(
  env: Env,
  accountId: string,
  userId: string,
  role: Role,
  text: string,
): Promise<void> {
  if (!text) return;
  try {
    await env.DB.prepare(
      `INSERT INTO conversation_messages (account_id, user_id, role, text, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(accountId, userId, role, text, Date.now())
      .run();
  } catch (e) {
    console.error("[conversation] appendTurn failed:", e);
  }
}
