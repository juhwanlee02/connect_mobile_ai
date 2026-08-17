import { describe, it, expect, vi } from "vitest";
import {
  mkdtempSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  slugifyProjectName,
  listProjects,
  listProjectTargets,
  createProject,
  createPipelineProject,
  isPipelineProject,
  projectDir,
  moveProjectToTrash,
  ensureSeedProject,
  readProjectTarget,
  targetSystemPrompt,
  readProjectMeta,
  writeProjectMeta,
} from "../../src/cli/projects.js";
import { readdirSync } from "node:fs";
import {
  hasPipeline,
  readPipelineState,
  writePipelineState,
} from "../../src/cli/pipeline-store.js";
import { DEFAULT_STEPS } from "../../src/shared/pipeline.js";

describe("slugifyProjectName", () => {
  it("공백/대문자를 정규화한다", () => {
    expect(slugifyProjectName("My App")).toBe("my-app");
  });
  it("특수문자를 하이픈으로", () => {
    expect(slugifyProjectName("hello_world!!")).toBe("hello-world");
  });
  it("결과가 비면 null", () => {
    expect(slugifyProjectName("   ")).toBeNull();
    expect(slugifyProjectName("한글")).toBeNull();
  });
  it("영문에 한글이 섞이면(조용히 안 자르고) 거부한다", () => {
    expect(slugifyProjectName("내앱app")).toBeNull();
    expect(slugifyProjectName("café")).toBeNull();
  });
});

describe("createProject / listProjects", () => {
  it("public/index.html을 시드하고 목록에 뜬다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createProject(root, "demo");
    expect(existsSync(join(root, "demo", "public", "index.html"))).toBe(true);
    expect(listProjects(root)).toEqual(["demo"]);
  });
  it("기존 index.html을 덮어쓰지 않는다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "KEEP");
    createProject(root, "demo");
    const fs = require("node:fs");
    expect(fs.readFileSync(join(root, "demo", "public", "index.html"), "utf8")).toBe("KEEP");
  });
  it("projectDir은 root/name", () => {
    expect(projectDir("/a", "b")).toBe(join("/a", "b"));
  });
  it("없는 root는 빈 목록", () => {
    expect(listProjects(join(tmpdir(), "no-such-cpmc-xyz"))).toEqual([]);
  });
  it("ensureSeedProject는 비었을 때만 my-app을 만든다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    ensureSeedProject(root);
    expect(listProjects(root)).toEqual(["my-app"]);
    ensureSeedProject(root); // 두 번째 호출은 무시
    expect(listProjects(root)).toEqual(["my-app"]);
  });
});

describe("프로젝트 대상(target)", () => {
  it("기본은 iOS, 지정하면 android/web으로 저장/조회된다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createProject(root, "appy"); // 기본
    createProject(root, "droid", "android");
    createProject(root, "site", "web");
    expect(readProjectTarget(root, "appy")).toBe("ios");
    expect(readProjectTarget(root, "droid")).toBe("android");
    expect(readProjectTarget(root, "site")).toBe("web");
    expect(listProjectTargets(root)).toEqual({
      appy: "ios",
      droid: "android",
      site: "web",
    });
  });
  it("meta.json이 없으면 기본(iOS)로 폴백한다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "legacy", "public"), { recursive: true });
    expect(readProjectTarget(root, "legacy")).toBe("ios");
  });
  it("예전 값 'mobile'은 ios로 호환된다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "old", "public"), { recursive: true });
    writeFileSync(join(root, "old", "meta.json"), JSON.stringify({ target: "mobile" }));
    expect(readProjectTarget(root, "old")).toBe("ios");
  });
  it("최초 대상은 보존된다(재생성해도 안 바뀜)", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createProject(root, "site", "web");
    createProject(root, "site", "ios"); // 이미 있으니 보존
    expect(readProjectTarget(root, "site")).toBe("web");
  });
  it("targetSystemPrompt는 대상별로 다른 지침을 준다", () => {
    expect(targetSystemPrompt("ios")).toContain("iOS");
    expect(targetSystemPrompt("android")).toContain("Android");
    expect(targetSystemPrompt("web")).toContain("웹사이트");
    expect(targetSystemPrompt("ios")).toContain("public/");
  });
});

