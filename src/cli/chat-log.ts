// 프로젝트별 채팅 히스토리: chat.jsonl append 전용(폰 새로고침 시 소실 방지 — 스펙 §5·§6).
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatEntry } from "../shared/protocol.js";

export type { ChatEntry };

export function chatLogPath(dir: string): string {
  return join(dir, "chat.jsonl");
}

export function appendChat(dir: string, entry: ChatEntry): void {
  appendFileSync(chatLogPath(dir), JSON.stringify(entry) + "\n");
}

export function readChat(dir: string, limit: number): ChatEntry[] {
  let raw: string;
  try {
    raw = readFileSync(chatLogPath(dir), "utf8");
  } catch {
    return [];
  }
  const out: ChatEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (typeof o?.text === "string" && typeof o?.role === "string") out.push(o);
    } catch { /* 깨진 줄 무시 */ }
  }
  return out.slice(-limit);
}
