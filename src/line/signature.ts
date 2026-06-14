/**
 * LINE Messaging API の署名検証。
 *
 * LINE は各リクエストに `x-line-signature` ヘッダを付与する。値は
 *   Base64( HMAC-SHA256(channelSecret, rawRequestBody) )
 * 署名検証は「生のリクエストボディ」に対して行う必要があるため、
 * JSON.parse する前のテキストを渡すこと。
 *
 * Cloudflare Workers には Node の crypto が無いので Web Crypto を使う。
 */

const encoder = new TextEncoder();

/** ArrayBuffer → Base64 文字列 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 長さ・内容ともに一定時間で比較（タイミング攻撃対策） */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 署名を検証する。
 * @param channelSecret 対象アカウントの Channel secret
 * @param rawBody       生のリクエストボディ文字列
 * @param signature     x-line-signature ヘッダの値
 * @returns 検証に成功すれば true
 */
export async function verifyLineSignature(
  channelSecret: string,
  rawBody: string,
  signature: string | null | undefined,
): Promise<boolean> {
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = toBase64(mac);

  return timingSafeEqual(expected, signature);
}
