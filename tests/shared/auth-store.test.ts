import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authFilePath, normalizeAuthId, readRelayAuth, resolveOrCreateRelayAuth, writeRelayAuth,
} from "../../src/shared/auth-store.js";

let root: string;
const ENV_KEYS = ["RELAY_ID", "RELAY_PASSWORD"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "auth-"));
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("normalizeAuthId", () => {
  it("형식 제한 없음 — 소문자 통일만, 빈 값·제어문자·과대 길이만 거부", () => {
    expect(normalizeAuthId(" TestUser ")).toBe("testuser");
    expect(normalizeAuthId("123test")).toBe("123test");   // 숫자 시작 허용
    expect(normalizeAuthId("ab")).toBe("ab");             // 짧은 아이디 허용
    expect(normalizeAuthId("한글아이디")).toBe("한글아이디"); // 한글 허용
    expect(() => normalizeAuthId("  ")).toThrow();        // 빈 값
    expect(() => normalizeAuthId("a\nb")).toThrow();      // 제어문자
    expect(() => normalizeAuthId("a".repeat(65))).toThrow(); // 64자 초과
  });
});

describe("read/write", () => {
  it("쓰기(0600) 후 재읽기 왕복", () => {
    writeRelayAuth(root, { id: "TestUser", password: " pw1234 " });
    expect(statSync(authFilePath(root)).mode & 0o777).toBe(0o600);
    expect(readRelayAuth(root)).toEqual({ id: "testuser", password: "pw1234" });
  });
  it("파일 없음 → undefined, 깨진 파일 → undefined", () => {
    expect(readRelayAuth(root)).toBeUndefined();
    writeFileSync(authFilePath(root), "{broken");
    expect(readRelayAuth(root)).toBeUndefined();
  });
  it("env 우선순위: RELAY_ID+RELAY_PASSWORD > 파일, RELAY_PASSWORD 단독은 파일 id에 pw만 덮음", () => {
    writeRelayAuth(root, { id: "fileid", password: "filepw" });
    process.env.RELAY_ID = "envid";
    process.env.RELAY_PASSWORD = "envpw";
    expect(readRelayAuth(root)).toEqual({ id: "envid", password: "envpw" });
    delete process.env.RELAY_ID;
    expect(readRelayAuth(root)).toEqual({ id: "fileid", password: "envpw" });
  });
  it("RELAY_PASSWORD만 있고 파일 없음 → id는 dev(기존 dev 워크플로)", () => {
    process.env.RELAY_PASSWORD = "devpw";
    expect(readRelayAuth(root)).toEqual({ id: "dev", password: "devpw" });
  });
  it("수기 편집으로 규칙 위반(제어문자) id가 담긴 파일 → undefined(무진단 잠금 방지)", () => {
    writeFileSync(authFilePath(root), JSON.stringify({ id: "adm\nin", password: "validpw" }));
    expect(readRelayAuth(root)).toBeUndefined();
  });
  it("대문자 id 파일은 소문자 정규화로 읽힌다(폰 입력과 일치)", () => {
    writeFileSync(authFilePath(root), JSON.stringify({ id: "ADMIN", password: "validpw" }));
    expect(readRelayAuth(root)).toEqual({ id: "admin", password: "validpw" });
  });
  it("RELAY_PASSWORD 단독이 규칙 위반(빈 값·제어문자)이면 undefined", () => {
    process.env.RELAY_PASSWORD = "a\tb";
    expect(readRelayAuth(root)).toBeUndefined();
  });
});

describe("resolveOrCreateRelayAuth", () => {
  it(".relay-password가 있으면 그 비밀번호를 승계(id admin)하고 파일을 만든다", () => {
    writeFileSync(join(root, ".relay-password"), "legacy99\n");
    const { auth, created } = resolveOrCreateRelayAuth(root);
    expect(created).toBe(true);
    expect(auth).toEqual({ id: "admin", password: "legacy99" });
    expect(existsSync(authFilePath(root))).toBe(true);
    // 두 번째 호출은 기존 파일 사용
    expect(resolveOrCreateRelayAuth(root)).toEqual({ auth, created: false });
  });
  it("아무것도 없으면 랜덤 비밀번호로 생성", () => {
    const { auth, created } = resolveOrCreateRelayAuth(root);
    expect(created).toBe(true);
    expect(auth.id).toBe("admin");
    expect(auth.password.length).toBeGreaterThanOrEqual(4);
  });
  it("유효한 기존 파일이 있는데 RELAY_PASSWORD가 규칙 위반이면, 파일을 덮어쓰지 않고 파일 값을 반환한다", () => {
    writeRelayAuth(root, { id: "testuser", password: "goodpw123" });
    const before = readFileSync(authFilePath(root), "utf8");
    process.env.RELAY_PASSWORD = "a\tb"; // 규칙 위반(제어문자 — 형식 제한 완화 후에도 위반인 값)
    const { auth, created } = resolveOrCreateRelayAuth(root);
    expect(created).toBe(false);
    expect(auth).toEqual({ id: "testuser", password: "goodpw123" });
    expect(readFileSync(authFilePath(root), "utf8")).toBe(before);
  });
});
