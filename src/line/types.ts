/**
 * LINE Messaging API Webhook の型（必要な範囲のみ）。
 * 公式リファレンス: https://developers.line.biz/ja/reference/messaging-api/#webhooks
 */

export interface WebhookRequestBody {
  destination: string;
  events: WebhookEvent[];
}

export type WebhookEvent = MessageEvent | PostbackEvent | UnknownEvent;

interface BaseEvent {
  type: string;
  /** ボットに付与された再返信用トークン（イベントによっては無い） */
  replyToken?: string;
  mode: "active" | "standby";
  timestamp: number;
  source?: EventSource;
  webhookEventId?: string;
}

export interface EventSource {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface MessageEvent extends BaseEvent {
  type: "message";
  replyToken: string;
  message: TextMessageContent | OtherMessageContent;
}

export interface TextMessageContent {
  id: string;
  type: "text";
  text: string;
}

export interface OtherMessageContent {
  id: string;
  type: "image" | "video" | "audio" | "file" | "location" | "sticker";
}

export interface PostbackEvent extends BaseEvent {
  type: "postback";
  replyToken: string;
  postback: {
    data: string;
    params?: Record<string, string>;
  };
}

/**
 * message / postback 以外のイベント（follow, unfollow など）。
 * 判別可能ユニオンを壊さないよう、型は具体的なリテラルの集合にしておく。
 */
export interface UnknownEvent extends BaseEvent {
  type:
    | "follow"
    | "unfollow"
    | "join"
    | "leave"
    | "memberJoined"
    | "memberLeft"
    | "unsend"
    | "videoPlayComplete"
    | "beacon"
    | "accountLink"
    | "things";
}

/** 発話ユーザーを一意に識別するキー（会話履歴のキーに使う） */
export function sourceUserId(event: WebhookEvent): string | undefined {
  return event.source?.userId;
}
