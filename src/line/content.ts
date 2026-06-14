import type { LineAccount } from "../config/accounts.js";

// 画像/動画などのコンテンツ取得は通常の api.line.me ではなく data ドメイン
const LINE_DATA_BASE = "https://api-data.line.me/v2/bot";

export interface ImagePayload {
  /** Claude の image ブロックに渡す base64 文字列 */
  base64: string;
  /** "image/jpeg" など */
  mediaType: string;
}

/**
 * 受信した画像メッセージの実体を取得し、base64 にして返す。
 * 取得には期限があるので受信後すぐ呼ぶこと。
 *
 * Claude vision がサポートするのは jpeg / png / gif / webp。
 * LINE のスクショは通常 jpeg なので問題ない。
 */
export async function getImageBase64(
  account: LineAccount,
  messageId: string,
): Promise<ImagePayload | null> {
  const res = await fetch(`${LINE_DATA_BASE}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${account.channelAccessToken}` },
  });

  if (!res.ok) {
    console.error(
      `[LINE ${account.label}] content fetch failed: ${res.status}`,
    );
    return null;
  }

  const mediaType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);

  return { base64, mediaType };
}
