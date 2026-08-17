import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_STEPS } from "../../src/shared/pipeline.js";
import {
  DEFAULT_TEMPLATE_ID, IDEA_LAB_TEMPLATE_ID, DEVELOPMENT_TEMPLATE_ID,
  listTemplates, getTemplate, cloneTemplate, createTemplate,
  deleteTemplate, setTemplateSteps, stepIdFromLabel, type TplStoreOpts,
  getStepPrompt, setStepPrompt, resetStepPrompt, composeSeedSkills, splitFrontmatter,
} from "../../src/shared/template-store.js";

let repo: string, pipelines: string, o: TplStoreOpts;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "tpl-repo-"));
  pipelines = mkdtempSync(join(tmpdir(), "tpl-data-"));
  // 최소 정본: 7종 빌트인 프롬프트 + 스켈레톤
  mkdirSync(join(repo, "commands", "pipeline"), { recursive: true });
  for (const s of DEFAULT_STEPS) {
    writeFileSync(
      join(repo, "commands", "pipeline", `pipeline-${s.id}.md`),
      `---\ndescription: ${s.id}\n---\n# ${s.id} 본문\n`,
    );
  }
  writeFileSync(
    join(repo, "commands", "pipeline", "pipeline-free-feedback.md"),
    "---\ndescription: free\n---\n# 자유 피드백 본문\n",
  );
  writeFileSync(
    join(repo, "commands", "pipeline", "pipeline-develop-simple.md"),
    "---\ndescription: develop\n---\n# 간단 개발 본문\n",
  );
  writeFileSync(
    join(repo, "commands", "pipeline", "pipeline-dev-discuss.md"),
    "---\ndescription: discuss\n---\n# 개발 논의 본문\n",
  );
  writeFileSync(
    join(repo, "commands", "pipeline", "pipeline-wireframe-dev.md"),
    "---\ndescription: wireframe-dev\n---\n# 개발용 구조 후보 본문\n",
  );
  writeFileSync(join(repo, "commands", "pipeline", "_CONTRACT.md"), "# 계약\n");
  writeFileSync(
    join(repo, "commands", "pipeline", "_GENERIC_STEP.md"),
    "---\ndescription: 커스텀 — {{STEP_LABEL}}\n---\n# /pipeline-{{STEP_ID}}\n\n{{USER_INSTRUCTIONS}}\n",
  );
  o = { repoRoot: repo, pipelinesRoot: pipelines };
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(pipelines, { recursive: true, force: true });
});

