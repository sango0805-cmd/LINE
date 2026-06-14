-- Cloudflare D1 スキーマ
-- 適用: npx wrangler d1 execute line-ai-scheduler --file=./schema.sql --remote
--       （ローカルは --local）

-- 確認待ちの予定（Flex承認までの一時保管）
CREATE TABLE IF NOT EXISTS pending_appointments (
  token         TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  account_label TEXT NOT NULL,
  user_id       TEXT,
  payload       TEXT NOT NULL,   -- Appointment の JSON
  created_at    INTEGER NOT NULL -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_pending_created_at
  ON pending_appointments (created_at);

-- 会話履歴（文脈保持: スクショ＋後追いテキストの紐付け、相対日時の解釈などに使う）
CREATE TABLE IF NOT EXISTS conversation_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,    -- 'user' | 'assistant'
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL  -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_conv_lookup
  ON conversation_messages (account_id, user_id, created_at);

