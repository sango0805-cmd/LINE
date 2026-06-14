import type { Appointment } from "../ai/appointment.js";

/** ISO 8601 → 「6月20日(金) 15:00」形式（JST表示） */
export function formatJst(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** 終了時刻は時:分だけ（同日想定）。日跨ぎなら日付込み。 */
function formatRange(appt: Appointment, timeZone: string): string {
  const start = formatJst(appt.start_time, timeZone);
  const startDay = new Date(appt.start_time).toDateString();
  const endDay = new Date(appt.end_time).toDateString();
  const end =
    startDay === endDay
      ? new Intl.DateTimeFormat("ja-JP", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(appt.end_time))
      : formatJst(appt.end_time, timeZone);
  return `${start} 〜 ${end}`;
}

function row(label: string, value: string) {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#aaaaaa", size: "sm", flex: 2 },
      {
        type: "text",
        text: value,
        wrap: true,
        color: "#666666",
        size: "sm",
        flex: 5,
      },
    ],
  };
}

/**
 * 登録前の最終確認 Flex Message。
 * 「承認」= postback（token付き）、「修正する」= message アクション。
 */
export function buildConfirmFlex(
  appt: Appointment,
  accountLabel: string,
  token: string,
  timeZone: string,
): Record<string, unknown> {
  const detailRows = [row("日時", formatRange(appt, timeZone))];
  if (appt.location) detailRows.push(row("場所", appt.location));
  if (appt.attendee) detailRows.push(row("相手", appt.attendee));
  if (appt.notes) detailRows.push(row("メモ", appt.notes));

  const bubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "この予定で登録しますか？", weight: "bold", size: "md" },
        { type: "text", text: accountLabel, size: "xs", color: "#1DB446" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: appt.title, weight: "bold", size: "lg", wrap: true },
        { type: "separator" },
        { type: "box", layout: "vertical", spacing: "sm", contents: detailRows },
      ],
    },
    footer: {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "message", label: "修正する", text: "予定を修正したい" },
        },
        {
          type: "button",
          style: "primary",
          height: "sm",
          color: "#1DB446",
          action: {
            type: "postback",
            label: "承認",
            data: `action=approve&token=${token}`,
            displayText: "承認しました",
          },
        },
      ],
    },
  };

  return {
    type: "flex",
    altText: `予定の確認: ${appt.title}`,
    contents: bubble,
  };
}
