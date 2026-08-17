import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelayServer, type RelayHandle } from "../../src/server/relay.js";
import { startHost, mirrorToTerminal } from "../../src/cli/host.js";
import type { Executor } from "../../src/cli/executor.js";
import { hasPipeline, readPipelineState, writePipelineState } from "../../src/cli/pipeline-store.js";
import { DEFAULT_STEPS } from "../../src/shared/pipeline.js";

// tests/cli/seed-assets.test.ts의 buildFixtureRepo 패턴을 재사용: seedPipelineAssets가
// 요구하는 최소 소스 트리(commands/pipeline/* 7종 정본 + _CONTRACT.md + _GENERIC_STEP.md +
// commands/skills·app-store-screenshots + templates/flutter-starter/overlay/.claude/*)를 구성한다.
function buildFixtureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "cpmc-repo-"));

  mkdirSync(join(repo, "commands", "pipeline"), { recursive: true });
  for (const s of DEFAULT_STEPS) {
    writeFileSync(
      join(repo, "commands", "pipeline", `pipeline-${s.id}.md`),
      `---\ndescription: x\n---\n# ${s.id}\n`,
    );
  }
  writeFileSync(join(repo, "commands", "pipeline", "_CONTRACT.md"), "# 계약\n");
  writeFileSync(
    join(repo, "commands", "pipeline", "_GENERIC_STEP.md"),
    "---\ndescription: 커스텀 — {{STEP_LABEL}}\n---\n# /pipeline-{{STEP_ID}}\n\n{{USER_INSTRUCTIONS}}\n",
  );
  for (const id of ["free-feedback", "dev-discuss", "wireframe-dev", "develop-simple"]) {
    writeFileSync(
      join(repo, "commands", "pipeline", `pipeline-${id}.md`),
      `---\ndescription: ${id}\n---\n# ${id}\n`,
    );
  }

  mkdirSync(join(repo, "commands", "skills", "some-skill"), { recursive: true });
  writeFileSync(join(repo, "commands", "skills", "some-skill", "SKILL.md"), "# some-skill\n");

  mkdirSync(join(repo, "commands", "skills", "app-store-screenshots", "scripts"), { recursive: true });
  writeFileSync(join(repo, "commands", "skills", "app-store-screenshots", "SKILL.md"), "# app-store-screenshots\n");
  writeFileSync(
    join(repo, "commands", "skills", "app-store-screenshots", "scripts", "compose.mjs"),
    "// compose\n",
  );

  mkdirSync(join(repo, "templates", "flutter-starter", "overlay", ".claude"), { recursive: true });
  writeFileSync(join(repo, "templates", "flutter-starter", "pubspec.deps.yaml"), "deps: []\n");
  writeFileSync(
    join(repo, "templates", "flutter-starter", "overlay", ".claude", "settings.json"),
    JSON.stringify({ permissions: { allow: ["Bash(flutter:*)"] } }, null, 2),
  );
  writeFileSync(
    join(repo, "templates", "flutter-starter", "overlay", ".claude", "atomic-mv.sh"),
    '#!/usr/bin/env bash\nset -euo pipefail\nmv "$1" "$2"\n',
  );

  return repo;
}

let handle: RelayHandle | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

// 메시지를 큐에 버퍼링해 빠른 연속 전송에서도 누락되지 않게 한다.
// (ws.once는 리스너 재등록 사이에 도착한 메시지를 잃을 수 있음)
const queues = new WeakMap<WebSocket, any[]>();
const waiters = new WeakMap<WebSocket, ((m: any) => void)[]>();
function watch(ws: WebSocket): void {
  if (queues.has(ws)) return;
  const q: any[] = [];
  queues.set(ws, q);
  waiters.set(ws, []);
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    const w = waiters.get(ws)!;
    if (w.length) w.shift()!(m);
    else q.push(m);
  });
}
function nextMessage(ws: WebSocket): Promise<any> {
  watch(ws);
  const q = queues.get(ws)!;
  if (q.length) return Promise.resolve(q.shift());
  return new Promise((resolve) => waiters.get(ws)!.push(resolve));
}
async function until(ws: WebSocket, type: string): Promise<any> {
  for (;;) {
    const m = await nextMessage(ws);
    if (m.type === type) return m;
  }
}
// type만이 아니라 임의 조건으로 기다려야 하는 파이프라인 테스트용 변형.
async function untilMatch(
  ws: WebSocket,
  pred: (m: any) => boolean,
): Promise<any> {
  for (;;) {
    const m = await nextMessage(ws);
    if (pred(m)) return m;
  }
}

