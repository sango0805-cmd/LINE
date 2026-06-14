import type { Env } from "../env.js";

/**
 * Google Calendar API クライアント（サービスアカウント認証）。
 *
 * Cloudflare Workers には googleapis ライブラリが載らないので、
 * Web Crypto で JWT(RS256) を自前署名し、OAuth2 トークンエンドポイントで
 * アクセストークンに交換する。
 *
 * 事前準備:
 *   1. GCPでサービスアカウントを作成し、JSON鍵を発行
 *   2. その JSON を1行にして GOOGLE_SERVICE_ACCOUNT_JSON に設定
 *   3. 対象カレンダーの共有設定で、サービスアカウントのメールに
 *      「予定の変更権限」を付与
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const API_BASE = "https://www.googleapis.com/calendar/v3";

// アクセストークンの簡易キャッシュ（isolate 内で使い回す）
let cachedToken: { value: string; expiresAt: number } | null = null;

// ── base64url ヘルパー ───────────────────────────────────────────────
function base64urlFromString(input: string): string {
  return base64urlFromBytes(new TextEncoder().encode(input));
}

function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM(PKCS#8) を ArrayBuffer に変換 */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function parseServiceAccount(env: Env): ServiceAccount {
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON に client_email / private_key がありません");
  }
  return sa;
}

/** サービスアカウントのアクセストークンを取得（キャッシュ付き） */
export async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.value;
  }

  const sa = parseServiceAccount(env);

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: CALENDAR_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${base64urlFromString(JSON.stringify(header))}.${base64urlFromString(
    JSON.stringify(claim),
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64urlFromBytes(new Uint8Array(sig))}`;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in };
  return data.access_token;
}

export interface BusyInterval {
  start: string;
  end: string;
}

/**
 * 指定区間にカレンダー上の予定が入っているか確認する（freeBusy）。
 * カレンダーには [LINE-A] / [LINE-B] 両方の予定が入るので、これ1つで
 * 両アカウント横断のダブルブッキング防止になる。
 */
export async function checkBusy(
  env: Env,
  startISO: string,
  endISO: string,
): Promise<BusyInterval[]> {
  const token = await getAccessToken(env);
  const res = await fetch(`${API_BASE}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: startISO,
      timeMax: endISO,
      timeZone: env.APP_TIMEZONE,
      items: [{ id: env.GOOGLE_CALENDAR_ID }],
    }),
  });

  if (!res.ok) {
    throw new Error(`freeBusy failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    calendars: Record<string, { busy: BusyInterval[] }>;
  };
  return data.calendars[env.GOOGLE_CALENDAR_ID]?.busy ?? [];
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  startISO: string;
  endISO: string;
}

/** カレンダーに予定を登録する */
export async function insertEvent(
  env: Env,
  event: CalendarEventInput,
): Promise<{ id: string; htmlLink: string }> {
  const token = await getAccessToken(env);
  const calId = encodeURIComponent(env.GOOGLE_CALENDAR_ID);
  const res = await fetch(`${API_BASE}/calendars/${calId}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: { dateTime: event.startISO, timeZone: env.APP_TIMEZONE },
      end: { dateTime: event.endISO, timeZone: env.APP_TIMEZONE },
    }),
  });

  if (!res.ok) {
    throw new Error(`events.insert failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { id: string; htmlLink: string };
  return data;
}