describe("listTemplates / getTemplate", () => {
  it("아이디어 연구소와 대화/저장 아이디어 개발 템플릿만 노출한다", () => {
    const list = listTemplates(o);
    expect(list.map((t) => t.id)).toEqual([IDEA_LAB_TEMPLATE_ID, DEVELOPMENT_TEMPLATE_ID]);
    expect(list[0].readonly).toBe(true);
    expect(list[0].promptEditable).toBe(true);
    expect(list[0].steps.map((s) => s.id)).toEqual(["ideation"]);
    expect(list[1].steps.map((s) => s.id)).toEqual([
      "dev-discuss", "wireframe", "develop", "free-feedback",
    ]);
    expect(getTemplate(o, DEFAULT_TEMPLATE_ID)?.steps.map((s) => s.id))
      .toEqual(DEFAULT_STEPS.map((s) => s.id));
  });
  it("개발 프로젝트의 기능논의/구조/개발/자유피드백 프롬프트를 시드한다", () => {
    const list = listTemplates(o);
    expect(list.some((t) => t.id === DEVELOPMENT_TEMPLATE_ID && t.steps.length === 4)).toBe(true);
    const seeded = composeSeedSkills(o, DEVELOPMENT_TEMPLATE_ID);
    expect(seeded.ok).toBe(true);
    if (seeded.ok) {
      expect(seeded.value.some((f) => f.content.includes("개발 논의 본문"))).toBe(true);
      expect(seeded.value.some((f) => f.content.includes("개발용 구조 후보 본문"))).toBe(true);
      expect(seeded.value.some((f) => f.content.includes("자유 피드백 본문"))).toBe(true);
      expect(seeded.value.some((f) => f.content.includes("간단 개발 본문"))).toBe(true);
    }
  });
  it("깨진 manifest는 목록에서 제외한다", () => {
    mkdirSync(join(pipelines, "broken"));
    writeFileSync(join(pipelines, "broken", "manifest.json"), "{not json");
    expect(listTemplates(o).some((t) => t.id === "broken")).toBe(false);
  });
  it("깨진 manifest 제외 시 console.warn으로 경고한다", () => {
    mkdirSync(join(pipelines, "broken2"));
    writeFileSync(join(pipelines, "broken2", "manifest.json"), "{not json");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      listTemplates(o);
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.some((c) => String(c[0]).includes("broken2"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("cloneTemplate", () => {
  it("기본 템플릿 없이 빈 사용자 템플릿을 처음부터 만든다", () => {
    const r = createTemplate(o, "자유 제작");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.readonly).toBe(false);
    expect(r.value.basedOn).toBeNull();
    expect(r.value.steps).toHaveLength(1);
    expect(r.value.steps[0]).toMatchObject({ id: "start", label: "자유 작업", kind: "custom" });
    const prompt = getStepPrompt(o, r.value.id, "start");
    expect(prompt.ok && prompt.value.body.includes("할 일을 여기에")).toBe(true);
  });
  it("default 복제 → 같은 스텝의 편집 가능 템플릿", () => {
    const r = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "내 파이프라인");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.readonly).toBe(false);
    expect(r.value.basedOn).toBe(DEFAULT_TEMPLATE_ID);
    expect(r.value.steps.map((s) => s.id)).toEqual(DEFAULT_STEPS.map((s) => s.id));
    expect(existsSync(join(pipelines, r.value.id, "manifest.json"))).toBe(true);
  });
  it("development에서 복제한 템플릿은 여러 번 복제해도 대화형 개발 흐름을 유지한다", () => {
    const first = cloneTemplate(o, DEVELOPMENT_TEMPLATE_ID, "dev fork");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.developmentFlow).toBe(true);
    for (const stepId of ["dev-discuss", "wireframe", "develop", "free-feedback"]) {
      expect(existsSync(join(pipelines, first.value.id, "steps", `${stepId}.md`))).toBe(true);
    }
    const second = cloneTemplate(o, first.value.id, "dev fork two");
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.developmentFlow).toBe(true);
  });
  it("한글 이름 → tpl-N 자동 id, 이름 충돌 → 접미사", () => {
    const a = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "내꺼");
    const b = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "내꺼");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.id).not.toBe(b.value.id);
  });
  it("없는 basedOn은 에러", () => {
    expect(cloneTemplate(o, "ghost", "x").ok).toBe(false);
  });
  it("이름에 줄바꿈·제어문자가 있으면 거부", () => {
    const r = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "내꺼\n장난");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("제어문자");
  });
  it("40자 이름 충돌 시 접미사가 idSafe(40자 이내)를 넘지 않는다 — 고아 디렉터리 없이 둘 다 성공", () => {
    const longName = "a".repeat(40);
    const a = cloneTemplate(o, DEFAULT_TEMPLATE_ID, longName);
    const b = cloneTemplate(o, DEFAULT_TEMPLATE_ID, longName);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).not.toBeNull();
    expect(b.value).not.toBeNull();
    expect(a.value.id).not.toBe(b.value.id);
    expect(/^[a-z][a-z0-9-]{0,39}$/.test(a.value.id)).toBe(true);
    expect(/^[a-z][a-z0-9-]{0,39}$/.test(b.value.id)).toBe(true);
    const ids = listTemplates(o).map((t) => t.id);
    expect(ids).toContain(a.value.id);
    expect(ids).toContain(b.value.id);
    const dirCount = readdirSync(pipelines, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    expect(dirCount).toBe(2);
  });
});

