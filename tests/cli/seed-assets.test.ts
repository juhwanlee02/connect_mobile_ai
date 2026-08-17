import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seedPipelineAssets } from "../../src/cli/seed-assets.js";
import { DEFAULT_STEPS } from "../../src/shared/pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_REPO_ROOT = resolve(__dirname, "..", "..");

// 최소 소스 트리를 mkdtemp에 구성해 seedPipelineAssets의 복사 규칙을 검증한다.
// (실제 리포 루트를 쓰면 테스트가 느리고 리포 구조 변경에 취약해짐)
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
  writeFileSync(join(repo, "commands", "pipeline", "NOTES.txt"), "not-a-skill");
  // default 템플릿 합성(composeSeedSkills)이 성공하려면 나머지 빌트인 스텝 정본과
  // _CONTRACT.md/_GENERIC_STEP.md가 모두 있어야 한다(Task 4 template-store.test.ts와 동일 전략).
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
  writeFileSync(
    join(repo, "commands", "skills", "some-skill", "SKILL.md"),
    "# some-skill\n",
  );

  mkdirSync(join(repo, "commands", "skills", "app-store-screenshots", "scripts"), {
    recursive: true,
  });
  writeFileSync(
    join(repo, "commands", "skills", "app-store-screenshots", "SKILL.md"),
    "# app-store-screenshots\n",
  );
  writeFileSync(
    join(repo, "commands", "skills", "app-store-screenshots", "scripts", "compose.mjs"),
    "// compose\n",
  );

  mkdirSync(join(repo, "templates"), { recursive: true });
  writeFileSync(join(repo, "templates", "PRD.template.md"), "# PRD\n");
  writeFileSync(join(repo, "templates", "ESTIMATE.template.md"), "# ESTIMATE\n");

  mkdirSync(join(repo, "templates", "flutter-starter", "overlay", ".claude"), {
    recursive: true,
  });
  writeFileSync(
    join(repo, "templates", "flutter-starter", "pubspec.deps.yaml"),
    "deps: []\n",
  );
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

