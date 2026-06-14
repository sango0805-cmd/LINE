import type { BusyInterval } from "./google.js";

/**
 * busy 区間から「空き時間」を計算する。
 *
 * 一日中の隙間を全部出すと深夜まで「空いてます」になってしまうので、
 * 稼働時間帯（既定 9:00〜21:00 JST）に絞り、最小長(既定30分)未満の隙間は捨てる。
 *
 * 時刻計算は Asia/Tokyo（+09:00, DSTなし）前提で固定オフセットで行う。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface FreeSlot {
  start: string; // ISO 8601 (+09:00)
  end: string;
}

export interface FreeSlotOptions {
  workStartHour: number; // 例: 9
  workEndHour: number; // 例: 21
  minMinutes: number; // 例: 30
}

function jstYmd(epoch: number): { y: number; mo: number; d: number } {
  const d = new Date(epoch + JST_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() };
}

function jstEpoch(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo, d, h, mi) - JST_OFFSET_MS;
}

function toIso(epoch: number): string {
  // +09:00 のオフセット付き ISO 文字列にする
  const d = new Date(epoch + JST_OFFSET_MS);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00+09:00`
  );
}

/** 1日分の稼働窓から busy を引いて空き区間を返す */
function freeWithinDay(
  windowStart: number,
  windowEnd: number,
  busy: { start: number; end: number }[],
  minMs: number,
): { start: number; end: number }[] {
  // この窓に重なる busy だけ、開始順に
  const relevant = busy
    .filter((b) => b.end > windowStart && b.start < windowEnd)
    .sort((a, b) => a.start - b.start);

  const free: { start: number; end: number }[] = [];
  let cursor = windowStart;
  for (const b of relevant) {
    if (b.start > cursor) {
      const gapEnd = Math.min(b.start, windowEnd);
      if (gapEnd - cursor >= minMs) free.push({ start: cursor, end: gapEnd });
    }
    cursor = Math.max(cursor, b.end);
    if (cursor >= windowEnd) break;
  }
  if (windowEnd - cursor >= minMs) free.push({ start: cursor, end: windowEnd });
  return free;
}

export function computeFreeSlots(
  busyIntervals: BusyInterval[],
  rangeStartISO: string,
  rangeEndISO: string,
  opts: FreeSlotOptions,
): FreeSlot[] {
  const rangeStart = new Date(rangeStartISO).getTime();
  const rangeEnd = new Date(rangeEndISO).getTime();
  if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd) || rangeStart >= rangeEnd) {
    return [];
  }

  const busy = busyIntervals.map((b) => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));
  const minMs = opts.minMinutes * 60 * 1000;

  const result: FreeSlot[] = [];

  // JSTの日ごとに稼働窓を作って空きを集める
  let { y, mo, d } = jstYmd(rangeStart);
  // 安全のため最大62日まで
  for (let guard = 0; guard < 62; guard++) {
    const dayStart = jstEpoch(y, mo, d, 0, 0);
    if (dayStart > rangeEnd) break;

    const windowStart = Math.max(rangeStart, jstEpoch(y, mo, d, opts.workStartHour, 0));
    const windowEnd = Math.min(rangeEnd, jstEpoch(y, mo, d, opts.workEndHour, 0));

    if (windowStart < windowEnd) {
      for (const f of freeWithinDay(windowStart, windowEnd, busy, minMs)) {
        result.push({ start: toIso(f.start), end: toIso(f.end) });
      }
    }

    // 翌日へ
    const next = jstYmd(jstEpoch(y, mo, d, 12, 0) + 24 * 60 * 60 * 1000);
    y = next.y;
    mo = next.mo;
    d = next.d;
  }

  return result;
}

/** 空きスロットを日ごとにまとめて読みやすい文字列にする */
export function formatFreeSlots(slots: FreeSlot[], timeZone: string): string {
  if (slots.length === 0) return "指定の期間に空き時間が見つかりませんでした。";

  const dayFmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const timeFmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });

  const byDay = new Map<string, string[]>();
  for (const s of slots) {
    const day = dayFmt.format(new Date(s.start));
    const range = `${timeFmt.format(new Date(s.start))}〜${timeFmt.format(new Date(s.end))}`;
    const arr = byDay.get(day) ?? [];
    arr.push(range);
    byDay.set(day, arr);
  }

  return [...byDay.entries()]
    .map(([day, ranges]) => `${day}: ${ranges.join(", ")}`)
    .join("\n");
}
