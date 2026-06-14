import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env.js";
import type { Appointment } from "./appointment.js";
import { checkBusy, findFreeSlots } from "../calendar/google.js";
import { formatFreeSlots } from "../calendar/freeslots.js";
import type { FreeSlotOptions } from "../calendar/freeslots.js";

function workHours(env: Env): FreeSlotOptions {
  return {
    workStartHour: Number(env.WORK_START_HOUR) || 9,
    workEndHour: Number(env.WORK_END_HOUR) || 21,
    minMinutes: 30,
  };
}

/**
 * Claude によるスケジュール調整エージェント（Tool Use）。
 *
 * 入力（テキスト・スクショ画像のどちらでも、併用も可）を受け取り:
 *   1. 日時/場所/相手/用件を読み取る（相対日時は現在JSTから解決）
 *   2. check_availability でカレンダーの空きを確認（ダブルブッキング防止）
 *   3. 空いていれば propose_appointment を呼んで確定候補を返す
 *      埋まっていれば別の時間を提案して再確認
 *   4. 日時が判断できない/予定の話でない場合は通常テキストで聞き返す
 */

const MAX_ITERATIONS = 6;

export type AgentResult =
  | { type: "propose"; appointment: Appointment }
  | { type: "message"; text: string };

/** Claude に渡す入力ブロック（テキスト or 画像） */
export type InputBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; base64: string; mediaType: string };

const tools: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description:
      "指定した日時にGoogleカレンダー上で既に別の予定（LINE-A・LINE-B両方を含む）が入っていないか確認する。予定を確定する前に必ず呼ぶこと。",
    input_schema: {
      type: "object",
      properties: {
        start_time: {
          type: "string",
          description: "確認する開始日時。ISO 8601 形式、JSTオフセット付き（例: 2026-06-20T15:00:00+09:00）",
        },
        end_time: {
          type: "string",
          description: "確認する終了日時。ISO 8601 形式、JSTオフセット付き",
        },
      },
      required: ["start_time", "end_time"],
    },
  },
  {
    name: "find_free_slots",
    description:
      "指定期間の空き時間（稼働時間帯の中の予定が入っていない時間帯）を調べる。『明日空いてる時間は？』『今週いつ空いてる？』のように空き時間を聞かれたときに使う。",
    input_schema: {
      type: "object",
      properties: {
        start_time: {
          type: "string",
          description: "調べる期間の開始。ISO 8601(+09:00)。例: 明日なら明日の00:00",
        },
        end_time: {
          type: "string",
          description: "調べる期間の終了。ISO 8601(+09:00)。例: 明日なら翌日の00:00",
        },
      },
      required: ["start_time", "end_time"],
    },
  },
  {
    name: "propose_appointment",
    description:
      "日時の空きが確認でき、登録すべき予定が確定したら呼ぶ。これを呼ぶとユーザーへ最終確認（Flex Message）が送られる。まだ登録はされない。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "予定のタイトル・用件" },
        start_time: { type: "string", description: "開始日時 ISO 8601(+09:00)" },
        end_time: { type: "string", description: "終了日時 ISO 8601(+09:00)" },
        location: { type: "string", description: "場所（任意）" },
        attendee: { type: "string", description: "相手の名前（任意）" },
        notes: { type: "string", description: "補足メモ（任意）" },
      },
      required: ["title", "start_time", "end_time"],
    },
  },
];

function systemPrompt(env: Env, accountLabel: string): string {
  const nowJst = new Intl.DateTimeFormat("ja-JP", {
    timeZone: env.APP_TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());

  return [
    "あなたはLINEで届くメッセージやスクリーンショットから予定を読み取り、Googleカレンダーに登録するための秘書アシスタントです。",
    `現在の日時（${env.APP_TIMEZONE}）: ${nowJst}`,
    `このメッセージは「${accountLabel}」の受け皿に届きました。`,
    "",
    "やること:",
    "- テキストや会話のスクショから、日時・場所・相手・用件を読み取る。",
    "- 「来週の火曜」「同じ時間で」などの相対表現は、上記の現在日時を基準に具体的な日時へ解決する。",
    "- 所要時間が不明な場合は1時間と仮定する。",
    "- 予定を確定する前に必ず check_availability で空きを確認する。",
    "- 既に予定が入っていれば、その旨を踏まえて近い別の時間帯を提案し、再度空きを確認する。",
    "- 日時が確定できたら propose_appointment を呼ぶ。タイトルは用件が分かる簡潔なものにする。",
    "",
    "空き時間を聞かれたとき（例:「明日空いてる時間は？」「今週いつ空いてる？」）:",
    "- find_free_slots で該当期間の空きを調べ、結果をそのまま分かりやすく提示する。",
    "- 期間が曖昧な場合は『明日』なら明日0:00〜翌0:00、『今週』なら今日〜今週末、のように常識的に補う。",
    `- 稼働時間帯は ${env.WORK_START_HOUR}:00〜${env.WORK_END_HOUR}:00 を前提とする（ツールが自動で絞り込む）。`,
    "",
    "- 日時が読み取れない、または予定にも空き確認にも関係ない内容の場合は、ツールを使わず日本語で簡潔に聞き返す。",
  ].join("\n");
}

export async function runScheduler(
  env: Env,
  accountLabel: string,
  input: InputBlock[],
): Promise<AgentResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const content: Anthropic.ContentBlockParam[] = input.map((b) =>
    b.kind === "text"
      ? { type: "text", text: b.text }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: b.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: b.base64,
          },
        },
  );

  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: systemPrompt(env, accountLabel),
      tools,
      messages,
    });

    if (res.stop_reason !== "tool_use") {
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { type: "message", text: text || "うまく読み取れませんでした。日時を含めてもう一度送ってください。" };
    }

    // tool_use を処理
    messages.push({ role: "assistant", content: res.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;

      if (block.name === "propose_appointment") {
        // 終端: 確定候補が出たのでループを抜ける
        return { type: "propose", appointment: block.input as Appointment };
      }

      if (block.name === "find_free_slots") {
        const { start_time, end_time } = block.input as {
          start_time: string;
          end_time: string;
        };
        let resultText: string;
        try {
          const slots = await findFreeSlots(env, start_time, end_time, workHours(env));
          resultText = formatFreeSlots(slots, env.APP_TIMEZONE);
        } catch (e) {
          resultText = `空き時間の取得に失敗しました: ${String(e)}`;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
        });
        continue;
      }

      if (block.name === "check_availability") {
        const { start_time, end_time } = block.input as {
          start_time: string;
          end_time: string;
        };
        let resultText: string;
        try {
          const busy = await checkBusy(env, start_time, end_time);
          resultText =
            busy.length === 0
              ? "空いています（予定なし）。"
              : `この時間帯は予定が入っています: ${busy
                  .map((b) => `${b.start}〜${b.end}`)
                  .join(", ")}`;
        } catch (e) {
          resultText = `空き確認に失敗しました: ${String(e)}`;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    type: "message",
    text: "調整に時間がかかりすぎました。日時を具体的に指定してもう一度お試しください。",
  };
}