describe("seedPipelineAssets — 픽스처 소스 트리 기준", () => {
  let repo: string;
  let project: string;

  beforeEach(() => {
    repo = buildFixtureRepo();
    project = mkdtempSync(join(tmpdir(), "cpmc-proj-"));
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  it("commands/pipeline/*.md를 .claude/commands/에 평탄하게 복사한다", () => {
    seedPipelineAssets(repo, project);
    expect(
      existsSync(join(project, ".claude", "commands", "pipeline-ideation.md")),
    ).toBe(true);
    expect(
      existsSync(join(project, ".claude", "commands", "pipeline-release.md")),
    ).toBe(true);
    // .md가 아닌 파일은 복사되지 않는다
    expect(existsSync(join(project, ".claude", "commands", "NOTES.txt"))).toBe(false);
    // pipeline/ 하위 폴더 구조로는 만들어지지 않는다(평탄화)
    expect(existsSync(join(project, ".claude", "commands", "pipeline"))).toBe(false);
  });

  it("commands/skills/**(app-store-screenshots 포함)를 폴더명 유지해 복사한다", () => {
    seedPipelineAssets(repo, project);
    expect(
      existsSync(
        join(project, ".claude", "commands", "skills", "some-skill", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(project, ".claude", "commands", "skills", "app-store-screenshots", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          project,
          ".claude",
          "commands",
          "skills",
          "app-store-screenshots",
          "scripts",
          "compose.mjs",
        ),
      ),
    ).toBe(true);
  });

  it("templates/*(flutter-starter 제외)를 templates/로, flutter-starter는 그 하위로 복사한다", () => {
    seedPipelineAssets(repo, project);
    expect(existsSync(join(project, "templates", "PRD.template.md"))).toBe(true);
    expect(existsSync(join(project, "templates", "ESTIMATE.template.md"))).toBe(true);
    expect(
      existsSync(join(project, "templates", "flutter-starter", "pubspec.deps.yaml")),
    ).toBe(true);
    expect(
      existsSync(
        join(
          project,
          "templates",
          "flutter-starter",
          "overlay",
          ".claude",
          "settings.json",
        ),
      ),
    ).toBe(true);
  });

  it(".claude/settings.json을 스타터 원본과 동일 내용으로 복사한다", () => {
    seedPipelineAssets(repo, project);
    const seeded = readFileSync(join(project, ".claude", "settings.json"), "utf8");
    const original = readFileSync(
      join(repo, "templates", "flutter-starter", "overlay", ".claude", "settings.json"),
      "utf8",
    );
    expect(seeded).toBe(original);
  });

  it(".claude/atomic-mv.sh를 스타터 원본과 동일 내용으로 복사한다", () => {
    seedPipelineAssets(repo, project);
    const seededPath = join(project, ".claude", "atomic-mv.sh");
    expect(existsSync(seededPath)).toBe(true);
    const seeded = readFileSync(seededPath, "utf8");
    const original = readFileSync(
      join(
        repo,
        "templates",
        "flutter-starter",
        "overlay",
        ".claude",
        "atomic-mv.sh",
      ),
      "utf8",
    );
    expect(seeded).toBe(original);
    expect(seeded).toContain('mv "$1" "$2"');
  });

  it("소스 누락 시 조용히 skip하지 않고 명확한 Error를 던진다", () => {
    rmSync(join(repo, "commands", "pipeline"), { recursive: true, force: true });
    expect(() => seedPipelineAssets(repo, project)).toThrow();
  });

  it("composeSeedSkills 합성 실패 시 .claude/commands/가 아예 만들어지지 않는다", () => {
    // 빌트인 스텝 정본 하나를 제거해 composeSeedSkills가 실패하도록 유도한다
    // (commands/pipeline 자체는 존재하므로 그 이전의 requireSource 검증은 통과함).
    rmSync(join(repo, "commands", "pipeline", "pipeline-release.md"));
    expect(() => seedPipelineAssets(repo, project)).toThrow();
    expect(existsSync(join(project, ".claude", "commands"))).toBe(false);
  });

  it("templates/flutter-starter/overlay/.claude/settings.json 누락 시 Error", () => {
    rmSync(
      join(repo, "templates", "flutter-starter", "overlay", ".claude", "settings.json"),
    );
    expect(() => seedPipelineAssets(repo, project)).toThrow();
  });

  it("commands/skills 누락 시 Error", () => {
    rmSync(join(repo, "commands", "skills"), { recursive: true, force: true });
    expect(() => seedPipelineAssets(repo, project)).toThrow();
  });

  it("commands/skills/app-store-screenshots 누락 시 Error", () => {
    rmSync(join(repo, "commands", "skills", "app-store-screenshots"), {
      recursive: true,
      force: true,
    });
    expect(() => seedPipelineAssets(repo, project)).toThrow();
  });

  it("templates 자체 누락 시 Error", () => {
    rmSync(join(repo, "templates"), { recursive: true, force: true });
    expect(() => seedPipelineAssets(repo, project)).toThrow();
  });

  it("템플릿 지정 시 커스텀 스텝 스킬이 합성되어 시드된다", () => {
    const pipelines = mkdtempSync(join(tmpdir(), "cpmc-tpl-"));
    // 곁가지: ideation(빌트인) + market-check(커스텀)
    mkdirSync(join(pipelines, "fork", "steps"), { recursive: true });
    writeFileSync(join(pipelines, "fork", "manifest.json"), JSON.stringify({
      schemaVersion: 1, id: "fork", name: "fork", basedOn: "default", createdAt: "",
      steps: [
        { id: "ideation", label: "아이디어", kind: "builtin" },
        { id: "market-check", label: "시장 확인", kind: "custom" },
      ],
    }));
    writeFileSync(join(pipelines, "fork", "steps", "market-check.md"), "시장 조사\n");
    seedPipelineAssets(repo, project, { pipelinesRoot: pipelines, template: "fork" });
    const cmds = join(project, ".claude", "commands");
    expect(existsSync(join(cmds, "pipeline-ideation.md"))).toBe(true);
    expect(existsSync(join(cmds, "pipeline-market-check.md"))).toBe(true);
    expect(readFileSync(join(cmds, "pipeline-market-check.md"), "utf8")).toContain("시장 조사");
    // 템플릿에 없는 빌트인 스텝은 시드하지 않는다
    expect(existsSync(join(cmds, "pipeline-release.md"))).toBe(false);
    expect(existsSync(join(cmds, "_CONTRACT.md"))).toBe(true);
  });
});

// 실제 리포 구조를 대상으로 한 스모크 1건(존재 확인 위주 — 느려지지 않게 최소만).
describe("seedPipelineAssets — 실제 리포 구조 스모크", () => {
  it("실제 repoRoot 기준으로 핵심 파일들이 시드된다", () => {
    const project = mkdtempSync(join(tmpdir(), "cpmc-real-"));
    try {
      seedPipelineAssets(REAL_REPO_ROOT, project);
      expect(
        existsSync(join(project, ".claude", "commands", "pipeline-ideation.md")),
      ).toBe(true);
      expect(
        existsSync(join(project, ".claude", "commands", "pipeline-release.md")),
      ).toBe(true);
      expect(
        existsSync(
          join(project, ".claude", "commands", "skills", "app-store-screenshots", "SKILL.md"),
        ),
      ).toBe(true);
      expect(existsSync(join(project, ".claude", "settings.json"))).toBe(true);
      expect(existsSync(join(project, "templates", "PRD.template.md"))).toBe(true);
      const seeded = readFileSync(join(project, ".claude", "settings.json"), "utf8");
      const original = readFileSync(
        join(
          REAL_REPO_ROOT,
          "templates",
          "flutter-starter",
          "overlay",
          ".claude",
          "settings.json",
        ),
        "utf8",
      );
      expect(seeded).toBe(original);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
