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