// 재연결 테스트용: 조건이 참이 될 때까지 짧은 간격으로 폴링(고정 sleep보다 빠르고 안정적).
async function waitFor(
  pred: () => boolean,
  timeoutMs = 5000,
  intervalMs = 20,
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: 시간 내에 조건이 충족되지 않았습니다");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("startHost 멀티프로젝트", () => {
  it("createProject→projects 목록, command→project 태그, 같은 프로젝트 중복은 거부", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);

    const slow: Executor = {
      run: (_cmd, _opts) => ({
        done: new Promise((resolve) => {
          setTimeout(() => resolve({}), 80);
        }),
        cancel: () => {},
      }),
    };

    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => slow,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(code).toHaveLength(6);

    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "Alpha" }));
    const projects = await until(phone, "projects");
    expect(projects.names).toContain("alpha");

    phone.send(JSON.stringify({ type: "command", project: "alpha", text: "ㄱ" }));
    const working = await until(phone, "status");
    expect(working).toMatchObject({ project: "alpha", state: "working" });

    phone.send(JSON.stringify({ type: "command", project: "alpha", text: "ㄴ" }));
    const busy = await until(phone, "status");
    expect(busy).toMatchObject({ project: "alpha", state: "error" });

    phone.close();
  });

  it("경로 탈출 project는 실행되지 않고 거부된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    let ran = false;
    const exec: Executor = {
      run: () => ({
        done: (async () => {
          ran = true;
          return {};
        })(),
        cancel: () => {},
      }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    // 존재하지 않는/탈출 시도 프로젝트 → error, executor 실행 안 됨
    phone.send(JSON.stringify({ type: "command", project: "../../etc", text: "x" }));
    const st = await until(phone, "status");
    expect(st.state).toBe("error");
    await new Promise((r) => setTimeout(r, 30));
    expect(ran).toBe(false);
    phone.close();
  });

  it("프로젝트 개수 제한 없이 여러 개를 만들 수 있다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "one" }));
    const p1 = await until(phone, "projects");
    expect(p1.names).toEqual(["one"]);
    expect(p1.trial).toBeUndefined(); // 체험판 개념 제거 — trial 플래그를 더는 보내지 않는다

    phone.send(JSON.stringify({ type: "createProject", name: "two" }));
    const p2 = await until(phone, "projects");
    expect(p2.names).toContain("two"); // 2번째도 정상 생성(제한 없음)
    phone.close();
  });

  it("같은 프로젝트 2번째 명령은 continueSession=true로 실행된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const seen: boolean[] = [];
    const exec: Executor = {
      run: (_c, opts) => ({
        done: (async () => {
          seen.push(opts.continueSession);
          return {};
        })(),
        cancel: () => {},
      }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "memo" }));
    await until(phone, "projects");
    phone.send(JSON.stringify({ type: "command", project: "memo", text: "1" }));
    await until(phone, "preview");
    phone.send(JSON.stringify({ type: "command", project: "memo", text: "2" }));
    await until(phone, "preview");
    expect(seen).toEqual([false, true]);
    phone.close();
  });

  it("대상(target)이 projects 목록과 systemPrompt에 반영된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    let captured: string | undefined;
    const exec: Executor = {
      run: (_c, opts) => ({
        done: (async () => {
          captured = opts.systemPrompt;
          return {};
        })(),
        cancel: () => {},
      }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "shop", target: "web" }));
    const projects = await until(phone, "projects");
    expect(projects.targets).toMatchObject({ shop: "web" });

    phone.send(JSON.stringify({ type: "command", project: "shop", text: "ㄱ" }));
    await until(phone, "preview");
    expect(captured).toContain("웹사이트");

    phone.close();
  });

  it("폰 명령의 Claude 출력이 PC 터미널 로그에도 미러링된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: (_c, opts) => ({
        done: (async () => {
          opts.onEvent({ role: "assistant", text: "안녕하세요" });
          opts.onEvent({ role: "log", text: "🔧 Write" });
          return {};
        })(),
        cancel: () => {},
      }),
    };
    const logs: string[] = [];
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: (m) => logs.push(m),
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "mir" }));
    await until(phone, "projects");
    phone.send(JSON.stringify({ type: "command", project: "mir", text: "ㄱ" }));
    await until(phone, "preview");

    const joined = logs.join("\n");
    expect(joined).toContain("🤖");
    expect(joined).toContain("안녕하세요");
    expect(joined).toContain("🔧 Write");
    expect(joined).toContain("[mir]");
    phone.close();
  });

  it("서로 다른 프로젝트는 동시에 실행된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    let active = 0;
    let maxActive = 0;
    const exec: Executor = {
      run: (_c, _opts) => ({
        done: new Promise((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          setTimeout(() => {
            active--;
            resolve({});
          }, 80);
        }),
        cancel: () => {},
      }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "a" }));
    await until(phone, "projects");
    phone.send(JSON.stringify({ type: "createProject", name: "b" }));
    await until(phone, "projects");

    phone.send(JSON.stringify({ type: "command", project: "a", text: "x" }));
    phone.send(JSON.stringify({ type: "command", project: "b", text: "x" }));
    await new Promise((r) => setTimeout(r, 60));
    expect(maxActive).toBe(2); // 두 프로젝트가 동시에 실행됨

    phone.close();
  });
});