describe("setTemplateSteps", () => {
  it("커스텀 스텝 추가 → id 자동 생성 + 플레이스홀더 프롬프트 파일 생성", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "fork");
    if (!c.ok) throw new Error("clone 실패");
    const id = c.value.id;
    const r = setTemplateSteps(o, id, [
      { id: "ideation", label: "아이디어", kind: "builtin" },
      { label: "competitor research", kind: "custom" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.steps.length).toBe(2);
    const custom = r.value.steps[1];
    expect(custom.id).toBe("competitor-research");
    expect(custom.timeoutMin).toBe(30);
    expect(existsSync(join(pipelines, id, "steps", `${custom.id}.md`))).toBe(true);
  });
  it("default 수정·빈 목록·예약 id 커스텀·builtin 사칭은 거부", () => {
    expect(setTemplateSteps(o, DEFAULT_TEMPLATE_ID, [{ label: "x", kind: "custom" }]).ok).toBe(false);
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "fork2");
    if (!c.ok) throw new Error("clone 실패");
    expect(setTemplateSteps(o, c.value.id, []).ok).toBe(false);
    // builtin은 예약 id 7종만 가능
    expect(setTemplateSteps(o, c.value.id, [{ id: "hack", label: "x", kind: "builtin" }]).ok).toBe(false);
  });
  it("스텝 배열 원소가 객체가 아니면(null 등) throw 없이 ok:false를 반환한다", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "fork-crash");
    if (!c.ok) throw new Error("clone 실패");
    expect(() => setTemplateSteps(o, c.value.id, [null as any])).not.toThrow();
    const r = setTemplateSteps(o, c.value.id, [null as any]);
    expect(r.ok).toBe(false);
  });
  it("라벨에 줄바꿈·제어문자가 있으면 거부(스켈레톤 frontmatter 오염 방지)", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "fork-ctrl");
    if (!c.ok) throw new Error("clone 실패");
    const r = setTemplateSteps(o, c.value.id, [
      { label: "경쟁사\n조사", kind: "custom" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("제어문자");
  });
  it("스텝 제거 시 그 커스텀 스텝의 프롬프트 파일이 삭제된다(재추가 시 옛 지시 부활 방지)", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "fork-cleanup");
    if (!c.ok) throw new Error("clone 실패");
    const id = c.value.id;
    const added = setTemplateSteps(o, id, [
      { label: "경쟁사 분석", kind: "custom" },
    ]);
    if (!added.ok) throw new Error("추가 실패");
    const customId = added.value.steps[0].id;
    const promptPath = join(pipelines, id, "steps", `${customId}.md`);
    expect(existsSync(promptPath)).toBe(true);

    // 같은 스텝을 목록에서 제거
    const removed = setTemplateSteps(o, id, [
      { id: "ideation", label: "아이디어", kind: "builtin" },
    ]);
    expect(removed.ok).toBe(true);
    expect(existsSync(promptPath)).toBe(false);
  });
  it("builtin 오버라이드도 스텝 제거 시 함께 삭제된다", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "fork-cleanup-builtin");
    if (!c.ok) throw new Error("clone 실패");
    const id = c.value.id;
    expect(setStepPrompt(o, id, "prd", "# 오버라이드\n").ok).toBe(true);
    const overridePath = join(pipelines, id, "steps", "prd.md");
    expect(existsSync(overridePath)).toBe(true);

    // prd 스텝을 목록에서 제거
    const removed = setTemplateSteps(o, id, [
      { id: "ideation", label: "아이디어", kind: "builtin" },
    ]);
    expect(removed.ok).toBe(true);
    expect(existsSync(overridePath)).toBe(false);
  });
});

describe("deleteTemplate", () => {
  it("곁가지 삭제 OK, default·경로탈출 id는 거부", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "gone");
    if (!c.ok) throw new Error("clone 실패");
    expect(deleteTemplate(o, c.value.id).ok).toBe(true);
    expect(getTemplate(o, c.value.id)).toBeNull();
    expect(deleteTemplate(o, DEFAULT_TEMPLATE_ID).ok).toBe(false);
    expect(deleteTemplate(o, "../../etc").ok).toBe(false);
  });
});

describe("stepIdFromLabel", () => {
  it("kebab 변환·예약어/중복 회피·비ASCII 폴백", () => {
    expect(stepIdFromLabel("Competitor Research", new Set())).toBe("competitor-research");
    expect(stepIdFromLabel("PRD", new Set())).toBe("prd-2"); // 예약어 회피
    expect(stepIdFromLabel("경쟁사", new Set())).toBe("step-1");
    expect(stepIdFromLabel("경쟁사", new Set(["step-1"]))).toBe("step-2");
  });
});

