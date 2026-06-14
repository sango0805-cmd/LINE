import { computeFreeSlots, formatFreeSlots } from "../src/calendar/freeslots.js";
import { verifyLineSignature } from "../src/line/signature.js";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.log(`  ❌ ${name}`, extra ?? "");
  }
}

const OPT = { workStartHour: 9, workEndHour: 21, minMinutes: 30 };

console.log("freeslots: 1日・昼に1件予定あり");
{
  const slots = computeFreeSlots(
    [{ start: "2026-06-15T12:00:00+09:00", end: "2026-06-15T13:00:00+09:00" }],
    "2026-06-15T00:00:00+09:00",
    "2026-06-16T00:00:00+09:00",
    OPT,
  );
  check("2スロットに分かれる", slots.length === 2, slots);
  check("午前 09:00-12:00", slots[0]?.start === "2026-06-15T09:00:00+09:00" && slots[0]?.end === "2026-06-15T12:00:00+09:00", slots[0]);
  check("午後 13:00-21:00", slots[1]?.start === "2026-06-15T13:00:00+09:00" && slots[1]?.end === "2026-06-15T21:00:00+09:00", slots[1]);
}

console.log("freeslots: 終日空き");
{
  const slots = computeFreeSlots([], "2026-06-15T00:00:00+09:00", "2026-06-16T00:00:00+09:00", OPT);
  check("1スロット(稼働時間まるごと)", slots.length === 1 && slots[0]?.start === "2026-06-15T09:00:00+09:00" && slots[0]?.end === "2026-06-15T21:00:00+09:00", slots);
}

console.log("freeslots: 30分未満の隙間は除外");
{
  // 12:00-12:50 と 13:10-21:00 が埋まっている → 隙間は 12:50-13:10(20分)だけ → 除外
  const slots = computeFreeSlots(
    [
      { start: "2026-06-15T09:00:00+09:00", end: "2026-06-15T12:50:00+09:00" },
      { start: "2026-06-15T13:10:00+09:00", end: "2026-06-15T21:00:00+09:00" },
    ],
    "2026-06-15T00:00:00+09:00",
    "2026-06-16T00:00:00+09:00",
    OPT,
  );
  check("20分の隙間は出ない", slots.length === 0, slots);
}

console.log("freeslots: 複数日(月境界)・2日目に予定");
{
  // 6/30 と 7/1 をまたぐ。7/1 の午前に予定。
  const slots = computeFreeSlots(
    [{ start: "2026-07-01T09:00:00+09:00", end: "2026-07-01T12:00:00+09:00" }],
    "2026-06-30T00:00:00+09:00",
    "2026-07-02T00:00:00+09:00",
    OPT,
  );
  // 6/30 終日(1) + 7/1 午後(1) = 2
  check("月をまたいで2スロット", slots.length === 2, slots);
  check("6/30は終日", slots[0]?.start === "2026-06-30T09:00:00+09:00" && slots[0]?.end === "2026-06-30T21:00:00+09:00", slots[0]);
  check("7/1は12:00以降", slots[1]?.start === "2026-07-01T12:00:00+09:00" && slots[1]?.end === "2026-07-01T21:00:00+09:00", slots[1]);
}

console.log("freeslots: 範囲が稼働時間外のみ → 空配列・整形メッセージ");
{
  const slots = computeFreeSlots([], "2026-06-15T22:00:00+09:00", "2026-06-15T23:00:00+09:00", OPT);
  check("深夜帯は空き0", slots.length === 0, slots);
  check("整形メッセージ", formatFreeSlots(slots, "Asia/Tokyo").includes("見つかりませんでした"));
}

console.log("formatFreeSlots: 日ごとに整形");
{
  const out = formatFreeSlots(
    [
      { start: "2026-06-15T09:00:00+09:00", end: "2026-06-15T12:00:00+09:00" },
      { start: "2026-06-15T13:00:00+09:00", end: "2026-06-15T21:00:00+09:00" },
    ],
    "Asia/Tokyo",
  );
  check("時刻が含まれる", out.includes("09:00") && out.includes("12:00") && out.includes("13:00"), out);
}

console.log("署名検証");
{
  const secret = "test-channel-secret";
  const body = JSON.stringify({ destination: "x", events: [] });
  // LINE と同じ手順で正しい署名を作る
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  let bin = "";
  const bytes = new Uint8Array(mac);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const goodSig = btoa(bin);

  check("正しい署名 → true", await verifyLineSignature(secret, body, goodSig));
  check("間違った署名 → false", !(await verifyLineSignature(secret, body, "AAAA")));
  check("署名なし → false", !(await verifyLineSignature(secret, body, null)));
  check("別シークレット → false", !(await verifyLineSignature("other", body, goodSig)));
}

console.log(failures === 0 ? "\n✅ 全テスト合格" : `\n❌ ${failures}件 失敗`);
process.exit(failures === 0 ? 0 : 1);
