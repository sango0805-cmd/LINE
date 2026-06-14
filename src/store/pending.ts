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
  const row = await env.DB.prepare(
    `SELECT token, account_id, account_label, user_id, payload
       FROM pending_appointments WHERE token = ?`,
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

  // 一度承認したら消す（二重登録防止）
  await env.DB.prepare(`DELETE FROM pending_appointments WHERE token = ?`)
    .bind(token)
    .run();

  return {
    token: row.token,
    accountId: row.account_id,
    accountLabel: row.account_label,
    userId: row.user_id,
    appointment: JSON.parse(row.payload) as Appointment,
  };
}
