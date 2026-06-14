import type { Env } from "../env.js";
import type { AccountId } from "../config/accounts.js";
import type { Appointment } from "../ai/appointment.js";

/**
 * 確認待ちの予定を D1 に一時保存する。
 * Flex の「承認」ボタンの postback には token だけを載せ、
 * 承認時にこのストアから本体を引いてカレンダー登録する。
 */

export interface PendingRecord {
  token: string;
  accountId: AccountId;
  accountLabel: string;
  userId: string | null;
  appointment: Appointment;
}

export async function savePending(
  env: Env,
  record: PendingRecord,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pending_appointments (token, account_id, account_label, user_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      record.token,
      record.accountId,
      record.accountLabel,
      record.userId,
      JSON.stringify(record.appointment),
      Date.now(),
    )
    .run();
}

export async function takePending(
  env: Env,
  token: string,
): Promise<PendingRecord | null> {
  // 取得と削除を1文(DELETE ... RETURNING)で原子的に行う。
  // 「承認」ボタンの二重タップでも、行を実際に削除できた1リクエストだけが
  // レコードを受け取り、二重登録を防ぐ。
  const row = await env.DB.prepare(
    `DELETE FROM pending_appointments WHERE token = ?
     RETURNING token, account_id, account_label, user_id, payload`,
  )
    .bind(token)
    .first<{
      token: string;
      account_id: AccountId;
      account_label: string;
      user_id: string | null;
      payload: string;
    }>();

  if (!row) return null;

  return {
    token: row.token,
    accountId: row.account_id,
    accountLabel: row.account_label,
    userId: row.user_id,
    appointment: JSON.parse(row.payload) as Appointment,
  };
}