describe("파이프라인 라우팅", () => {
  it("createProject{pipeline:true} → 파이프라인 프로젝트 생성 + stage_update 수신", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    const update = await until(phone, "stage_update");
    expect(update.project).toBe("habit");
    expect(update.pipeline.stage).toBe("ideation");
    expect(update.pipeline.stageStatus).toBe("pending");

    phone.close();
  });

  it("파이프라인 프로젝트로 온 command는 /pipeline-<stage> 재호출로 래핑된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const receivedCommands: string[] = [];
    const receivedOpts: any[] = [];
    const exec: Executor = {
      run: (cmd, opts) => {
        receivedCommands.push(cmd);
        receivedOpts.push(opts);
        // 실제 스킬이 세션ID를 남기는 것을 흉내내 스냅샷 변화를 만든다(중복 억제 회피).
        return { done: Promise.resolve({ sessionId: "fake-session" }), cancel: () => {} };
      },
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    await until(phone, "stage_update");

    phone.send(JSON.stringify({ type: "command", project: "habit", text: "카피앱 아이디어 줘" }));
    const update = await untilMatch(
      phone,
      (m) => m.type === "stage_update" && m.pipeline.queueLength >= 0,
    );
    expect(update.project).toBe("habit");
    // FakeExecutor가 받은 명령을 검증
    expect(receivedCommands[0]).toBe("/pipeline-ideation 피드백: 카피앱 아이디어 줘");
    // 파이프라인 프로젝트에는 targetSystemPrompt가 주입되지 않는다
    expect(receivedOpts[0].systemPrompt).toBeUndefined();

    phone.close();
  });

  it("pipeline_sync에 전 파이프라인 프로젝트 스냅샷이 온다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    await until(phone, "stage_update");

    phone.send(JSON.stringify({ type: "pipeline_sync" }));
    const update = await untilMatch(
      phone,
      (m) => m.type === "stage_update" && m.project === "habit",
    );
    expect(update.pipeline.stage).toBe("ideation");

    phone.close();
  });

  it("projects 메시지에 pipelines/archived 배열이 실린다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    // 파이프라인 1개 + 레거시 1개 생성 후 listProjects 요청
    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    await until(phone, "stage_update");
    await until(phone, "projects"); // 파이프라인 생성 자체가 보낸 projects는 건너뜀

    phone.send(JSON.stringify({ type: "createProject", name: "legacy" }));
    const projects = await until(phone, "projects");

    expect(projects.names.slice().sort()).toEqual(["habit", "legacy"]);
    expect(projects.pipelines).toEqual(["habit"]);
    expect(projects.archived).toEqual([]);

    phone.close();
  });
});