describe("splitFrontmatter", () => {
  it("frontmatter와 본문을 분리, 없으면 fm은 빈 문자열", () => {
    expect(splitFrontmatter("---\na: b\n---\n본문")).toEqual({ fm: "---\na: b\n---\n", body: "본문" });
    expect(splitFrontmatter("본문뿐")).toEqual({ fm: "", body: "본문뿐" });
  });
});

describe("프롬프트 get/set/reset", () => {
  it("builtin: 정본 본문 → 수정 저장 → overridden → reset으로 복원", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "fork3");
    if (!c.ok) throw new Error("clone 실패");
    const id = c.value.id;
    const before = getStepPrompt(o, id, "prd");
    expect(before.ok && !before.value.overridden && before.value.body.includes("# prd 본문")).toBe(true);
    expect(setStepPrompt(o, id, "prd", "# 내가 고친 PRD 프롬프트\n").ok).toBe(true);
    const after = getStepPrompt(o, id, "prd");
    expect(after.ok && after.value.overridden && after.value.body.includes("내가 고친")).toBe(true);
    expect(resetStepPrompt(o, id, "prd").ok).toBe(true);
    const restored = getStepPrompt(o, id, "prd");
    expect(restored.ok && !restored.value.overridden).toBe(true);
  });
  it("default 템플릿은 열람만 가능(set 거부), 커스텀 스텝은 파일 본문 그대로", () => {
    expect(getStepPrompt(o, DEFAULT_TEMPLATE_ID, "prd").ok).toBe(true);
    expect(setStepPrompt(o, DEFAULT_TEMPLATE_ID, "prd", "x").ok).toBe(false);
  });
  it("기본 아이디어 연구소 프롬프트는 override 저장·시드·초기화할 수 있다", () => {
    expect(setStepPrompt(o, IDEA_LAB_TEMPLATE_ID, "ideation", "# 내 연구소 프롬프트\n").ok).toBe(true);
    const edited = getStepPrompt(o, IDEA_LAB_TEMPLATE_ID, "ideation");
    expect(edited.ok && edited.value.overridden && edited.value.body.includes("내 연구소")).toBe(true);
    expect(getTemplate(o, IDEA_LAB_TEMPLATE_ID)?.steps[0].overridden).toBe(true);

    const seeded = composeSeedSkills(o, IDEA_LAB_TEMPLATE_ID);
    expect(seeded.ok).toBe(true);
    if (seeded.ok) {
      const skill = seeded.value.find((f) => f.filename === "pipeline-ideation.md");
      expect(skill?.content).toContain("description: ideation");
      expect(skill?.content).toContain("내 연구소 프롬프트");
    }

    expect(resetStepPrompt(o, IDEA_LAB_TEMPLATE_ID, "ideation").ok).toBe(true);
    const restored = getStepPrompt(o, IDEA_LAB_TEMPLATE_ID, "ideation");
    expect(restored.ok && !restored.value.overridden && restored.value.body.includes("# ideation 본문")).toBe(true);
  });
  it("개발 템플릿의 네 프롬프트를 모두 편집·시드·초기화할 수 있다", () => {
    for (const stepId of ["dev-discuss", "wireframe", "develop", "free-feedback"]) {
      const before = getStepPrompt(o, DEVELOPMENT_TEMPLATE_ID, stepId);
      expect(before.ok && before.value.body.length > 0).toBe(true);
      expect(setStepPrompt(o, DEVELOPMENT_TEMPLATE_ID, stepId, `# ${stepId} 사용자 수정\n`).ok).toBe(true);
    }
    expect(getTemplate(o, DEVELOPMENT_TEMPLATE_ID)?.steps.every((s) => s.overridden)).toBe(true);

    const seeded = composeSeedSkills(o, DEVELOPMENT_TEMPLATE_ID);
    expect(seeded.ok).toBe(true);
    if (seeded.ok) {
      for (const stepId of ["dev-discuss", "wireframe", "develop", "free-feedback"]) {
        expect(seeded.value.find((f) => f.filename === `pipeline-${stepId}.md`)?.content)
          .toContain(`${stepId} 사용자 수정`);
      }
    }

    expect(resetStepPrompt(o, DEVELOPMENT_TEMPLATE_ID, "dev-discuss").ok).toBe(true);
    const restored = getStepPrompt(o, DEVELOPMENT_TEMPLATE_ID, "dev-discuss");
    expect(restored.ok && !restored.value.overridden && restored.value.body.includes("개발 논의 본문")).toBe(true);
  });
});

