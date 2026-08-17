// host 전역 설정(.host-settings.json): 실행할 CLI 제공자와 제공자별 모델.
// .relay-auth.json과 같은 신뢰 모델 — 리포 루트 평문 JSON, 원자적 tmp+rename 쓰기.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PROVIDERS = ["claude", "codex", "cursor"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const CLAUDE_MODELS = ["opus", "sonnet", "fable"] as const;
export const CODEX_MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
] as const;
// Cursor Agent CLI `--model` 별칭(구독 계정에서 쓰는 대표 ID).
export const CURSOR_MODELS = [
  "composer-2.5",
  "composer-2",
  "auto",
  "gpt-5.2",
  "gpt-5",
  "claude-4.6-sonnet",
  "claude-4.6-opus",
  "claude-4-sonnet",
  "claude-4-opus",
] as const;
// 이전 공개 상수 이름은 Claude 모델 목록으로 유지한다.
export const ALLOWED_MODELS = CLAUDE_MODELS;
export type Model =
  | (typeof CLAUDE_MODELS)[number]
  | (typeof CODEX_MODELS)[number]
  | (typeof CURSOR_MODELS)[number];
export const DEFAULT_PROVIDER: Provider = "claude";
export const DEFAULT_MODEL: Model = "opus";
export const DEFAULT_CURSOR_MODEL: Model = "composer-2.5";

const FILE_NAME = ".host-settings.json";

export function settingsFilePath(cwd: string): string {
  return join(cwd, FILE_NAME);
}

export function isProvider(p: unknown): p is Provider {
  return typeof p === "string" && (PROVIDERS as readonly string[]).includes(p);
}

export function modelsForProvider(provider: Provider): readonly string[] {
  if (provider === "codex") return CODEX_MODELS;
  if (provider === "cursor") return CURSOR_MODELS;
  return CLAUDE_MODELS;
}

export function isAllowedModel(provider: Provider, model: unknown): model is Model {
  return typeof model === "string" && modelsForProvider(provider).includes(model);
}

export interface HostSettings { provider: Provider; model: Model }

// 예전 `{ model: "sonnet" }` 파일은 Claude 설정으로 자동 승격한다.
export function readHostSettings(cwd: string): HostSettings {
  const f = settingsFilePath(cwd);
  if (!existsSync(f)) return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
  try {
    const o = JSON.parse(readFileSync(f, "utf8"));
    const provider: Provider = isProvider(o.provider) ? o.provider : DEFAULT_PROVIDER;
    if (isAllowedModel(provider, o.model)) return { provider, model: o.model };
  } catch { /* 깨진 파일 → 기본값 취급 */ }
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
}

// 허용목록 밖 값이면 저장하지 않고 false를 반환한다(호출부가 실패를 알 수 있게).
export function writeHostSettings(cwd: string, provider: string, model: string): boolean {
  if (!isProvider(provider) || !isAllowedModel(provider, model)) return false;
  const settings: HostSettings = { provider, model };
  const p = settingsFilePath(cwd);
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, p);
  return true;
}

// 기존 호출부/외부 사용 호환: 모델만 바꾸면 현재 제공자를 유지한다.
export function writeHostModel(cwd: string, model: string): boolean {
  const current = readHostSettings(cwd);
  return writeHostSettings(cwd, current.provider, model);
}
