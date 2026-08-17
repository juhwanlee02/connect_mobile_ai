import spawn from "cross-spawn";
import {
  existsSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  parseCodexJsonLine,
  parseCursorJsonLine,
  parseStreamJsonLine,
  type AgentEvent,
} from "./stream-json.js";

/** Windows 설치는 PATH에 안 잡히고 %LOCALAPPDATA%\cursor-agent\agent.cmd 에만 있는 경우가 많다. */
export function resolveCursorAgentCommand(): string {
  return resolveCursorAgentLaunch().cmd;
}

/**
 * agent.cmd → PowerShell → node 래퍼를 건너뛰고, 가능하면 node+index.js를 직접 실행한다.
 * (Windows에서 argv가 cmd/PowerShell을 거치면 길이 한도에 더 빨리 걸린다.)
 */
export function resolveCursorAgentLaunch(): { cmd: string; prefixArgs: string[] } {
  const fromEnv = process.env.CURSOR_AGENT_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    if (/\.(js|mjs|cjs)$/i.test(fromEnv)) {
      return { cmd: process.execPath, prefixArgs: [fromEnv] };
    }
    return { cmd: fromEnv, prefixArgs: [] };
  }

  const home = homedir();
  const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
  const installRoot = join(localAppData, "cursor-agent");
  const versionsDir = join(installRoot, "versions");
  if (existsSync(versionsDir)) {
    try {
      const dirs = readdirSync(versionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((n) => /^\d{4}\.\d{1,2}\.\d{1,2}/.test(n))
        .sort()
        .reverse();
      for (const name of dirs) {
        const nodePath = join(versionsDir, name, "node.exe");
        const indexPath = join(versionsDir, name, "index.js");
        if (existsSync(nodePath) && existsSync(indexPath)) {
          return { cmd: nodePath, prefixArgs: [indexPath] };
        }
      }
    } catch { /* fall through */ }
  }

  const candidates = [
    join(installRoot, "agent.cmd"),
    join(installRoot, "agent.exe"),
    join(localAppData, "Programs", "cursor-agent", "agent.cmd"),
    join(home, ".local", "bin", "agent.exe"),
    join(home, ".local", "bin", "agent.cmd"),
    join(home, ".local", "bin", "agent"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return { cmd: c, prefixArgs: [] };
  }
  return { cmd: "agent", prefixArgs: [] };
}

/** Windows CP949 stderr 깨짐/영문 too-long 메시지를 읽기 쉽게 정규화. */
function decodeWinStderr(msg: string): string {
  // CP949 "명령줄이 너무 깁니다"가 UTF-8로 잘못 읽히면 �� 연속이 된다.
  if (
    /too long/i.test(msg) ||
    /command line is too long/i.test(msg) ||
    /명령줄이 너무 깁/.test(msg) ||
    /\uFFFD{2,}/.test(msg)
  ) {
    return "명령줄이 너무 깁니다 (Windows command line too long)";
  }
  return msg;
}

function warnTrustSkip(dir: string): void {
  console.warn("[pipeline] 워크스페이스 신뢰 부여 실패 — 명령이 거부될 수 있습니다: " + dir);
}

// Claude Code의 워크스페이스 신뢰 다이얼로그는 headless(`-p`) 세션에서 뜨지 않지만, 신뢰가
// 자동으로 부여되는 것은 아니다 — 신뢰되지 않은 디렉터리에서는 `.claude/settings.json`의
// `permissions.allow` 전체가 조용히 무시되어 화이트리스트로 허용한 명령까지 전부 거부된다
// (런타임 실측 — Phase 5 Task 4, `.superpowers/sdd/task-4-report.md`). 파이프라인 프로젝트는
// 매번 새 디렉터리로 생성되므로, 최초 headless 호출 전에 이 함수로 신뢰를 프로그램적으로
// 부여한다(Claude Code가 자체 경고 메시지에서 안내하는 바로 그 필드를 채운다).
// `--dangerously-skip-permissions`는 쓰지 않는다 — 전권 우회라 화이트리스트 자체가 무의미해진다
// (스펙 §12.1). 손상된 설정 파일/기형 `projects` 필드면 신뢰 부여를 건너뛰되, 이후 명령 거부의
// 원인을 추적할 수 있도록 진단 경고를 남긴다(exec는 claude의 stdout만 읽으므로 원인이 안 남는다).
// 사용자의 전역 설정 파일이므로 쓰기는 같은 디렉터리의 tmp 파일 → rename으로 원자적으로 수행한다
// (쓰다 죽어도 기존 ~/.claude.json은 훼손되지 않는다 — 이 리포의 원자적 쓰기 계약과 동일 원칙).
export function ensureWorkspaceTrusted(
  dir: string,
  configPath: string = join(homedir(), ".claude.json"),
): void {
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      warnTrustSkip(dir);
      return;
    }
  }
  const rawProjects = config.projects;
  if (
    rawProjects !== undefined &&
    (typeof rawProjects !== "object" || rawProjects === null || Array.isArray(rawProjects))
  ) {
    // config.projects가 기형(예: 문자열)이면 인덱싱 대입이 catch 밖에서 TypeError를 던질 수
    // 있다 — 손상 파일로 간주해 신뢰 부여를 건너뛴다.
    warnTrustSkip(dir);
    return;
  }
  const projects = (config.projects ??= {}) as Record<string, Record<string, unknown>>;
  const entry = projects[dir] ?? {};
  if (entry.hasTrustDialogAccepted === true) return; // 이미 신뢰됨 — 쓰기 생략
  projects[dir] = { ...entry, hasTrustDialogAccepted: true };
  const tmpPath = `${configPath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(config));
    renameSync(tmpPath, configPath);
  } catch {
    // 동시 쓰기 충돌 등 — 다음 실행에서 재시도된다.
    try {
      unlinkSync(tmpPath);
    } catch {
      // tmp 파일이 애초에 안 만들어졌거나 이미 정리됨 — 무시.
    }
    warnTrustSkip(dir);
  }
}

export interface RunOpts {
  continueSession: boolean;
  resumeSessionId?: string;
  onEvent: (e: AgentEvent) => void;
  systemPrompt?: string;
}
export interface RunResult { sessionId?: string; costUsd?: number }
export interface RunHandle { done: Promise<RunResult>; cancel: () => void }
export interface Executor { run(command: string, opts: RunOpts): RunHandle }

// Claude의 `/name args`는 `.claude/commands/name.md`를 자동 확장하지만 Codex/Cursor에는
// 이 명령 체계가 없다. 같은 프로젝트에 시드된 정의를 실제 지침으로 펼쳐 전달한다.
export function expandClaudeCommandForCodex(projectDir: string, command: string): string {
  const match = command.match(/^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return command;
  const [, name, invocationArgs = ""] = match;
  const commandPath = join(projectDir, ".claude", "commands", `${name}.md`);
  if (!existsSync(commandPath)) return command;
  let body: string;
  try {
    body = readFileSync(commandPath, "utf8").replace(
      /^---\r?\n[\s\S]*?\r?\n---\r?\n/,
      "",
    );
  } catch {
    return command;
  }
  return [
    `아래는 Claude Code용 /${name} 명령의 정의입니다.`,
    "이 CLI에서는 슬래시 명령을 다시 호출하거나 사용 가능 여부를 묻지 말고, 아래 정의를 지금 직접 실행하세요.",
    "",
    body.trim(),
    "",
    "## 이번 호출 인자",
    invocationArgs.trim() || "(인자 없음)",
  ].join("\n");
}

export class RealExecutor implements Executor {
  // getModel: 실행 시점에 host 전역 설정에서 현재 모델(별칭)을 읽어오는 seam.
  // 값이 있으면 `--model <별칭>`을 붙인다. 허용목록 검증은 저장 시점(settings-store)에
  // 이미 끝났으므로 여기서는 값이 있으면 그대로 신뢰한다.
  constructor(
    protected projectDir: string,
    private getModel?: () => string | undefined,
  ) {}

  run(command: string, opts: RunOpts): RunHandle {
    this.ensureWorkspaceTrusted(this.projectDir);
    const args = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits",
    ];
    const model = this.getModel?.();
    if (model) args.push("--model", model);
    if (
      opts.resumeSessionId &&
      !opts.resumeSessionId.startsWith("codex:") &&
      !opts.resumeSessionId.startsWith("cursor:")
    ) {
      args.push("--resume", opts.resumeSessionId.replace(/^claude:/, ""));
    }
    else if (opts.continueSession) args.push("--continue");
    if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
    args.push(command);

    const result: RunResult = {};
    const onLine = (line: string) => {
      for (const e of parseStreamJsonLine(line)) {
        if (e.role === "session") result.sessionId = e.sessionId;
        else if (e.role === "result") result.costUsd = e.costUsd;
        else opts.onEvent(e);
      }
    };
    const inner = this.exec("claude", args, onLine);
    return { done: inner.done.then(() => result), cancel: inner.cancel };
  }

  // 테스트에서 오버라이드하는 seam(기본은 실제 ~/.claude.json을 건드리는 모듈 함수 호출 —
  // 테스트는 이 메서드를 no-op으로 오버라이드해 사용자의 실제 설정 파일을 건드리지 않는다).
  protected ensureWorkspaceTrusted(dir: string): void {
    ensureWorkspaceTrusted(dir);
  }

  // 테스트에서 오버라이드하는 seam. 실제 구현은 프로세스 그룹으로 spawn하고
  // cancel 시 그룹째 종료한다(flutter/gradle 고아 방지 — 스펙 §8).
  protected exec(
    cmd: string, args: string[], onLine?: (line: string) => void,
  ): { done: Promise<void>; cancel: () => void } {
    // Codex는 stdin이 파이프 상태면 프롬프트 인자가 있어도 "추가 컨텍스트"의 EOF를
    // 기다린다. headless 실행에서는 stdin을 명시적으로 닫아 첫 JSON 이벤트 전에
    // 무한 대기하지 않게 한다. Claude도 프롬프트를 인자로 받으므로 동일 설정이 안전하다.
    const child = spawn(cmd, args, {
      cwd: this.projectDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let stderr = "";
    const flush = (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) onLine?.(line);
      }
    };
    child.stdout!.on("data", (b: Buffer) => flush(b.toString()));
    child.stderr!.on("data", (b: Buffer) => {
      stderr = (stderr + b.toString()).slice(-4000);
    });
    const done = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (buf.trim()) onLine?.(buf);
        if (code === 0) resolve();
        else {
          const detail = stderr.trim();
          reject(new Error(`${cmd} 종료 코드 ${code}${detail ? `: ${detail}` : ""}`));
        }
      });
    });
    const cancel = () => {
      const pid = child.pid;
      if (!pid) { child.kill("SIGTERM"); return; }
      if (process.platform === "win32") {
        // Windows엔 POSIX 프로세스 그룹(음수 PID 킬)이 없다 — taskkill로 자식 트리째 강제
        // 종료해 flutter/gradle/dart/emulator/adb 손자 프로세스가 고아로 남지 않게 한다.
        // (고아가 남으면 포트 점유·gradle 락·에뮬레이터 사용 중 때문에 다음 실행이 멈춘 것처럼
        // 보인다 — 실사용 "행 걸림"의 주원인.)
        try {
          spawn("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
        } catch {
          child.kill("SIGTERM");
        }
      } else {
        try {
          process.kill(-pid, "SIGTERM"); // POSIX: detached로 만든 프로세스 그룹째 킬
        } catch {
          child.kill("SIGTERM");
        }
      }
    };
    return { done, cancel };
  }
}

export class CodexExecutor extends RealExecutor {
  constructor(
    projectDir: string,
    private getCodexModel?: () => string | undefined,
  ) {
    super(projectDir);
  }

  override run(command: string, opts: RunOpts): RunHandle {
    const resumeId = opts.resumeSessionId?.startsWith("codex:")
      ? opts.resumeSessionId.slice("codex:".length)
      : undefined;
    // 사용자가 폰에서 승인 대화상자를 처리할 수 없는 headless 실행이다. Codex의 공식
    // 전권 플래그를 exec보다 앞(전역 옵션 위치)에 둬 신규/재개 실행 모두 같은 권한으로
    // 동작하게 한다. resume 뒤에 --sandbox를 두면 Codex 0.144.5가 인자 오류로 거부한다.
    const args = ["--dangerously-bypass-approvals-and-sandbox"];
    const model = this.getCodexModel?.();
    if (model) args.push("--model", model);
    args.push("exec");
    if (resumeId) args.push("resume", resumeId);
    else if (opts.continueSession) args.push("resume", "--last");
    args.push("--json");
    const expandedCommand = expandClaudeCommandForCodex(this.projectDir, command);
    const prompt = opts.systemPrompt
      ? `${opts.systemPrompt}\n\n사용자 요청:\n${expandedCommand}`
      : expandedCommand;
    args.push(prompt);

    const result: RunResult = {};
    const onLine = (line: string) => {
      for (const e of parseCodexJsonLine(line)) {
        if (e.role === "session") result.sessionId = e.sessionId;
        else opts.onEvent(e);
      }
    };
    const inner = this.exec("codex", args, onLine);
    return { done: inner.done.then(() => result), cancel: inner.cancel };
  }

  // Codex는 자체 trust/sandbox 설정을 사용하므로 ~/.claude.json을 건드리지 않는다.
  protected override ensureWorkspaceTrusted(): void {}
}

// Cursor Agent CLI (`agent`) — 구독/로그인 또는 CURSOR_API_KEY로 인증.
// headless: --print + stream-json, 승인 생략(--force), 워크스페이스 신뢰(--trust).
export class CursorExecutor extends RealExecutor {
  constructor(
    projectDir: string,
    private getCursorModel?: () => string | undefined,
  ) {
    super(projectDir);
  }

  override run(command: string, opts: RunOpts): RunHandle {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--force",
      "--trust",
      "--workspace", this.projectDir,
      "--sandbox", "disabled",
    ];
    const model = this.getCursorModel?.();
    if (model && model !== "auto") args.push("--model", model);

    const resumeId = opts.resumeSessionId?.startsWith("cursor:")
      ? opts.resumeSessionId.slice("cursor:".length)
      : undefined;
    if (resumeId) args.push("--resume", resumeId);
    else if (opts.continueSession) args.push("--continue");

    // Windows 명령줄 상한(~8191자) 때문에 펼친 스킬 본문을 argv에 넣으면
    // "명령줄이 너무 깁니다"로 바로 실패한다. 파일로 넘기고 짧은 지시만 인자로 준다.
    const expandedCommand = expandClaudeCommandForCodex(this.projectDir, command);
    const prompt = opts.systemPrompt
      ? `${opts.systemPrompt}\n\n사용자 요청:\n${expandedCommand}`
      : expandedCommand;
    const promptFile = ".cursor-host-prompt.md";
    writeFileSync(join(this.projectDir, promptFile), prompt, "utf8");
    args.push(
      [
        `프로젝트 루트의 \`${promptFile}\` 파일을 읽고, 그 안의 지시를 빠짐없이 끝까지 수행하세요.`,
        "요약만 하지 말고 파일 내용을 그대로 실행하세요. 이 파일은 host가 방금 쓴 실행 지시서입니다.",
      ].join(" "),
    );

    const result: RunResult = {};
    const onLine = (line: string) => {
      for (const e of parseCursorJsonLine(line)) {
        if (e.role === "session") result.sessionId = e.sessionId;
        else opts.onEvent(e);
      }
    };
    // PATH에 없어도 %LOCALAPPDATA%\cursor-agent\agent.cmd 를 직접 쓴다.
    // 가능하면 node+index.js를 직접 띄워 cmd/PowerShell 래퍼의 인자 길이 문제를 더 줄인다.
    const { cmd: agentCmd, prefixArgs } = resolveCursorAgentLaunch();
    const inner = this.exec(agentCmd, [...prefixArgs, ...args], onLine);
    const done = inner.done.then(
      () => result,
      (err: unknown) => {
        const msg = decodeWinStderr(err instanceof Error ? err.message : String(err));
        if (/ENOENT|not found|못 찾|cannot find/i.test(msg)) {
          throw new Error(
            "Cursor Agent CLI를 찾을 수 없어요. 보통 %LOCALAPPDATA%\\cursor-agent\\agent.cmd 에 있습니다. " +
              "없으면 PowerShell에서 irm 'https://cursor.com/install?win32=true' | iex 후 agent login. " +
              "또는 CURSOR_AGENT_PATH에 agent.cmd 전체 경로를 지정하세요.",
          );
        }
        if (/too long|너무 깁/i.test(msg)) {
          throw new Error(
            "Cursor 실행 인자가 Windows 명령줄 한도를 넘었어요. 긴 스킬은 파일로 넘기도록 고쳤으니 npm start를 재시작한 뒤 다시 시도하세요.",
          );
        }
        throw new Error(msg);
      },
    );
    return { done, cancel: inner.cancel };
  }

  protected override ensureWorkspaceTrusted(): void {}
}