describe("composeSeedSkills", () => {
  it("default: _CONTRACT + 9종 정본 그대로", () => {
    const r = composeSeedSkills(o, DEFAULT_TEMPLATE_ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((f) => f.filename)).toContain("_CONTRACT.md");
    expect(r.value.map((f) => f.filename)).toContain("pipeline-develop.md");
    expect(r.value.map((f) => f.filename)).toContain("pipeline-wireframe.md");
    expect(r.value.map((f) => f.filename)).toContain("pipeline-business.md");
    expect(r.value.length).toBe(10);
  });
  it("곁가지: 오버라이드는 정본 frontmatter+수정 본문, 커스텀은 스켈레톤 치환·플레이스홀더 잔존 없음", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "fork4");
    if (!c.ok) throw new Error("clone 실패");
    const id = c.value.id;
    setStepPrompt(o, id, "prd", "수정된 PRD 본문\n");
    const s = setTemplateSteps(o, id, [
      { id: "prd", label: "PRD", kind: "builtin" },
      { label: "market check", kind: "custom" },
    ]);
    if (!s.ok) throw new Error("steps 실패");
    setStepPrompt(o, id, "market-check", "시장 조사해서 market.md로 저장해줘\n");
    const r = composeSeedSkills(o, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const prd = r.value.find((f) => f.filename === "pipeline-prd.md")!;
    expect(prd.content.startsWith("---\ndescription: prd\n---\n")).toBe(true);
    expect(prd.content).toContain("수정된 PRD 본문");
    const mk = r.value.find((f) => f.filename === "pipeline-market-check.md")!;
    expect(mk.content).toContain("/pipeline-market-check");
    expect(mk.content).toContain("시장 조사해서");
    expect(mk.content).not.toContain("{{");
  });
});

describe("builtin 정본 파일 부재", () => {
  it("getStepPrompt: pipeline-<id>.md가 없으면 throw 대신 ok:false를 반환한다", () => {
    rmSync(join(repo, "commands", "pipeline", "pipeline-prd.md"));
    const r = getStepPrompt(o, DEFAULT_TEMPLATE_ID, "prd");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("기본 스텝 프롬프트 정본이 없어요: pipeline-prd.md");
  });
  it("composeSeedSkills: pipeline-<id>.md가 없으면 throw 대신 ok:false를 반환한다", () => {
    rmSync(join(repo, "commands", "pipeline", "pipeline-develop.md"));
    const r = composeSeedSkills(o, DEFAULT_TEMPLATE_ID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("기본 스텝 프롬프트 정본이 없어요: pipeline-develop.md");
  });
});

describe("스텝 켜기/끄기(enabled)", () => {
  it("스텝을 끄면 getTemplate에 반영되고 composeSeedSkills가 그 스킬을 건너뛴다", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "toggle-tpl");
    if (!c.ok) throw new Error("clone 실패");
    const id = c.value.id;
    // estimate 스텝만 끈다(나머지는 그대로 유지)
    const steps = c.value.steps.map((s) => ({
      id: s.id, label: s.label, kind: s.kind, enabled: s.id !== "estimate",
    }));
    expect(setTemplateSteps(o, id, steps).ok).toBe(true);

    const info = getTemplate(o, id)!;
    expect(info.steps.find((s) => s.id === "estimate")!.enabled).toBe(false);
    expect(info.steps.find((s) => s.id === "develop")!.enabled).toBe(true);

    const composed = composeSeedSkills(o, id);
    if (!composed.ok) throw new Error("compose 실패");
    const names = composed.value.map((f) => f.filename);
    expect(names).not.toContain("pipeline-estimate.md"); // 꺼진 스텝은 시드 제외
    expect(names).toContain("pipeline-develop.md");        // 켜진 스텝은 그대로
  });

  it("모든 스텝을 끄려 하면 거부한다(최소 1개 켜짐)", () => {
    const c = cloneTemplate(o, DEFAULT_TEMPLATE_ID, "alloff-tpl");
    if (!c.ok) throw new Error("clone 실패");
    const steps = c.value.steps.map((s) => ({ id: s.id, label: s.label, kind: s.kind, enabled: false }));
    expect(setTemplateSteps(o, c.value.id, steps).ok).toBe(false);
  });
});
