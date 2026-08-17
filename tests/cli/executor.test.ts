import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import {
  CodexExecutor,
  CursorExecutor,
  RealExecutor,
  ensureWorkspaceTrusted,
  expandClaudeCommandForCodex,
  resolveCursorAgentCommand,
} from "../../src/cli/executor.js";

// RealExecutor의 명령 조립만 검증한다(claude 실제 실행 없이).
// exec를 오버라이드해 args를 캡처하는 서브클래스 패턴. ensureWorkspaceTrusted도 no-op으로
// 오버라이드해 테스트가 실사용자의 ~/.claude.json을 건드리지 않게 한다.
class CaptureExecutor extends RealExecutor {
  captured: string[][] = [];
  capturedCmd: string[] = [];
  capturedCwd: (string | undefined)[] = [];
  protected override exec(
    cmd: string, args: string[], _onLine?: (l: string) => void, cwd?: string,
  ): { done: Promise<void>; cancel: () => void } {
    this.captured.push(args);
    this.capturedCmd.push(cmd);
    this.capturedCwd.push(cwd);
    return { done: Promise.resolve(), cancel: () => {} };
  }
  protected override ensureWorkspaceTrusted(): void {}
}

describe("RealExecutor 인자 조립", () => {
  it("resumeSessionId가 있으면 --resume <id>, --continue는 붙지 않는다", async () => {
    const ex = new CaptureExecutor("/tmp");
    await ex.run("cmd", { continueSession: true, resumeSessionId: "sid-1", onEvent: () => {} }).done;
    const args = ex.captured[0];
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("sid-1");
    expect(args).not.toContain("--continue");
  });
  it("resumeSessionId 없이 continueSession이면 --continue", async () => {
    const ex = new CaptureExecutor("/tmp");
    await ex.run("cmd", { continueSession: true, onEvent: () => {} }).done;
    expect(ex.captured[0]).toContain("--continue");
  });
  it("getModel이 값을 주면 args에 --model <m>이 붙는다", async () => {
    const ex = new CaptureExecutor("/tmp", () => "sonnet");
    await ex.run("cmd", { continueSession: false, onEvent: () => {} }).done;
    const args = ex.captured[0];
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });
  it("getModel이 없거나 undefined면 --model이 붙지 않는다", async () => {
    const noArg = new CaptureExecutor("/tmp");
    await noArg.run("cmd", { continueSession: false, onEvent: () => {} }).done;
    expect(noArg.captured[0]).not.toContain("--model");

    const undef = new CaptureExecutor("/tmp", () => undefined);
    await undef.run("cmd", { continueSession: false, onEvent: () => {} }).done;
    expect(undef.captured[0]).not.toContain("--model");
  });

  it("run 결과에 이벤트로 받은 sessionId/costUsd가 담긴다", async () => {
    class EventExecutor extends CaptureExecutor {
      protected override exec(_c: string, _a: string[], onLine?: (l: string) => void) {
        onLine?.(JSON.stringify({ type: "system", subtype: "init", session_id: "sid-9" }));
        onLine?.(JSON.stringify({ type: "result", total_cost_usd: 0.5 }));
        return { done: Promise.resolve(), cancel: () => {} };
      }
    }
    const ex = new EventExecutor("/tmp");
    const result = await ex.run("cmd", { continueSession: false, onEvent: () => {} }).done;
    expect(result.sessionId).toBe("sid-9");
    expect(result.costUsd).toBe(0.5);
  });

  it("run()은 exec 이전에 ensureWorkspaceTrusted를 projectDir로 호출한다", async () => {
    const calls: string[] = [];
    class OrderExecutor extends RealExecutor {
      protected override ensureWorkspaceTrusted(dir: string): void {
        calls.push(`trust:${dir}`);
      }
      protected override exec(): { done: Promise<void>; cancel: () => void } {
        calls.push("exec");
        return { done: Promise.resolve(), cancel: () => {} };
      }
    }
    const ex = new OrderExecutor("/proj/order-test");
    await ex.run("cmd", { continueSession: false, onEvent: () => {} }).done;
    expect(calls).toEqual(["trust:/proj/order-test", "exec"]);
  });
});