describe("파이프라인 메시지 project 검증(Fix 1)", () => {
  it("project 필드 없는 confirm을 보내도 host가 죽지 않는다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    // project 필드 없는 confirm → join(root, undefined) TypeError로 죽지 않아야 함
    phone.send(JSON.stringify({ type: "confirm", stage: "ideation" }));
    await new Promise((r) => setTimeout(r, 50));

    // host가 살아 있으면 이후 listProjects 요청이 정상 응답한다
    phone.send(JSON.stringify({ type: "listProjects" }));
    const projects = await until(phone, "projects");
    expect(projects.names).toEqual([]);

    phone.close();
  });

  it("경로 탈출 project의 confirm은 무시된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(
      JSON.stringify({ type: "confirm", project: "../evil", stage: "ideation" }),
    );
    const st = await until(phone, "status");
    expect(st.state).toBe("error");

    // host가 살아 있고 목록 요청도 정상 응답한다
    phone.send(JSON.stringify({ type: "listProjects" }));
    const projects = await until(phone, "projects");
    expect(projects.names).toEqual([]);

    phone.close();
  });
});

describe("createPipelineProject 멱등성(Fix 2)", () => {
  it("진행 중인 파이프라인 프로젝트를 재생성 요청해도 stage가 유지된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    await until(phone, "stage_update");

    // stage를 develop로 진행시켜 둔다(스킬이 pipeline.json을 쓴 것을 흉내)
    writePipelineState(join(root, "habit"), {
      schemaVersion: 2,
      project: "habit",
      createdAt: "t",
      template: "default",
      steps: DEFAULT_STEPS,
      stage: "develop",
      stageStatus: "awaiting_confirm",
      artifacts: {},
    });

    // 같은 이름으로 파이프라인 프로젝트 생성을 재요청
    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    const update = await untilMatch(
      phone,
      (m) => m.type === "stage_update" && m.project === "habit",
    );
    expect(update.pipeline.stage).toBe("develop");

    phone.close();
  });

  it("레거시 프로젝트와 같은 이름으로 파이프라인 생성 시 error 응답한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "legacy" }));
    await until(phone, "projects");

    phone.send(JSON.stringify({ type: "createProject", name: "legacy", pipeline: true }));
    const st = await until(phone, "status");
    expect(st.state).toBe("error");

    expect(hasPipeline(join(root, "legacy"))).toBe(false);

    phone.close();
  });
});

describe("chat_history_record_failure", () => {
  it("chat.jsonl이 디렉터리로 존재하면(EISDIR) host는 죽지 않고 명령이 정상 처리된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    const { mkdirSync, writeFileSync } = await import("node:fs");
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: (_c, _opts) => ({
        done: (async () => {
          return {};
        })(),
        cancel: () => {},
      }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    // 프로젝트 생성
    phone.send(JSON.stringify({ type: "createProject", name: "test" }));
    await until(phone, "projects");

    // chat.jsonl을 디렉터리로 만든다 (appendFileSync가 EISDIR로 throw하게)
    const chatDirPath = join(root, "test", "chat.jsonl");
    mkdirSync(chatDirPath, { recursive: true });

    // host가 죽지 않으면 command가 정상 처리되고 status가 온다
    phone.send(JSON.stringify({ type: "command", project: "test", text: "test command" }));
    const status = await until(phone, "status");
    expect(status).toMatchObject({ project: "test", state: "working" });

    // host가 여전히 살아있는지 확인: listProjects 요청이 정상 응답해야 함
    phone.send(JSON.stringify({ type: "listProjects" }));
    const projects = await until(phone, "projects");
    expect(projects.names).toContain("test");

    phone.close();
  });
});

describe("chat_history", () => {
  it("파이프라인 프로젝트에 command 전송 후 chat_history_get → chat_history에 user 엔트리가 포함된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({ sessionId: "fake-session" }), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    await until(phone, "stage_update");

    phone.send(JSON.stringify({ type: "command", project: "habit", text: "카피앱 아이디어 줘" }));
    await untilMatch(
      phone,
      (m) => m.type === "stage_update" && m.pipeline.queueLength >= 0,
    );

    phone.send(JSON.stringify({ type: "chat_history_get", project: "habit" }));
    const history = await until(phone, "chat_history");
    expect(history.project).toBe("habit");
    expect(history.entries.some((e: any) => e.role === "user" && e.text === "카피앱 아이디어 줘")).toBe(true);

    phone.close();
  });

  it("존재하지 않는 프로젝트의 chat_history_get은 무시된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "chat_history_get", project: "../evil" }));
    // host가 살아 있으면 이후 listProjects 요청이 정상 응답한다
    phone.send(JSON.stringify({ type: "listProjects" }));
    const projects = await until(phone, "projects");
    expect(projects.names).toEqual([]);

    phone.close();
  });
});

