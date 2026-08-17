// 파이프라인 프로젝트 생성 시 리포의 스킬/템플릿/설정을 프로젝트로 시드한다.
// 스펙 §12.1: 시드가 불완전하면 파이프라인 전체가 통째로 실패할 위험이 있으므로
// 소스가 없을 때 조용히 건너뛰지 않고 명확한 Error를 던진다.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composeSeedSkills, DEFAULT_TEMPLATE_ID } from "../shared/template-store.js";

function requireSource(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`시드 소스가 없습니다: ${label} (${path})`);
  }
}

export interface SeedTemplateOpts {
  pipelinesRoot: string;
  template: string;
}

export function seedPipelineAssets(
  repoRoot: string,
  projectDir: string,
  tpl?: SeedTemplateOpts,
): void {
  const commandsPipeline = join(repoRoot, "commands", "pipeline");
  const commandsSkills = join(repoRoot, "commands", "skills");
  const templatesDir = join(repoRoot, "templates");
  const flutterStarter = join(templatesDir, "flutter-starter");
  const starterSettings = join(
    flutterStarter,
    "overlay",
    ".claude",
    "settings.json",
  );
  const starterAtomicMv = join(
    flutterStarter,
    "overlay",
    ".claude",
    "atomic-mv.sh",
  );

  requireSource(commandsPipeline, "commands/pipeline");
  requireSource(join(commandsPipeline, "_CONTRACT.md"), "commands/pipeline/_CONTRACT.md");
  requireSource(
    join(commandsPipeline, "_GENERIC_STEP.md"),
    "commands/pipeline/_GENERIC_STEP.md",
  );
  requireSource(commandsSkills, "commands/skills");
  requireSource(
    join(commandsSkills, "app-store-screenshots"),
    "commands/skills/app-store-screenshots",
  );
  requireSource(templatesDir, "templates");
  requireSource(flutterStarter, "templates/flutter-starter");
  requireSource(
    starterSettings,
    "templates/flutter-starter/overlay/.claude/settings.json",
  );
  requireSource(
    starterAtomicMv,
    "templates/flutter-starter/overlay/.claude/atomic-mv.sh",
  );

  // 파이프라인 스킬: 템플릿의 스텝 구성대로 합성해 시드한다(스펙 §3).
  // tpl 생략 = default 템플릿(정본 그대로 — 기존 동작과 동일 결과).
  // commands/skills/**(app-store-screenshots 포함) → <project>/.claude/commands/skills/
  // 합성이 실패하면 빈 .claude/commands/ 디렉터리가 잔재로 남지 않도록,
  // 디렉터리 생성은 composeSeedSkills 성공 확인 뒤로 미룬다.
  const claudeCommandsDir = join(projectDir, ".claude", "commands");
  const composed = composeSeedSkills(
    { repoRoot, pipelinesRoot: tpl?.pipelinesRoot ?? join(repoRoot, "pipelines") },
    tpl?.template ?? DEFAULT_TEMPLATE_ID,
  );
  if (!composed.ok) throw new Error(`파이프라인 스킬 합성 실패: ${composed.error}`);
  mkdirSync(claudeCommandsDir, { recursive: true });
  for (const f of composed.value) {
    writeFileSync(join(claudeCommandsDir, f.filename), f.content);
  }
  cpSync(commandsSkills, join(claudeCommandsDir, "skills"), { recursive: true });

  // templates/*(flutter-starter 제외) → <project>/templates/
  // templates/flutter-starter/** → <project>/templates/flutter-starter/
  const projectTemplatesDir = join(projectDir, "templates");
  mkdirSync(projectTemplatesDir, { recursive: true });
  for (const entry of readdirSync(templatesDir, { withFileTypes: true })) {
    if (entry.name === "flutter-starter") continue;
    cpSync(join(templatesDir, entry.name), join(projectTemplatesDir, entry.name), {
      recursive: entry.isDirectory(),
    });
  }
  cpSync(flutterStarter, join(projectTemplatesDir, "flutter-starter"), {
    recursive: true,
  });

  // templates/flutter-starter/overlay/.claude/settings.json → <project>/.claude/settings.json
  const claudeDir = join(projectDir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  cpSync(starterSettings, join(claudeDir, "settings.json"));

  // templates/flutter-starter/overlay/.claude/atomic-mv.sh → <project>/.claude/atomic-mv.sh
  cpSync(starterAtomicMv, join(claudeDir, "atomic-mv.sh"));
}
