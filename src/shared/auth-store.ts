// 폰 로그인 자격증명(.relay-auth.json): 사용자가 정한 id+password 한 쌍.
// .relay-password(비밀번호 단독)의 후속 — 기존 파일이 있으면 비밀번호를 승계한다.
// 평문 로컬 파일(0600) — .relay-password와 같은 신뢰 모델(스펙 §8).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface RelayAuth { id: string; password: string }

const FILE_NAME = ".relay-auth.json";
// 형식 제한 없음(사용자 결정) — 빈 값·제어문자·과대 길이만 막는다(URL·파일·UI 깨짐 방지).
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const MAX_ID_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 128;

export function authFilePath(cwd: string): string {
  return join(cwd, FILE_NAME);
}

// 아이디는 대소문자 구분 없이 취급한다(폰 입력이 소문자화되므로 저장도 소문자로 통일).
export function normalizeAuthId(raw: string): string {
  const id = raw.trim().toLowerCase();
  if (id.length < 1) throw new Error("아이디를 입력해 주세요.");
  if (id.length > MAX_ID_LENGTH) throw new Error(`아이디는 ${MAX_ID_LENGTH}자 이하여야 해요.`);
  if (CONTROL_RE.test(id)) throw new Error("아이디에 제어문자는 쓸 수 없어요.");
  return id;
}

export function normalizeAuthPassword(raw: string): string {
  const pw = raw.trim();
  if (pw.length < 1) throw new Error("비밀번호를 입력해 주세요.");
  if (pw.length > MAX_PASSWORD_LENGTH) throw new Error(`비밀번호는 ${MAX_PASSWORD_LENGTH}자 이하여야 해요.`);
  if (CONTROL_RE.test(pw)) throw new Error("비밀번호에 제어문자는 쓸 수 없어요.");
  return pw;
}

// 파일만 단독으로 읽어 검증한다(env 완전 무시). resolveOrCreateRelayAuth가 env 오염 시에도
// 기존 파일 자격증명을 보고 판단할 수 있도록 readRelayAuth와 분리해 둔다.
function readAuthFile(cwd: string): RelayAuth | undefined {
  const f = authFilePath(cwd);
  if (!existsSync(f)) return undefined;
  try {
    const o = JSON.parse(readFileSync(f, "utf8"));
    if (typeof o.id === "string" && o.id && typeof o.password === "string" && o.password) {
      return { id: normalizeAuthId(o.id), password: normalizeAuthPassword(o.password) };
    }
  } catch { /* 깨진 파일 또는 규칙 위반 → 미설정 취급(무진단 잠금 방지) */ }
  return undefined;
}

// 우선순위: RELAY_ID+RELAY_PASSWORD(둘 다) > 파일(RELAY_PASSWORD가 있으면 pw만 덮음)
// > RELAY_PASSWORD 단독(id "dev" — 기존 dev 워크플로 호환) > undefined.
export function readRelayAuth(cwd: string): RelayAuth | undefined {
  const envId = process.env.RELAY_ID;
  const envPw = process.env.RELAY_PASSWORD;
  if (envId && envPw) {
    try {
      return { id: normalizeAuthId(envId), password: normalizeAuthPassword(envPw) };
    } catch {
      return undefined; // env 값이 규칙 위반이면 미설정 취급(조용한 절반 적용 방지)
    }
  }
  const fileAuth = readAuthFile(cwd);
  if (fileAuth) {
    try {
      return { id: fileAuth.id, password: normalizeAuthPassword(envPw || fileAuth.password) };
    } catch { /* env pw가 규칙 위반이면 미설정 취급(기존 동작 유지) */ }
  }
  if (envPw) {
    try {
      return { id: "dev", password: normalizeAuthPassword(envPw) };
    } catch {
      return undefined; // 규칙 위반 pw는 미설정 취급
    }
  }
  return undefined;
}

export function writeRelayAuth(cwd: string, raw: RelayAuth): RelayAuth {
  const auth = {
    id: normalizeAuthId(raw.id),
    password: normalizeAuthPassword(raw.password),
  };
  const p = authFilePath(cwd);
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, p);
  return auth;
}

// npm start용: 없으면 만들어 저장해 다음 실행부터 고정한다.
// 마이그레이션: .relay-password가 있으면 그 비밀번호를 승계한다(id는 "admin").
export function resolveOrCreateRelayAuth(cwd: string): { auth: RelayAuth; created: boolean } {
  const existing = readRelayAuth(cwd);
  if (existing) return { auth: existing, created: false };
  // readRelayAuth가 undefined를 반환해도, 그게 "파일이 없어서"가 아니라 env가 규칙을
  // 위반해서일 수 있다(예: RELAY_PASSWORD=ab). 그 경우 아래에서 새로 생성해 버리면 유효한
  // 기존 파일을 무경고로 덮어써 사용자 계정을 파괴하게 된다 — env를 무시하고 파일만 다시 본다.
  const fileOnly = readAuthFile(cwd);
  if (fileOnly) {
    if (process.env.RELAY_ID || process.env.RELAY_PASSWORD) {
      console.warn("⚠️ RELAY_ID/RELAY_PASSWORD 값이 규칙에 맞지 않아 무시합니다 — 파일 자격증명 사용");
    }
    return { auth: fileOnly, created: false };
  }
  let password: string | undefined;
  const legacy = join(cwd, ".relay-password");
  if (existsSync(legacy)) {
    const pw = readFileSync(legacy, "utf8").trim();
    if (pw) password = pw;
  }
  const auth = writeRelayAuth(cwd, {
    id: "admin",
    password: password ?? randomBytes(6).toString("base64url"),
  });
  return { auth, created: true };
}