describe("보관/삭제(project_archive/project_delete)", () => {
  it("project_archive{archived:true} 후 projects 메시지의 archived에 포함된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "arc" }));
    await until(phone, "projects");

    phone.send(JSON.stringify({ type: "project_archive", project: "arc", archived: true }));
    const projects = await until(phone, "projects");
    expect(projects.names).toContain("arc");
    expect(projects.archived).toContain("arc");

    phone.close();
  });

  it("project_delete 후 names에서 사라지고 .trash/ 하위에 백업 디렉터리가 생긴다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "gone" }));
    await until(phone, "projects");

    phone.send(JSON.stringify({ type: "project_delete", project: "gone" }));
    const projects = await until(phone, "projects");
    expect(projects.names).not.toContain("gone");

    const trashDir = join(root, ".trash");
    expect(existsSync(trashDir)).toBe(true);
    const backups = readdirSync(trashDir);
    expect(backups.some((n) => n.startsWith("gone-"))).toBe(true);

    phone.close();
  });

  it("실행 중인(파이프라인) 프로젝트의 project_delete는 거부되고 프로젝트가 남는다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      // 완료되지 않는 fake: 실행 중 상태를 유지한다(기존 재연결 테스트의 미완료 fake 패턴 참고)
      run: () => ({ done: new Promise(() => {}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "busywork", pipeline: true }));
    await until(phone, "stage_update");

    // 피드백 명령으로 파이프라인을 running 상태로 진입시킨다(완료 안 되는 fake이므로 계속 실행 중)
    phone.send(JSON.stringify({ type: "command", project: "busywork", text: "만들어줘" }));
    await new Promise((r) => setTimeout(r, 50));

    phone.send(JSON.stringify({ type: "project_delete", project: "busywork" }));
    const st = await until(phone, "status");
    expect(st.state).toBe("error");
    expect(st.text).toContain("실행 중에는");

    expect(existsSync(join(root, "busywork"))).toBe(true);

    phone.close();
  });

  it("실행 중인(레거시) 프로젝트의 project_delete는 거부되고 프로젝트가 남는다(Fix 1)", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const slow: Executor = {
      run: (_cmd, _opts) => ({
        done: new Promise((resolve) => {
          setTimeout(() => resolve({}), 500);
        }),
        cancel: () => {},
      }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => slow,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "legacy" }));
    await until(phone, "projects");

    // command를 보내 legacy 프로젝트를 실행 중 상태로 만든다(busy Set에 추가됨)
    phone.send(JSON.stringify({ type: "command", project: "legacy", text: "test" }));
    const working = await until(phone, "status");
    expect(working.state).toBe("working");

    // 실행 중인 상태에서 delete 시도
    phone.send(JSON.stringify({ type: "project_delete", project: "legacy" }));
    const st = await until(phone, "status");
    expect(st.state).toBe("error");
    expect(st.text).toContain("실행 중에는");

    // 프로젝트가 여전히 존재
    expect(existsSync(join(root, "legacy"))).toBe(true);

    phone.close();
  });
});

describe("archive/delete fs 가드(Fix 2)", () => {
  it("project_delete 중 fs 호출이 실패해도 host는 죽지 않고 error 응답 후 정상 동작한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    // .trash를 디렉터리가 아닌 "파일"로 미리 만들어, delete 처리 중 mkdirSync(trash, {recursive:true})가
    // ENOTDIR/EEXIST로 throw하게 유도한다.
    writeFileSync(join(root, ".trash"), "not-a-dir");
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "boom" }));
    await until(phone, "projects");

    phone.send(JSON.stringify({ type: "project_delete", project: "boom" }));
    const st = await until(phone, "status");
    expect(st.state).toBe("error");
    expect(st.text).toContain("보관/삭제 처리에 실패했어요");

    // host가 여전히 살아 있으면 이후 listProjects도 정상 응답한다
    phone.send(JSON.stringify({ type: "listProjects" }));
    const projects = await until(phone, "projects");
    expect(projects.names).toContain("boom");

    phone.close();
  });
});

