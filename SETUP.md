# セットアップ手順（実機で動かすまで）

秘書Botを実際に動かすには、LINE / Anthropic / Google の3つの設定と、
Cloudflare へのデプロイが必要。上から順にやればOK。

---

## 0. 前提

```bash
npm install
npx wrangler login   # Cloudflareアカウントでログイン
```

---

## 1. LINE 公式アカウント（秘書Bot）を作る

個人アカ①用・②用に分けるなら2つ作る（1つだけでも可）。

1. [LINE Developers](https://developers.line.biz/) にログイン
2. **プロバイダー**を作成（任意の名前）
3. **Messaging API チャネル**を作成
4. 「Messaging API設定」で：
   - **Channel access token (long-lived)** を発行 → `LINE_x_CHANNEL_ACCESS_TOKEN`
   - **応答メッセージ**＝オフ、**Webhook**＝オン（後でURLを設定）
5. 「チャネル基本設定」で：
   - **Channel secret** → `LINE_x_CHANNEL_SECRET`
6. 自分のLINEでそのBotを**友だち追加**（QRコードがコンソールにある）

> x = a（個人アカ①用）/ b（個人アカ②用）

Webhook URL はデプロイ後に判明するので、後（手順5）で設定する。

---

## 2. Anthropic APIキー

1. [Anthropic Console](https://console.anthropic.com/) でAPIキーを発行
2. `ANTHROPIC_API_KEY` に設定
3. モデルは既定 `claude-opus-4-8`（vision対応）。`wrangler.jsonc` の
   `ANTHROPIC_MODEL` で変更可（コスト重視なら `claude-sonnet-4-6`）

---

## 3. Google Calendar（サービスアカウント）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. 「APIとサービス」→ **Google Calendar API を有効化**
3. 「認証情報」→ **サービスアカウント**を作成
4. そのサービスアカウントで **JSON鍵**を発行（ダウンロード）
5. ダウンロードしたJSONを **1行の文字列**にして `GOOGLE_SERVICE_ACCOUNT_JSON` に設定
   （改行 `\n` はそのままでOK。JSON全体をシングルクォートで囲む）
6. **対象のGoogleカレンダー**を開き「設定と共有」→
   「特定のユーザーと共有」にサービスアカウントのメール
   （`xxx@xxx.iam.gserviceaccount.com`）を追加し、
   権限を **「予定の変更権限」** にする ← これを忘れると登録できない
7. `GOOGLE_CALENDAR_ID` を設定（自分のメインカレンダーなら `primary`、
   または「設定と共有」最下部の「カレンダーID」）

---

## 4. D1 データベース

```bash
# 作成 → 出力された database_id を wrangler.jsonc の d1_databases に貼る
npx wrangler d1 create line-ai-scheduler

# スキーマ適用（本番）
npx wrangler d1 execute line-ai-scheduler --remote --file=./schema.sql
```

---

## 5. シークレット登録 → デプロイ → Webhook設定

```bash
# シークレットを登録（プロンプトに値を貼る）
npx wrangler secret put LINE_A_CHANNEL_SECRET
npx wrangler secret put LINE_A_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_B_CHANNEL_SECRET        # 1つだけなら不要
npx wrangler secret put LINE_B_CHANNEL_ACCESS_TOKEN  # 1つだけなら不要
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
npx wrangler secret put GOOGLE_CALENDAR_ID

# デプロイ（URLが表示される: https://line-ai-scheduler.<subdomain>.workers.dev）
npx wrangler deploy
```

表示されたURLを使い、LINE Developers の各チャネルの **Webhook URL** に設定：

| チャネル | Webhook URL |
|----------|-------------|
| 個人アカ①用 | `https://<your-worker>/webhook/a` |
| 個人アカ②用 | `https://<your-worker>/webhook/b` |

設定後、コンソールの「**検証**」ボタンで疎通確認（200が返ればOK）。

---

## 6. 動作確認

友だち追加した秘書Botに送ってみる：

| 試すこと | 送る内容 | 期待結果 |
|----------|----------|----------|
| テキスト登録 | `6/20 15時に佐藤さんと打ち合わせ` | 確認Flex → 承認でカレンダー登録 |
| スクショ登録 | アポが写ったトークのスクショ | 同上 |
| 空き確認 | `明日空いてる時間は？` | 空き時間の一覧が返る |
| 文脈保持 | スクショ送信 → 続けて `①の件で` | 直前のスクショを踏まえて応答 |

---

## トラブルシュート

- **署名エラー(401)**: Webhook URL のアカウント(a/b)と、登録した
  CHANNEL_SECRET の対応が合っているか確認。
- **カレンダー登録に失敗**: サービスアカウントを対象カレンダーに
  「予定の変更権限」で共有したか、`GOOGLE_CALENDAR_ID` が正しいか確認。
- **画像が読めない**: 画質が荒いと読み取り精度が落ちる。テキスト併用が確実。
- **ログ確認**: `npx wrangler tail` でリアルタイムログを見られる。
