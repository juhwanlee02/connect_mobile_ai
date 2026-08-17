import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// 폰 연결용 비밀번호를 저장하는 파일. 비밀이므로 .gitignore에 넣는다.
const FILE_NAME = ".relay-password";

export const MIN_PASSWORD_LENGTH = 4;

export function passwordFilePath(cwd: string): string {
  return join(cwd, FILE_NAME);
}

// 비밀번호 검증 후 정규화. 유효하지 않으면 Error를 던진다(호출자가 메시지 노출).
export function normalizeRelayPassword(raw: string): string {
  const pw = raw.trim();
  if (pw.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.`);
  }
  return pw;
}

// 우선순위: RELAY_PASSWORD 환경변수 > 설정 파일. 둘 다 없으면 undefined(자동 생성 안 함).
export function readRelayPassword(cwd: string): string | undefined {
  const fromEnv = process.env.RELAY_PASSWORD;
  if (fromEnv) return fromEnv;
  const f = passwordFilePath(cwd);
  if (existsSync(f)) {
    const pw = readFileSync(f, "utf8").trim();
    if (pw) return pw;
  }
  return undefined;
}

// 사용자가 정한 비밀번호를 파일에 저장(권한 0600). 정규화된 값을 반환한다.
export function setRelayPassword(cwd: string, raw: string): string {
  const pw = normalizeRelayPassword(raw);
  writeFileSync(passwordFilePath(cwd), `${pw}\n`, { mode: 0o600 });
  return pw;
}

// 우선순위대로 결정하되, 아무것도 없으면 랜덤 생성 후 저장해 다음부터 고정되게 한다.
// created=true면 이번에 새로 만든 것(안내 문구용). 환경변수로 온 값은 저장하지 않는다.
export function resolveOrCreateRelayPassword(cwd: string): {
  password: string;
  created: boolean;
} {
  const existing = readRelayPassword(cwd);
  if (existing) return { password: existing, created: false };
  const pw = randomBytes(6).toString("base64url");
  writeFileSync(passwordFilePath(cwd), `${pw}\n`, { mode: 0o600 });
  return { password: pw, created: true };
}