describe("삭제 후 재생성 시 세션 초기화(Fix 3)", () => {
  it("삭제 후 같은 이름으로 재생성하면 첫 명령은 continueSession=false로 실행된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const seen: boolean[] = [];
    const exec: Executor = {
      run: (_c, opts) => ({
        done: (async () => {
          seen.push(opts.continueSession);
          return {};
        })(),
        cancel: () => {},
      }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    // 레거시 프로젝트 생성 후 명령 1회 → started Set에 등록됨
    phone.send(JSON.stringify({ type: "createProject", name: "reborn" }));
    await until(phone, "projects");
    phone.send(JSON.stringify({ type: "command", project: "reborn", text: "1" }));
    await until(phone, "preview");
    expect(seen).toEqual([false]);

    // 삭제
    phone.send(JSON.stringify({ type: "project_delete", project: "reborn" }));
    const projectsAfterDelete = await until(phone, "projects");
    expect(projectsAfterDelete.names).not.toContain("reborn");

    // 같은 이름으로 재생성 후 첫 명령 → started가 정리됐다면 continueSession=false여야 한다
    phone.send(JSON.stringify({ type: "createProject", name: "reborn" }));
    await until(phone, "projects");
    phone.send(JSON.stringify({ type: "command", project: "reborn", text: "2" }));
    await until(phone, "preview");
    expect(seen).toEqual([false, false]);

    phone.close();
  });
});

describe("host 재연결", () => {
  it("host 소켓이 서버에서 강제 종료돼도 백오프 재연결 후 같은 code로 세션을 복원하고, 재페어링 없이 stage_update가 이어진다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    const codes: string[] = [];
    const logs: string[] = [];
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => codes.push(c),
      log: (m) => logs.push(m),
    });
    await waitFor(() => codes.length >= 1);
    expect(codes[0]).toHaveLength(6);

    // 1) 최초 연결로 파이프라인 프로젝트를 만들고 첫 stage_update를 받는다.
    const phone = new WebSocket(
      `ws://localhost:${handle.port}/phone?code=${codes[0]}`,
    );
    await until(phone, "paired");
    phone.send(
      JSON.stringify({ type: "createProject", name: "reco", pipeline: true }),
    );
    const first = await until(phone, "stage_update");
    expect(first.project).toBe("reco");
    expect(first.pipeline.stage).toBe("ideation");

    // 2) host 쪽 WebSocket을 relay 서버에서 강제 종료(재연결 유발).
    //    새 동작: relay는 세션을 즉시 지우지 않고 host 부재를 폰에 통지만 한다(폰 연결 유지).
    const terminated = handle.terminateHostForTest?.(codes[0]);
    expect(terminated).toBe(true);

    const reconnecting = await until(phone, "error");
    expect(reconnecting.text).toContain("재연결");

    // 3) host가 백오프(nextBackoff(0)=500ms) 후 재연결해 "같은" code를 재수신할 때까지 대기.
    await waitFor(() => codes.length >= 2, 5000);
    expect(codes[1]).toBe(codes[0]); // 코드 불변(세션 재획득)
    // 재연결 로그가 실제로 남았는지도 함께 확인(예외 없이 재연결 경로를 탔다는 방증).
    expect(logs.some((l) => l.includes("재연결"))).toBe(true);

    // 4) 폰은 재페어링 없이(기존 소켓 그대로) pipeline_sync를 보낸다 — 재연결 후 동작 복원 검증.
    phone.send(JSON.stringify({ type: "pipeline_sync" }));

    // 5) 같은 폰 소켓으로 stage_update가 다시 수신되어야 한다(host 복귀 후 전달 경로 복원 증거).
    const resynced = await untilMatch(
      phone,
      (m) => m.type === "stage_update" && m.project === "reco",
    );
    expect(resynced.pipeline.stage).toBe("ideation");

    phone.close();
  });
});

