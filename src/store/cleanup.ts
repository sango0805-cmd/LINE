import type { Env } from "../env.js";

/**
 * D1 の古いデータを掃除する（Cron Triggers から呼ぶ）。
 * - pending_appointments: 承認されないまま残った確認待ちを24時間で削除
 * - conversation_messages: 文脈として不要になった古い履歴を7日で削除
 */

const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const CONVERSATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

export async function cleanup(env: Env): Promise<{ pending: number; conversation: number }> {
  const now = Date.now();

  const pending = await env.DB.prepare(
    `DELETE FROM pending_appointments WHERE created_at < ?`,
  )
    .bind(now - PENDING_TTL_MS)
    .run();

  const conversation = await env.DB.prepare(
    `DELETE FROM conversation_messages WHERE created_at < ?`,
  )
    .bind(now - CONVERSATION_TTL_MS)
    .run();

  return {
    pending: pending.meta.changes ?? 0,
    conversation: conversation.meta.changes ?? 0,
  };
}