describe("CodexExecutor 인자 조립", () => {
  it("Claude 슬래시 명령 파일을 Codex용 실제 프롬프트로 펼친다", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-command-"));
    const commands = join(dir, ".claude", "commands");
    mkdirSync(commands, { recursive: true });
    writeFileSync(
      join(commands, "pipeline-ideation.md"),
      "---\ndescription: test\n---\n# 아이디어 단계\npipeline.json을 갱신하세요.\n",
    );
    const prompt = expandClaudeCommandForCodex(
      dir,
      "/pipeline-ideation 피드백: 물 마시기 앱",
    );
    expect(prompt).toContain("# 아이디어 단계");
    expect(prompt).toContain("pipeline.json을 갱신하세요");
    expect(prompt).toContain("피드백: 물 마시기 앱");
    expect(prompt).not.toContain("description: test");
  });

  it("새 실행은 codex 전권 모드·JSONL·모델 옵션을 사용한다", async () => {
    class CaptureCodex extends CodexExecutor {
      captured: { cmd: string; args: string[] } | null = null;
      protected override exec(cmd: string, args: string[]) {
        this.captured = { cmd, args };
        return { done: Promise.resolve(), cancel: () => {} };
      }
    }
    const ex = new CaptureCodex("/tmp", () => "gpt-5.6-sol");
    await ex.run("만들어줘", { continueSession: false, onEvent: () => {} }).done;
    expect(ex.captured?.cmd).toBe("codex");
    expect(ex.captured?.args).toEqual([
      "--dangerously-bypass-approvals-and-sandbox",
      "--model", "gpt-5.6-sol", "exec", "--json", "만들어줘",
    ]);
  });

  it("Codex 세션 ID는 resume으로 이어가고 Claude 세션 ID는 재사용하지 않는다", async () => {
    class CaptureCodex extends CodexExecutor {
      args: string[] = [];
      protected override exec(_cmd: string, args: string[]) {
        this.args = args;
        return { done: Promise.resolve(), cancel: () => {} };
      }
    }
    const resumed = new CaptureCodex("/tmp");
    await resumed.run("계속", {
      continueSession: false,
      resumeSessionId: "codex:thread-1",
      onEvent: () => {},
    }).done;
    expect(resumed.args).toContain("resume");
    expect(resumed.args[resumed.args.indexOf("resume") + 1]).toBe("thread-1");

    const switched = new CaptureCodex("/tmp");
    await switched.run("새로", {
      continueSession: false,
      resumeSessionId: "claude-session",
      onEvent: () => {},
    }).done;
    expect(switched.args).not.toContain("resume");
  });

  it("Cursor는 print/stream-json/force/trust로 실행하고 긴 프롬프트는 파일로 넘긴다", async () => {
    const proj = mkdtempSync(join(tmpdir(), "cursor-proj-"));
    class CaptureCursor extends CursorExecutor {
      captured: { cmd: string; args: string[] } | null = null;
      protected override exec(cmd: string, args: string[]) {
        this.captured = { cmd, args };
        return { done: Promise.resolve(), cancel: () => {} };
      }
    }
    const ex = new CaptureCursor(proj, () => "composer-2.5");
    await ex.run("만들어줘", { continueSession: false, onEvent: () => {} }).done;

    // node+index.js 직접 실행이면 prefixArgs가 앞에 붙고, 아니면 agent(.cmd)만.
    const args = ex.captured?.args ?? [];
    const flagIdx = args.indexOf("-p");
    expect(flagIdx).toBeGreaterThanOrEqual(0);
    const flags = args.slice(flagIdx);
    expect(flags.slice(0, -1)).toEqual([
      "-p",
      "--output-format", "stream-json",
      "--force",
      "--trust",
      "--workspace", proj,
      "--sandbox", "disabled",
      "--model", "composer-2.5",
    ]);
    const promptArg = flags[flags.length - 1] ?? "";
    expect(promptArg).toContain(".cursor-host-prompt.md");
    expect(promptArg.length).toBeLessThan(500);
    expect(readFileSync(join(proj, ".cursor-host-prompt.md"), "utf8")).toContain("만들어줘");

    const cmd = ex.captured?.cmd ?? "";
    expect(
      cmd === "agent" ||
        /agent(\.cmd|\.exe)?$/i.test(cmd) ||
        /node(\.exe)?$/i.test(cmd),
    ).toBe(true);
  });

  it("resolveCursorAgentCommand는 CURSOR_AGENT_PATH를 우선한다", () => {
    const dir = mkdtempSync(join(tmpdir(), "cursor-agent-"));
    const fake = join(dir, "agent.cmd");
    writeFileSync(fake, "@echo off\n");
    const prev = process.env.CURSOR_AGENT_PATH;
    process.env.CURSOR_AGENT_PATH = fake;
    try {
      expect(resolveCursorAgentCommand()).toBe(fake);
    } finally {
      if (prev === undefined) delete process.env.CURSOR_AGENT_PATH;
      else process.env.CURSOR_AGENT_PATH = prev;
    }
  });

  it("Cursor auto 모델은 --model을 붙이지 않고 resume은 cursor: 접두사를 벗긴다", async () => {
    const proj = mkdtempSync(join(tmpdir(), "cursor-proj-"));
    class CaptureCursor extends CursorExecutor {
      args: string[] = [];
      protected override exec(_cmd: string, args: string[]) {
        this.args = args;
        return { done: Promise.resolve(), cancel: () => {} };
      }
    }
    const auto = new CaptureCursor(proj, () => "auto");
    await auto.run("go", { continueSession: false, onEvent: () => {} }).done;
    expect(auto.args).not.toContain("--model");

    const resumed = new CaptureCursor(proj, () => "composer-2.5");
    await resumed.run("계속", {
      continueSession: false,
      resumeSessionId: "cursor:chat-9",
      onEvent: () => {},
    }).done;
    expect(resumed.args).toContain("--resume");
    expect(resumed.args[resumed.args.indexOf("--resume") + 1]).toBe("chat-9");
  });
});