describe("템플릿(곁가지)·알림 라우팅", () => {
  it("tpl_list 요청에 default 포함 목록으로 응답한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    const configRoot = mkdtempSync(join(tmpdir(), "cpmc-config-"));
    const repoRoot = buildFixtureRepo();
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      repoRoot,
      configRoot,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "tpl_list" }));
    const msg = await until(phone, "tpl_list");
    expect(msg.templates.map((t: { id: string }) => t.id)).toEqual(["idea-lab", "development"]);
    expect(msg.templates[0].readonly).toBe(true);

    phone.close();
  });

  it("tpl_create/clone, 기본 프롬프트 편집, 즉석 아이디어 개발을 지원한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    const configRoot = mkdtempSync(join(tmpdir(), "cpmc-config-"));
    const repoRoot = buildFixtureRepo();
    handle = await startRelayServer(0);
    const executed: string[] = [];
    const exec: Executor = {
      run: (command) => {
        executed.push(command);
        return { done: Promise.resolve({}), cancel: () => {} };
      },
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      repoRoot,
      configRoot,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "tpl_create", name: "blank flow" }));
    const createdMsg = await until(phone, "tpl_list");
    expect(createdMsg.templates.some((t: { basedOn: string | null; steps: Array<{ id: string }> }) =>
      t.basedOn === null && t.steps[0]?.id === "start")).toBe(true);

    phone.send(JSON.stringify({ type: "tpl_clone", basedOn: "idea-lab", name: "fork" }));
    const msg = await until(phone, "tpl_list");
    expect(msg.templates.length).toBe(4);

    phone.send(JSON.stringify({ type: "tpl_steps_set", id: "idea-lab", steps: [{ label: "x", kind: "custom" }] }));
    const errMsg = await until(phone, "error");
    expect(errMsg.text).toContain("기본 템플릿");

    phone.send(JSON.stringify({
      type: "tpl_prompt_set",
      id: "idea-lab",
      stepId: "ideation",
      body: "# 사용자가 편집한 연구소 프롬프트",
    }));
    const promptMsg = await until(phone, "tpl_prompt");
    expect(promptMsg.id).toBe("idea-lab");
    expect(promptMsg.overridden).toBe(true);
    expect(promptMsg.body).toContain("사용자가 편집한");

    writeFileSync(join(root, "ideas-index.json"), JSON.stringify([{
      slug: "sudden-idea",
      one_liner: "보관한 아이디어",
      detail: "보관함에서 선택한 아이디어",
      adopted: null,
    }]));
    phone.send(JSON.stringify({
      type: "createProject",
      name: "saved-talk",
      pipeline: true,
      ideaSlug: "sudden-idea",
      // template 누락 클라이언트도 development로 보정되어야 한다.
    }));
    await untilMatch(
      phone,
      (m) => m.type === "stage_update" && m.project === "saved-talk",
    );
    expect(readPipelineState(join(root, "saved-talk"))?.template).toBe("development");

    phone.send(JSON.stringify({
      type: "createProject",
      name: "direct-talk",
      pipeline: true,
      template: "development",
      initialPrompt: "산책 중 들은 새소리를 기록하고 도감으로 모으는 앱",
    }));
    await untilMatch(
      phone,
      (m) => m.type === "stage_update" && m.project === "direct-talk",
    );
    const directInput = JSON.parse(
      readFileSync(join(root, "direct-talk", "SELECTED_IDEA.json"), "utf8"),
    );
    expect(directInput.direct_input).toBe(true);
    expect(executed.some((command) => command.includes("새소리를 기록"))).toBe(true);

    phone.close();
  });

  it("tpl_steps_set에 비객체(null) 스텝 원소를 보내도 host가 죽지 않고 error로 응답, 이후 tpl_list도 정상 응답한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    const configRoot = mkdtempSync(join(tmpdir(), "cpmc-config-"));
    const repoRoot = buildFixtureRepo();
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      repoRoot,
      configRoot,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "tpl_clone", basedOn: "idea-lab", name: "곁가지" }));
    const cloneMsg = await until(phone, "tpl_list");
    const cloned = cloneMsg.templates.find((t: { readonly: boolean }) => !t.readonly);
    expect(cloned).toBeTruthy();
    const clonedId = cloned.id;

    // 곁가지 id로 스텝 목록에 곁가지 원소(null)를 섞어 보낸다 — 과거에는 s.label 접근에서
    // uncaughtException으로 host 프로세스 전체가 죽었다.
    phone.send(JSON.stringify({ type: "tpl_steps_set", id: clonedId, steps: [null] }));
    const errMsg = await until(phone, "error");
    expect(errMsg.type).toBe("error");

    // host가 살아있는지 후속 요청으로 확인
    phone.send(JSON.stringify({ type: "tpl_list" }));
    const listMsg = await until(phone, "tpl_list");
    expect(listMsg.templates[0].id).toBe("idea-lab");

    phone.close();
  });

  it("createProject: 없는 템플릿이면 생성하지 않고 status error", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    const configRoot = mkdtempSync(join(tmpdir(), "cpmc-config-"));
    const repoRoot = buildFixtureRepo();
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      repoRoot,
      configRoot,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "ghost-app", pipeline: true, template: "ghost" }));
    const msg = await until(phone, "status");
    expect(msg.state).toBe("error");
    expect(msg.text).toContain("템플릿");

    expect(hasPipeline(join(root, "ghost-app"))).toBe(false);

    phone.close();
  });
});

