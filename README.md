# LINE AI スケジュール調整アシスタント

個人LINEアカウント2つ分の予定を **秘書Bot（LINE公式アカウント）** で一元管理する。
アポっぽいトークの **スクショやテキストを秘書Botに送るだけ** で、
Claude が内容を読み取り、確認のうえ **Googleカレンダーへ自動登録** する。

- 言語: TypeScript
- 実行基盤: Cloudflare Workers + [Hono](https://hono.dev/)
- DB: Cloudflare D1（確認待ち予定の保持）
- 外部API: LINE Messaging API / Anthropic API（Claude vision + Tool Use）/ Google Calendar API

> ⚠️ 個人アカウントに直接ログインして自動操作するのは LINE 規約違反（垢BANリスク）。
> 本ツールは個人アカウントには一切ログインせず、ユーザーが秘書Botへ
> **スクショ/テキストを送る**という安全な方法で2アカウント分を扱う。

---

## 使い方（イメージ）

1. 個人アカ①/②で届いたアポっぽいトークの **スクショを撮る**（テキストをコピペでもOK）
2. それを **秘書Botに送る**
3. Botが「この予定で登録しますか？」と **Flexで確認**
4. **承認** を押すと Googleカレンダーに登録（`[LINE-A] 〇〇さん 打ち合わせ` のようにタグ付き）

「来週火曜15時」のような相対表現も、現在日時(JST)を基準に解決する。
登録前に必ず確認を挟むので、読み取りミスはその場で修正できる。

### 空き時間の確認

カレンダーをいちいち見返さなくても、Botに聞けば空き時間を教えてくれる。

> 「明日空いてる時間は？」 → `6月15日(日): 10:00〜12:00, 14:00〜18:00 が空いています`

稼働時間帯（既定 9:00〜21:00, `wrangler.jsonc` の `WORK_START_HOUR`/`WORK_END_HOUR`）
の中の、予定が入っていない30分以上の隙間を提示する。
A/B 両方の予定を横断して見るので、2アカウント分まとめて把握できる。

---

## 処理フロー

```
LINE(秘書Bot) ──webhook──▶ Worker
  画像/テキスト受信
    └ 画像なら content API で取得 → base64
  Claude (vision + Tool Use)
    ├ check_availability ──▶ Google Calendar freeBusy（A/B横断でダブルブッキング防止）
    └ propose_appointment（確定候補）
  D1 に確定候補を一時保存 → Flex確認を返信
  「承認」postback ──▶ D1から取り出し → events.insert（[LINE-x] タグ付き）
```

---

## 実装ステータス

| Step | 内容 | 状態 |
|------|------|------|
| 1 | プロジェクト初期化・環境変数の整理 | ✅ |
| 2 | Webhook受け口＋署名検証（アカウント分岐） | ✅ |
| 3 | Google Calendar 認証・空き確認/予定登録 | ✅ |
| 4 | D1（確認待ち予定の保持） | ✅ |
| 5 | Claude Tool Use（vision対応）＋ Flex確認 | ✅ |
| 6 | ルーティング・データフロー結合 | ✅ |

追加機能:
- ✅ 空き時間の提示（「明日空いてる？」）
- ✅ 文脈保持（スクショ＋後追いテキストの紐付け／会話履歴をD1に保存）
- ✅ 期限切れデータの定期掃除（Cron Triggers, 毎時）

実機で動かす手順は **[SETUP.md](./SETUP.md)** を参照。

---

## セットアップ

```bash
npm install
cp .dev.vars.example .dev.vars   # → 各値を設定

# D1 作成 → 出力された database_id を wrangler.jsonc に貼る
npx wrangler d1 create line-ai-scheduler
# スキーマ適用（ローカル）
npx wrangler d1 execute line-ai-scheduler --local --file=./schema.sql

npm run typecheck
npm run dev
```

### 必要な外部設定

- **LINE**: 秘書Bot用に公式アカウント（Messaging APIチャネル）を作成。
  Webhook URL は下表。個人アカ①→A、②→B のように受け皿を分けると
  タグ付け（`[LINE-A]`/`[LINE-B]`）が自動になる。1つだけ使ってもOK。
- **Anthropic**: APIキー（vision対応モデル。既定 `claude-opus-4-8`）。
- **Google**: サービスアカウントを作り、対象カレンダーに「予定の変更権限」で共有。

| 受け皿 | Webhook URL |
|--------|-------------|
| A（個人アカ①用） | `https://<your-worker>/webhook/a` |
| B（個人アカ②用） | `https://<your-worker>/webhook/b` |

### 本番デプロイ

```bash
npx wrangler d1 execute line-ai-scheduler --remote --file=./schema.sql
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

## ディレクトリ構成

```
src/
  index.ts            エントリポイント（分岐・署名検証・オーケストレーション）
  env.ts              環境バインディングの型
  config/accounts.ts  アカウントA/Bの解決
  line/
    signature.ts      x-line-signature 検証（Web Crypto）
    types.ts          Webhook イベントの型
    content.ts        画像メッセージの取得（→ base64）
    client.ts         reply（テキスト/Flex）
    flex.ts           確認用 Flex Message の生成・日時整形
  ai/
    appointment.ts    予定候補の型
    agent.ts          Claude Tool Use エージェント（vision + 空き確認）
  calendar/google.ts  サービスアカウント認証・freeBusy・events.insert
  store/pending.ts    確認待ち予定の D1 read/write
schema.sql            D1 スキーマ
```

モデルIDは `wrangler.jsonc` の `ANTHROPIC_MODEL` に集約。
レイテンシ/コスト重視なら `claude-sonnet-4-6` へ1箇所変更で切替可能（vision対応）。