describe("createPipelineProject", () => {
  it("pipeline.json을 시드하고 public/은 만들지 않으며 meta에 pipeline:true", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createPipelineProject(root, "habit");
    expect(hasPipeline(join(root, "habit"))).toBe(true);
    expect(existsSync(join(root, "habit", "public"))).toBe(false);
    expect(isPipelineProject(root, "habit")).toBe(true);
  });
  it("레거시 프로젝트는 isPipelineProject false", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createProject(root, "legacy", "ios");
    expect(isPipelineProject(root, "legacy")).toBe(false);
  });
  it("멱등: 이미 파이프라인 상태가 있으면 재호출해도 시드하지 않는다(Fix 2)", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    expect(createPipelineProject(root, "habit")).toBe(true);
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
    expect(createPipelineProject(root, "habit")).toBe(true);
    expect(readPipelineState(join(root, "habit"))!.stage).toBe("develop");
  });
  it("레거시 프로젝트와 같은 이름이면 생성을 거부하고 false를 반환한다(Fix 2)", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createProject(root, "legacy", "ios");
    expect(createPipelineProject(root, "legacy")).toBe(false);
    expect(hasPipeline(join(root, "legacy"))).toBe(false);
  });
  it("repoRoot를 생략하면 자산을 시드하지 않는다(기존 계약 유지)", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createPipelineProject(root, "habit");
    expect(existsSync(join(root, "habit", ".claude"))).toBe(false);
  });
  it("신규 생성(repoRoot 없음)시 경고를 한 번 출력한다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    const warnSpy = vi.spyOn(console, "warn");
    createPipelineProject(root, "habit");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith("[pipeline] repoRoot 미지정 — 스킬/템플릿 시드를 건너뜁니다: habit");
    warnSpy.mockRestore();
  });
  it("repoRoot와 함께 신규 생성시 경고하지 않는다", () => {
    const repo = buildFixtureRepo();
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    const warnSpy = vi.spyOn(console, "warn");
    createPipelineProject(root, "habit", repo);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
  it("멱등 재호출(hasPipeline true)시 경고하지 않는다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createPipelineProject(root, "habit");
    const warnSpy = vi.spyOn(console, "warn");
    createPipelineProject(root, "habit");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// 최소 소스 트리를 mkdtemp에 구성해 repoRoot 시드 연동을 검증한다.
// (실제 리포 루트를 쓰면 느리고 리포 구조 변경에 취약해짐 — seed-assets.test.ts와 동일 전략)
function buildFixtureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "cpmc-repo-"));
  mkdirSync(join(repo, "commands", "pipeline"), { recursive: true });
  writeFileSync(
    join(repo, "commands", "pipeline", "pipeline-ideation.md"),
    "---\ndescription: x\n---\n# ideation\n",
  );
  writeFileSync(
    join(repo, "commands", "pipeline", "pipeline-release.md"),
    "---\ndescription: x\n---\n# release\n",
  );
  // default 템플릿 합성(composeSeedSkills)이 성공하려면 나머지 빌트인 스텝 정본과
  // _CONTRACT.md/_GENERIC_STEP.md가 모두 있어야 한다(seed-assets.test.ts와 동일 전략).
  for (const s of DEFAULT_STEPS) {
    const p = join(repo, "commands", "pipeline", `pipeline-${s.id}.md`);
    if (!existsSync(p)) writeFileSync(p, `---\ndescription: x\n---\n# ${s.id}\n`);
  }
  writeFileSync(join(repo, "commands", "pipeline", "_CONTRACT.md"), "# 계약\n");
  writeFileSync(
    join(repo, "commands", "pipeline", "_GENERIC_STEP.md"),
    "---\ndescription: 커스텀 — {{STEP_LABEL}}\n---\n# /pipeline-{{STEP_ID}}\n\n{{USER_INSTRUCTIONS}}\n",
  );
  mkdirSync(join(repo, "commands", "skills", "some-skill"), { recursive: true });
  writeFileSync(join(repo, "commands", "skills", "some-skill", "SKILL.md"), "# s\n");
  mkdirSync(join(repo, "commands", "skills", "app-store-screenshots"), { recursive: true });
  writeFileSync(
    join(repo, "commands", "skills", "app-store-screenshots", "SKILL.md"),
    "# app-store-screenshots\n",
  );
  mkdirSync(join(repo, "templates"), { recursive: true });
  writeFileSync(join(repo, "templates", "PRD.template.md"), "# PRD\n");
  mkdirSync(join(repo, "templates", "flutter-starter", "overlay", ".claude"), {
    recursive: true,
  });
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

describe("createPipelineProject — repoRoot 자산 시드 연동", () => {
  it("repoRoot를 넘기면 신규 생성 시 .claude/commands·templates·settings.json이 함께 시드된다", () => {
    const repo = buildFixtureRepo();
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    expect(createPipelineProject(root, "habit", repo)).toBe(true);
    expect(
      existsSync(join(root, "habit", ".claude", "commands", "pipeline-ideation.md")),
    ).toBe(true);
    expect(
      existsSync(join(root, "habit", ".claude", "commands", "pipeline-release.md")),
    ).toBe(true);
    expect(
      existsSync(
        join(
          root,
          "habit",
          ".claude",
          "commands",
          "skills",
          "app-store-screenshots",
          "SKILL.md",
        ),
      ),
    ).toBe(true);
    expect(existsSync(join(root, "habit", "templates", "PRD.template.md"))).toBe(true);
    const seeded = readFileSync(join(root, "habit", ".claude", "settings.json"), "utf8");
    const original = readFileSync(
      join(repo, "templates", "flutter-starter", "overlay", ".claude", "settings.json"),
      "utf8",
    );
    expect(seeded).toBe(original);
  });
  it("멱등 재호출(hasPipeline true)일 때는 repoRoot를 넘겨도 시드를 재실행하지 않는다", () => {
    const repo = buildFixtureRepo();
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    expect(createPipelineProject(root, "habit", repo)).toBe(true);
    // 시드된 흔적을 지워, 재호출 시 다시 만들어지지 않음을 확인
    rmSync(join(root, "habit", ".claude"), { recursive: true, force: true });
    expect(createPipelineProject(root, "habit", repo)).toBe(true);
    expect(existsSync(join(root, "habit", ".claude"))).toBe(false);
  });
  it("repoRoot의 시드 소스가 불완전하면 명확한 Error를 던진다", () => {
    const repo = buildFixtureRepo();
    rmSync(join(repo, "commands", "skills"), { recursive: true, force: true });
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    expect(() => createPipelineProject(root, "habit", repo)).toThrow();
  });
  it("createPipelineProject: 템플릿 스텝이 pipeline.json에 스냅샷된다", () => {
    const repo = buildFixtureRepo();
    const pipelines = mkdtempSync(join(tmpdir(), "cpmc-tpl-"));
    mkdirSync(join(pipelines, "fork", "steps"), { recursive: true });
    writeFileSync(join(pipelines, "fork", "manifest.json"), JSON.stringify({
      schemaVersion: 1, id: "fork", name: "fork", basedOn: "default", createdAt: "",
      steps: [
        { id: "ideation", label: "아이디어", kind: "builtin" },
        { id: "market-check", label: "시장 확인", kind: "custom" },
      ],
    }));
    writeFileSync(join(pipelines, "fork", "steps", "market-check.md"), "시장 조사\n");
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    const ok = createPipelineProject(root, "custom-app", repo, {
      pipelinesRoot: pipelines, template: "fork",
    });
    expect(ok).toBe(true);
    const state = JSON.parse(readFileSync(join(root, "custom-app", "pipeline.json"), "utf8"));
    expect(state.schemaVersion).toBe(2);
    expect(state.template).toBe("fork");
    expect(state.steps.map((s: { id: string }) => s.id)).toEqual(["ideation", "market-check"]);
    expect(state.stage).toBe("ideation"); // 첫 스텝
    expect(state.steps[1].timeoutMin).toBe(30); // custom 기본
  });
});

describe("listProjects 기준", () => {
  it("meta.json/pipeline.json 없는 디렉터리(.trash 등)는 프로젝트가 아니다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createProject(root, "real", "ios");
    mkdirSync(join(root, ".trash", "old-1234"), { recursive: true });
    mkdirSync(join(root, "random-dir"));
    expect(listProjects(root)).toEqual(["real"]);
  });
});

describe("moveProjectToTrash", () => {
  it("프로젝트를 .trash/ 아래로 옮기고 목록에서 사라진다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createProject(root, "gone", "ios");
    const dest = moveProjectToTrash(root, "gone");
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(join(root, "gone"))).toBe(false);
    expect(listProjects(root)).toEqual([]);
    expect(readdirSync(join(root, ".trash")).some((n) => n.startsWith("gone-"))).toBe(true);
  });

  it("rename이 EBUSY로 계속 실패하면 복사+삭제로 옮긴다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createProject(root, "locked", "ios");
    const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
    const dest = moveProjectToTrash(root, "locked", {
      rename: () => {
        throw busy;
      },
      retryDelayMs: 0,
    });
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(join(root, "locked"))).toBe(false);
    expect(listProjects(root)).toEqual([]);
  });
});

describe("meta 헬퍼", () => {
  it("writeProjectMeta는 기존 필드를 보존하며 병합한다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createPipelineProject(root, "p1");
    writeProjectMeta(root, "p1", { archived: true });
    expect(readProjectMeta(root, "p1")).toEqual({ pipeline: true, archived: true });
  });
});