describe("비JSON 프레임 가드", () => {
  it("비JSON 프레임을 보내도 host는 죽지 않고 이후 listProjects가 정상 응답한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = {
      run: () => ({ done: Promise.resolve({}), cancel: () => {} }),
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    // JSON.parse가 실패하는 비JSON 프레임 — 과거에는 uncaughtException으로 host가 죽었다.
    phone.send("not json");
    await new Promise((r) => setTimeout(r, 50));

    // host가 살아 있으면 이후 listProjects 요청이 정상 응답한다
    phone.send(JSON.stringify({ type: "listProjects" }));
    const projects = await until(phone, "projects");
    expect(projects.names).toEqual([]);

    phone.close();
  });
});

describe("전역 설정(모델) 라우팅", () => {
  it("settings_get은 기본 모델(opus)을 회신한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    const configRoot = mkdtempSync(join(tmpdir(), "cpmc-config-"));
    handle = await startRelayServer(0);
    const exec: Executor = { run: () => ({ done: Promise.resolve({}), cancel: () => {} }) };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      configRoot,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "settings_get" }));
    const s = await until(phone, "settings");
    expect(s.model).toBe("opus");
    phone.close();
  });

  it("settings_set(허용 모델) → 저장 후 settings로 회신하고 파일에 영속된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    const configRoot = mkdtempSync(join(tmpdir(), "cpmc-config-"));
    handle = await startRelayServer(0);
    const exec: Executor = { run: () => ({ done: Promise.resolve({}), cancel: () => {} }) };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      configRoot,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "settings_set", model: "sonnet" }));
    const s = await until(phone, "settings");
    expect(s.model).toBe("sonnet");

    const { readHostSettings } = await import("../../src/cli/settings-store.js");
    expect(readHostSettings(configRoot).model).toBe("sonnet");
    phone.close();
  });

  it("settings_set(허용목록 밖) → 저장하지 않고 기존값을 회신한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    const configRoot = mkdtempSync(join(tmpdir(), "cpmc-config-"));
    handle = await startRelayServer(0);
    const exec: Executor = { run: () => ({ done: Promise.resolve({}), cancel: () => {} }) };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      configRoot,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "settings_set", model: "fable" }));
    await until(phone, "settings");
    phone.send(JSON.stringify({ type: "settings_set", model: "gpt-4o" }));
    const s = await until(phone, "settings");
    expect(s.model).toBe("fable"); // 잘못된 값은 무시, 기존값 유지

    const { readHostSettings } = await import("../../src/cli/settings-store.js");
    expect(readHostSettings(configRoot).model).toBe("fable");
    phone.close();
  });
});

describe("mirrorToTerminal", () => {
  it("error 메시지도 PC 터미널에 로그로 미러링한다", () => {
    const logs: string[] = [];
    mirrorToTerminal((m) => logs.push(m), { type: "error", text: "스텝 항목이 올바르지 않아요" });
    expect(logs).toEqual(["⚠️  스텝 항목이 올바르지 않아요"]);
  });
});