describe("exec cancel(실제 프로세스 종료)", () => {
  it("cancel()이 spawn한 프로세스를 실제로 종료한다(win32는 taskkill 트리 킬, 그 외 그룹 킬)", async () => {
    // 오래 사는 node 자식을 실제로 띄우고, cancel 후 done이 (걸리지 않고) 종료로 settle되는지 본다.
    const ex = new RealExecutor(process.cwd()) as unknown as {
      exec(cmd: string, args: string[]): { done: Promise<void>; cancel: () => void };
    };
    const handle = ex.exec("node", ["-e", "setInterval(() => {}, 100000)"]);
    const settled = handle.done.then(() => "settled", () => "settled");
    handle.cancel();
    const outcome = await Promise.race([
      settled,
      new Promise((r) => setTimeout(() => r("hang"), 5000)),
    ]);
    expect(outcome).toBe("settled"); // 취소로 프로세스가 종료돼 done이 끝난다(행 걸리지 않음)
  });
});

// 신뢰되지 않은 워크스페이스는 settings.json의 permissions.allow 전체가 무시된다(런타임 실측 —
// Phase 5 Task 4). ensureWorkspaceTrusted가 ~/.claude.json 대신 임시 설정 경로를 받아 동작하는지
// 검증한다(실사용자 설정 파일은 절대 건드리지 않는다).
describe("ensureWorkspaceTrusted", () => {
  function tmpConfigPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "claude-trust-test-"));
    return join(dir, ".claude.json");
  }

  it("설정 파일이 없으면 새로 만들고 대상 디렉터리를 신뢰 처리한다", () => {
    const configPath = tmpConfigPath();
    ensureWorkspaceTrusted("/proj/a", configPath);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.projects["/proj/a"].hasTrustDialogAccepted).toBe(true);
  });

  it("기존 projects 엔트리의 다른 필드는 보존한다", () => {
    const configPath = tmpConfigPath();
    writeFileSync(
      configPath,
      JSON.stringify({ projects: { "/proj/a": { allowedTools: ["Bash"], hasTrustDialogAccepted: false } } }),
    );
    ensureWorkspaceTrusted("/proj/a", configPath);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.projects["/proj/a"].hasTrustDialogAccepted).toBe(true);
    expect(config.projects["/proj/a"].allowedTools).toEqual(["Bash"]);
  });

  it("다른 프로젝트 엔트리는 건드리지 않는다", () => {
    const configPath = tmpConfigPath();
    writeFileSync(configPath, JSON.stringify({ projects: { "/proj/b": { hasTrustDialogAccepted: false } } }));
    ensureWorkspaceTrusted("/proj/a", configPath);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.projects["/proj/a"].hasTrustDialogAccepted).toBe(true);
    expect(config.projects["/proj/b"].hasTrustDialogAccepted).toBe(false);
  });

  it("이미 신뢰된 디렉터리면 파일을 다시 쓰지 않는다(멱등)", () => {
    const configPath = tmpConfigPath();
    writeFileSync(configPath, JSON.stringify({ projects: { "/proj/a": { hasTrustDialogAccepted: true } } }));
    const before = readFileSync(configPath, "utf8");
    ensureWorkspaceTrusted("/proj/a", configPath);
    const after = readFileSync(configPath, "utf8");
    expect(after).toBe(before);
  });

  it("손상된 JSON이면 예외를 던지지 않고 조용히 건너뛴다(진단 경고는 남긴다)", () => {
    const configPath = tmpConfigPath();
    writeFileSync(configPath, "{ not valid json");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => ensureWorkspaceTrusted("/proj/a", configPath)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("/proj/a"));
    warnSpy.mockRestore();
  });

  it("config.projects가 객체가 아니면(기형) TypeError 없이 건너뛴다", () => {
    const configPath = tmpConfigPath();
    writeFileSync(configPath, JSON.stringify({ projects: "not-an-object" }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => ensureWorkspaceTrusted("/proj/a", configPath)).not.toThrow();
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.projects).toBe("not-an-object"); // 손상 파일은 건드리지 않고 그대로 둔다
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("/proj/a"));
    warnSpy.mockRestore();
  });

  it("쓰기 후 tmp 잔재 파일이 남지 않는다", () => {
    const configPath = tmpConfigPath();
    ensureWorkspaceTrusted("/proj/atomic", configPath);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.projects["/proj/atomic"].hasTrustDialogAccepted).toBe(true);
    const dirEntries = readdirSync(dirname(configPath));
    const base = basename(configPath);
    for (const entry of dirEntries) {
      expect(entry === base || !entry.startsWith(`${base}.tmp-`)).toBe(true);
    }
  });
});
