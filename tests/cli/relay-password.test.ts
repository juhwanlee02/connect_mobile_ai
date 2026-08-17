import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  passwordFilePath,
  normalizeRelayPassword,
  readRelayPassword,
  setRelayPassword,
  resolveOrCreateRelayPassword,
} from "../../src/cli/relay-password.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cpmc-pw-"));
}

// 각 테스트가 환경변수를 오염시키지 않도록 정리한다.
afterEach(() => {
  delete process.env.RELAY_PASSWORD;
});

describe("normalizeRelayPassword", () => {
  it("앞뒤 공백을 제거한다", () => {
    expect(normalizeRelayPassword("  hunter2  ")).toBe("hunter2");
  });
  it("4자 미만은 거부한다", () => {
    expect(() => normalizeRelayPassword("abc")).toThrow();
    expect(() => normalizeRelayPassword("   a ")).toThrow();
    expect(() => normalizeRelayPassword("")).toThrow();
  });
  it("정확히 4자는 허용한다", () => {
    expect(normalizeRelayPassword("abcd")).toBe("abcd");
  });
});

describe("setRelayPassword / readRelayPassword", () => {
  it("저장한 값을 다시 읽어온다", () => {
    const root = tmp();
    setRelayPassword(root, "my-secret");
    expect(readRelayPassword(root)).toBe("my-secret");
  });

  it("저장 시 정규화(공백 제거)된다", () => {
    const root = tmp();
    const saved = setRelayPassword(root, "  spaced  ");
    expect(saved).toBe("spaced");
    expect(readRelayPassword(root)).toBe("spaced");
  });

  it("4자 미만이면 저장하지 않고 던진다", () => {
    const root = tmp();
    expect(() => setRelayPassword(root, "ab")).toThrow();
    expect(existsSync(passwordFilePath(root))).toBe(false);
  });

  it("파일 권한은 0600이다", () => {
    const root = tmp();
    setRelayPassword(root, "my-secret");
    const mode = statSync(passwordFilePath(root)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("아무것도 없으면 undefined", () => {
    expect(readRelayPassword(tmp())).toBeUndefined();
  });

  it("환경변수가 파일보다 우선한다", () => {
    const root = tmp();
    setRelayPassword(root, "from-file");
    process.env.RELAY_PASSWORD = "from-env";
    expect(readRelayPassword(root)).toBe("from-env");
  });
});

describe("resolveOrCreateRelayPassword", () => {
  it("없으면 생성해서 저장하고, 두 번째 호출은 같은 값을 준다", () => {
    const root = tmp();
    const first = resolveOrCreateRelayPassword(root);
    expect(first.created).toBe(true);
    expect(first.password.length).toBeGreaterThanOrEqual(4);
    expect(existsSync(passwordFilePath(root))).toBe(true);

    const second = resolveOrCreateRelayPassword(root);
    expect(second.created).toBe(false);
    expect(second.password).toBe(first.password);
  });

  it("파일이 있으면 그 값을 쓰고 created=false", () => {
    const root = tmp();
    setRelayPassword(root, "chosen-pw");
    const r = resolveOrCreateRelayPassword(root);
    expect(r).toEqual({ password: "chosen-pw", created: false });
  });

  it("환경변수가 있으면 그 값을 쓰고 파일은 만들지 않는다", () => {
    const root = tmp();
    process.env.RELAY_PASSWORD = "env-pw";
    const r = resolveOrCreateRelayPassword(root);
    expect(r).toEqual({ password: "env-pw", created: false });
    expect(existsSync(passwordFilePath(root))).toBe(false);
  });
});
