# LINE AI スケジュール調整アシスタント

2つのLINE公式アカウントからのメッセージを **1つのバックエンド** で受け取り、
Anthropic API（Claude）の Tool Use でユーザーとスケジュールを調整し、
**Googleカレンダーへ自動登録** するシステム。

- 言語: TypeScript
- 実行基盤: Cloudflare Workers + [Hono](https://hono.dev/)
- DB: Cloudflare D1（会話履歴のコンテキスト保持）
- 外部API: LINE Messaging API（2アカウント） / Anthropic API / Google Calendar API

---

## 実装ステータス

| Step | 内容 | 状態 |
|------|------|------|
| 1 | プロジェクト初期化・環境変数の整理 | ✅ 完了 |
| 2 | Webhook受け口＋署名検証（アカウント分岐） | ✅ 完了 |
| 3 | Google Calendar 認証・予定の取得/追加 | ⬜ 未着手 |
| 4 | D1 による会話履歴の読み書き | ⬜ 未着手 |
| 5 | Anthropic Tool Use ＋ Flex Message 生成 | ⬜ 未着手 |
| 6 | 全体のルーティング・データフロー結合 | ⬜ 未着手 |

現状（Step 2 まで）は、署名検証を通過したテキストメッセージに
`[LINE-A] 受信しました: ...` の形でエコー返信する疎通確認レベル。

---

## セットアップ

```bash
npm install

# ローカル用シークレットを用意
cp .dev.vars.example .dev.vars
#   → .dev.vars を編集して各値を設定

# D1 を作成し、出力された database_id を wrangler.jsonc に貼る
npx wrangler d1 create line-ai-scheduler

# 型チェック
npm run typecheck

# ローカル起動（http://localhost:8787）
npm run dev
```

### 本番デプロイ時のシークレット登録

`vars` ではなく Secret として登録する（コミットされない）:

```bash
npx wrangler secret put LINE_A_CHANNEL_SECRET
npx wrangler secret put LINE_A_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_B_CHANNEL_SECRET
npx wrangler secret put LINE_B_CHANNEL_ACCESS_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
npx wrangler secret put GOOGLE_CALENDAR_ID
npx wrangler deploy
```

---

## アカウント分岐の仕組み

Webhook URL のパスでアカウントA/Bを識別する。

| アカウント | Webhook URL（LINE Developers Console に設定） |
|-----------|-----------------------------------------------|
| A | `https://<your-worker>/webhook/a` |
| B | `https://<your-worker>/webhook/b` |

- パス（`a` / `b`）から `src/config/accounts.ts` が対応する
  `CHANNEL_SECRET` / `CHANNEL_ACCESS_TOKEN` を解決する。
- 署名検証はそのアカウントの `CHANNEL_SECRET` で `x-line-signature` を検証
  （`src/line/signature.ts`、生ボディに対する HMAC-SHA256）。
- 返信はそのアカウントの `CHANNEL_ACCESS_TOKEN` で行う。
- 予定タイトルのプレフィックス（`[LINE-A]` / `[LINE-B]`）にもこの識別子を使う。

---

## ディレクトリ構成

```
src/
  index.ts            エントリポイント（Honoルーティング・分岐・署名検証）
  env.ts              環境バインディングの型
  config/
    accounts.ts       アカウントA/Bの解決
  line/
    signature.ts      x-line-signature の検証（Web Crypto）
    types.ts          Webhook イベントの型
    client.ts         LINE Messaging API クライアント（reply）
```
