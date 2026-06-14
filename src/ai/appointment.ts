/**
 * Claude が抽出する「予定の候補」。propose_appointment ツールの入力でもある。
 * 日時は JST のオフセット付き ISO 8601（例: 2026-06-20T15:00:00+09:00）。
 */
export interface Appointment {
  /** 用件・タイトル（例: "株式会社〇〇 打ち合わせ"） */
  title: string;
  /** 開始日時（ISO 8601, +09:00） */
  start_time: string;
  /** 終了日時（ISO 8601, +09:00） */
  end_time: string;
  /** 場所（任意） */
  location?: string;
  /** 相手の名前（任意） */
  attendee?: string;
  /** 補足メモ（任意） */
  notes?: string;
}
