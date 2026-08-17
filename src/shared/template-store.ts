// 파이프라인 템플릿(곁가지) 저장소: pipelines/<id>/manifest.json + steps/<stepId>.md
// default는 리포 commands/pipeline/* 을 그대로 노출하는 읽기전용 가상 템플릿.
// CLI(host)와 릴레이(설정 페이지 — 후속 스펙) 양쪽에서 쓰므로 shared에 둔다.
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync,
  rmSync, writeFileSync,
} from "node:fs";
import { join, normalize, sep } from "node:path";
import { DEFAULT_STEPS, RESERVED_STEP_IDS, type StepDef } from "./pipeline.js";

export const DEFAULT_TEMPLATE_ID = "default";
export const IDEATION_TEMPLATE_ID = "ideation-meeting";
export const FREE_FEEDBACK_TEMPLATE_ID = "free-feedback";
export const THREE_STEP_TEMPLATE_ID = "three-step";
export const IDEA_LAB_TEMPLATE_ID = "idea-lab";
export const DEVELOPMENT_TEMPLATE_ID = "development";
const CUSTOM_TIMEOUT_MIN = 30;
const MAX_STEPS = 20;
const MAX_LABEL_LEN = 20;
const MAX_PROMPT_BYTES = 65536;
// {{STEP_LABEL}}이 스켈레톤 YAML frontmatter의 description: 줄에 그대로 치환되므로,
// 줄바꿈·제어문자가 섞인 라벨/이름은 시드되는 스킬 파일 자체를 깨뜨린다.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

export interface TemplateStep extends StepDef { overridden: boolean; enabled: boolean }
export interface TemplateInfo {
  id: string; name: string; basedOn: string | null;
  readonly: boolean;
  /** 스텝 구성은 잠겨 있어도 각 스텝 프롬프트는 사용자 override를 허용한다. */
  promptEditable?: boolean;
  /** 저장 아이디어 선택 또는 대화 입력으로 시작하는 개발 전용 흐름이다. */
  developmentFlow?: boolean;
  steps: TemplateStep[];
}
export interface TplStoreOpts { repoRoot: string; pipelinesRoot: string }
export type TplResult<T> = { ok: true; value: T } | { ok: false; error: string };

const err = (error: string): { ok: false; error: string } => ({ ok: false, error });

interface ManifestStep { id: string; label: string; kind: "builtin" | "custom"; enabled?: boolean }
interface Manifest {
  schemaVersion: 1; id: string; name: string;
  basedOn: string | null; createdAt: string; steps: ManifestStep[];
}

// id 검증 = 경로 탈출 1차 방어(프로젝트명과 동일 문자 규칙)
function idSafe(id: string): boolean {
  return /^[a-z][a-z0-9-]{0,39}$/.test(id);
}

function tplDir(o: TplStoreOpts, id: string): string {
  return join(o.pipelinesRoot, id);
}
function stepPromptPath(o: TplStoreOpts, id: string, stepId: string): string {
  return join(tplDir(o, id), "steps", `${stepId}.md`);
}
export function builtinPromptPath(o: TplStoreOpts, stepId: string): string {
  return join(o.repoRoot, "commands", "pipeline", `pipeline-${stepId}.md`);
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function readManifest(o: TplStoreOpts, id: string): Manifest | null {
  if (!idSafe(id)) return null;
  try {
    const raw = JSON.parse(readFileSync(join(tplDir(o, id), "manifest.json"), "utf8"));
    if (raw?.schemaVersion !== 1 || raw.id !== id) return null;
    if (typeof raw.name !== "string" || !Array.isArray(raw.steps) || raw.steps.length === 0) return null;
    const steps: ManifestStep[] = [];
    for (const s of raw.steps) {
      if (typeof s?.id !== "string" || typeof s?.label !== "string") return null;
      if (s.kind !== "builtin" && s.kind !== "custom") return null;
      steps.push({ id: s.id, label: s.label, kind: s.kind, enabled: s.enabled !== false });
    }
    return {
      schemaVersion: 1, id, name: raw.name,
      basedOn: typeof raw.basedOn === "string" ? raw.basedOn : null,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
      steps,
    };
  } catch {
    return null;
  }
}

function writeManifest(o: TplStoreOpts, m: Manifest): void {
  mkdirSync(tplDir(o, m.id), { recursive: true });
  atomicWrite(join(tplDir(o, m.id), "manifest.json"), JSON.stringify(m, null, 2));
}

// manifest 스텝 → 타임아웃·오버라이드 여부를 채운 표시용 스텝
function toTemplateStep(o: TplStoreOpts, tplId: string, s: ManifestStep): TemplateStep {
  const base = DEFAULT_STEPS.find((d) => d.id === s.id);
  return {
    id: s.id, label: s.label, kind: s.kind,
    timeoutMin: s.kind === "builtin" && base ? base.timeoutMin : CUSTOM_TIMEOUT_MIN,
    enabled: s.enabled !== false,
    overridden:
      tplId !== DEFAULT_TEMPLATE_ID && existsSync(stepPromptPath(o, tplId, s.id)),
  };
}

function defaultTemplate(): TemplateInfo {
  return {
    id: DEFAULT_TEMPLATE_ID, name: "일반 프로젝트 (전체 9단계)", basedOn: null, readonly: true,
    steps: DEFAULT_STEPS.map((s) => ({ ...s, overridden: false, enabled: true })),
  };
}

function ideationTemplate(): TemplateInfo {
  const step = DEFAULT_STEPS.find((s) => s.id === "ideation")!;
  return {
    id: IDEATION_TEMPLATE_ID,
    name: "아이디어 연구소",
    basedOn: null,
    readonly: true,
    // 발산 20+ · 다중 에이전트 · 웹 조사가 있어 기본 15분보다 길게 둔다.
    steps: [{ ...step, label: "아이디어 연구소", timeoutMin: 90, overridden: false, enabled: true }],
  };
}

function freeFeedbackTemplate(): TemplateInfo {
  return {
    id: FREE_FEEDBACK_TEMPLATE_ID,
    name: "자유 피드백",
    basedOn: null,
    readonly: true,
    steps: [{
      id: "free-feedback",
      label: "자유 피드백",
      kind: "custom",
      timeoutMin: CUSTOM_TIMEOUT_MIN,
      overridden: false,
      enabled: true,
    }],
  };
}

function threeStepTemplate(): TemplateInfo {
  const ideation = DEFAULT_STEPS.find((s) => s.id === "ideation")!;
  const develop = DEFAULT_STEPS.find((s) => s.id === "develop")!;
  return {
    id: THREE_STEP_TEMPLATE_ID,
    name: "3단계 앱 제작",
    basedOn: null,
    readonly: true,
    steps: [
      { ...ideation, label: "아이디어 연구소", overridden: false, enabled: true },
      { ...develop, label: "개발", overridden: true, enabled: true },
      {
        id: "free-feedback",
        label: "자유 피드백",
        kind: "custom",
        timeoutMin: CUSTOM_TIMEOUT_MIN,
        overridden: false,
        enabled: true,
      },
    ],
  };
}

function ideaLabTemplate(o?: TplStoreOpts): TemplateInfo {
  const ideation = DEFAULT_STEPS.find((s) => s.id === "ideation")!;
  return {
    id: IDEA_LAB_TEMPLATE_ID,
    name: "아이디어 연구소",
    basedOn: null,
    readonly: true,
    promptEditable: true,
    steps: [{
      ...ideation,
      label: "아이디어 연구소",
      timeoutMin: 90,
      overridden: !!o && existsSync(stepPromptPath(o, IDEA_LAB_TEMPLATE_ID, "ideation")),
      enabled: true,
    }],
  };
}

function developmentTemplate(o?: TplStoreOpts): TemplateInfo {
  const develop = DEFAULT_STEPS.find((s) => s.id === "develop")!;
  const wireframe = DEFAULT_STEPS.find((s) => s.id === "wireframe")!;
  return {
    id: DEVELOPMENT_TEMPLATE_ID,
    name: "개발 프로젝트",
    basedOn: null,
    readonly: true,
    promptEditable: true,
    developmentFlow: true,
    steps: [
      {
        id: "dev-discuss",
        label: "기능 논의",
        kind: "custom",
        timeoutMin: CUSTOM_TIMEOUT_MIN,
        overridden: !!o && existsSync(stepPromptPath(o, DEVELOPMENT_TEMPLATE_ID, "dev-discuss")),
        enabled: true,
      },
      {
        ...wireframe, label: "구조 후보",
        overridden: !!o && existsSync(stepPromptPath(o, DEVELOPMENT_TEMPLATE_ID, "wireframe")),
        enabled: true,
      },
      {
        ...develop, label: "개발",
        overridden: !!o && existsSync(stepPromptPath(o, DEVELOPMENT_TEMPLATE_ID, "develop")),
        enabled: true,
      },
      {
        id: "free-feedback",
        label: "자유 피드백",
        kind: "custom",
        timeoutMin: CUSTOM_TIMEOUT_MIN,
        overridden: !!o && existsSync(stepPromptPath(o, DEVELOPMENT_TEMPLATE_ID, "free-feedback")),
        enabled: true,
      },
    ],
  };
}

function builtinTemplate(id: string, o?: TplStoreOpts): TemplateInfo | null {
  if (id === DEFAULT_TEMPLATE_ID) return defaultTemplate();
  if (id === IDEATION_TEMPLATE_ID) return ideationTemplate();
  if (id === FREE_FEEDBACK_TEMPLATE_ID) return freeFeedbackTemplate();
  if (id === THREE_STEP_TEMPLATE_ID) return threeStepTemplate();
  if (id === IDEA_LAB_TEMPLATE_ID) return ideaLabTemplate(o);
  if (id === DEVELOPMENT_TEMPLATE_ID) return developmentTemplate(o);
  return null;
}

function usesDevelopmentFlow(o: TplStoreOpts, id: string, seen = new Set<string>()): boolean {
  if (id === DEVELOPMENT_TEMPLATE_ID) return true;
  if (seen.has(id) || builtinTemplate(id)) return false;
  seen.add(id);
  const manifest = readManifest(o, id);
  return !!manifest?.basedOn && usesDevelopmentFlow(o, manifest.basedOn, seen);
}

export function getTemplate(o: TplStoreOpts, id: string): TemplateInfo | null {
  const builtin = builtinTemplate(id, o);
  if (builtin) return builtin;
  const m = readManifest(o, id);
  if (!m) return null;
  return {
    id: m.id, name: m.name, basedOn: m.basedOn, readonly: false,
    developmentFlow: usesDevelopmentFlow(o, m.id),
    steps: m.steps.map((s) => toTemplateStep(o, id, s)),
  };
}

export function listTemplates(o: TplStoreOpts): TemplateInfo[] {
  const out = [ideaLabTemplate(o), developmentTemplate(o)];
  if (!existsSync(o.pipelinesRoot)) return out;
  for (const e of readdirSync(o.pipelinesRoot, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (builtinTemplate(e.name)) continue;
    const t = getTemplate(o, e.name);
    if (t) out.push(t);
    else console.warn(`⚠️ 깨진 템플릿 manifest를 건너뜁니다: ${e.name}`);
  }
  return out;
}

// 임의 문자열 → kebab-case 조각(소문자 영숫자·하이픈만, 선행 문자는 알파벳).
// 비ASCII·기호는 하이픈으로 뭉개고, 결과가 숫자/하이픈으로 시작하면 빈 문자열을 반환한다.
function kebab(raw: string): string {
  let base = raw.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(base)) base = "";
  return base;
}

// label → kebab id. 비ASCII·빈 결과는 step-N, 예약어·중복은 -2.. 접미사.
export function stepIdFromLabel(label: string, taken: Set<string>): string {
  const base = kebab(label);
  if (!base) {
    let n = 1;
    while (taken.has(`step-${n}`)) n++;
    return `step-${n}`;
  }
  if (!RESERVED_STEP_IDS.includes(base) && !taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`) || RESERVED_STEP_IDS.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const ID_MAX_LEN = 40; // idSafe = /^[a-z][a-z0-9-]{0,39}$/ 와 동일한 상한

function templateIdFromName(o: TplStoreOpts, name: string): string {
  let base = kebab(name);
  if (base === DEFAULT_TEMPLATE_ID) base = "";
  const exists = (id: string) =>
    !!builtinTemplate(id) || existsSync(tplDir(o, id));
  if (base && idSafe(base) && !exists(base)) return base;
  const stem = base || "tpl";
  let n = base ? 2 : 1;
  for (;;) {
    const suffix = `-${n}`;
    // 접미사를 붙인 결과가 idSafe(최대 40자)를 넘지 않도록 stem을 잘라낸다
    const trimmedStem =
      stem.slice(0, Math.max(1, ID_MAX_LEN - suffix.length)).replace(/-+$/g, "") || "tpl";
    const candidate = `${trimmedStem}${suffix}`;
    if (idSafe(candidate) && !exists(candidate)) return candidate;
    n++;
  }
}

const NEW_STEP_PLACEHOLDER =
  "이 스텝에서 할 일을 여기에 적어주세요.\n예: 경쟁 앱 3개를 조사해 기능·가격을 표로 정리하고 competitor.md 파일로 저장해줘.\n";

export function createTemplate(
  o: TplStoreOpts, name: string,
): TplResult<TemplateInfo> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) return err("이름은 1~40자로 해주세요");
  if (CONTROL_CHAR_RE.test(trimmed)) return err("이름에 줄바꿈·제어문자는 쓸 수 없어요");
  const id = templateIdFromName(o, trimmed);
  const stepId = "start";
  writeManifest(o, {
    schemaVersion: 1,
    id,
    name: trimmed,
    basedOn: null,
    createdAt: new Date().toISOString(),
    steps: [{ id: stepId, label: "자유 작업", kind: "custom", enabled: true }],
  });
  mkdirSync(join(tplDir(o, id), "steps"), { recursive: true });
  atomicWrite(stepPromptPath(o, id, stepId), NEW_STEP_PLACEHOLDER);
  const created = getTemplate(o, id);
  return created ? { ok: true, value: created } : err("템플릿을 만들었지만 다시 불러오지 못했어요");
}

export function cloneTemplate(
  o: TplStoreOpts, basedOn: string, name: string,
): TplResult<TemplateInfo> {
  const src = getTemplate(o, basedOn);
  if (!src) return err("복제할 템플릿을 찾을 수 없어요");
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) return err("이름은 1~40자로 해주세요");
  if (CONTROL_CHAR_RE.test(trimmed)) return err("이름에 줄바꿈·제어문자는 쓸 수 없어요");
  const id = templateIdFromName(o, trimmed);
  writeManifest(o, {
    schemaVersion: 1, id, name: trimmed, basedOn,
    createdAt: new Date().toISOString(),
    steps: src.steps.map(({ id: sid, label, kind }) => ({ id: sid, label, kind })),
  });
  // 기본 제공 템플릿은 별도 정본 alias까지 포함해 모든 현재 프롬프트를 사본에 고정한다.
  // 곁가지에서 복제하면 그 곁가지의 steps/를 그대로 복사한다.
  if (basedOn !== DEFAULT_TEMPLATE_ID) {
    if (builtinTemplate(basedOn, o)) {
      mkdirSync(join(tplDir(o, id), "steps"), { recursive: true });
      for (const step of src.steps) {
        const prompt = getStepPrompt(o, basedOn, step.id);
        if (prompt.ok) writeFileSync(stepPromptPath(o, id, step.id), prompt.value.body);
      }
    } else {
      const srcSteps = join(tplDir(o, basedOn), "steps");
      if (existsSync(srcSteps)) cpSync(srcSteps, join(tplDir(o, id), "steps"), { recursive: true });
    }
  }
  const created = getTemplate(o, id);
  if (!created) return err("템플릿을 만들었지만 다시 불러오지 못했어요");
  return { ok: true, value: created };
}

export function deleteTemplate(o: TplStoreOpts, id: string): TplResult<null> {
  if (builtinTemplate(id)) return err("기본 템플릿은 삭제할 수 없어요");
  if (!idSafe(id) || !readManifest(o, id)) return err("템플릿을 찾을 수 없어요");
  // idSafe 통과 후에도 방어적으로 경로 포함 확인
  const target = normalize(tplDir(o, id));
  const rootPrefix = normalize(o.pipelinesRoot) + sep;
  if (!target.startsWith(rootPrefix)) return err("잘못된 템플릿 경로예요");
  rmSync(target, { recursive: true, force: true });
  return { ok: true, value: null };
}

export function setTemplateSteps(
  o: TplStoreOpts, id: string,
  steps: Array<{ id?: string; label: string; kind: string; enabled?: boolean }>,
): TplResult<TemplateInfo> {
  if (builtinTemplate(id)) return err("기본 템플릿은 수정할 수 없어요 — 복제해서 쓰세요");
  const m = readManifest(o, id);
  if (!m) return err("템플릿을 찾을 수 없어요");
  if (!Array.isArray(steps) || steps.length < 1) return err("스텝은 1개 이상이어야 해요");
  if (steps.length > MAX_STEPS) return err(`스텝은 최대 ${MAX_STEPS}개까지예요`);
  const next: ManifestStep[] = [];
  const taken = new Set<string>();
  const newCustomIds: string[] = [];
  for (const s of steps) {
    if (typeof s !== "object" || s === null) return err("스텝 항목이 올바르지 않아요");
    const label = String(s.label ?? "").trim();
    if (label.length < 1 || label.length > MAX_LABEL_LEN)
      return err(`스텝 이름은 1~${MAX_LABEL_LEN}자로 해주세요`);
    if (CONTROL_CHAR_RE.test(label))
      return err("스텝 이름에 줄바꿈·제어문자는 쓸 수 없어요");
    const enabled = s.enabled !== false; // 기본 켜짐(하위호환)
    if (s.kind === "builtin") {
      if (typeof s.id !== "string" || !RESERVED_STEP_IDS.includes(s.id))
        return err("기본 스텝이 아닌 항목을 builtin으로 지정할 수 없어요");
      if (taken.has(s.id)) return err("같은 스텝이 두 번 들어 있어요");
      taken.add(s.id);
      next.push({ id: s.id, label, kind: "builtin", enabled });
    } else if (s.kind === "custom") {
      let sid = typeof s.id === "string" && s.id ? s.id : "";
      if (sid) {
        // 기존 커스텀 스텝 유지(순서/이름 변경) — manifest에 있던 id만 허용
        if (!m.steps.some((x) => x.id === sid && x.kind === "custom"))
          return err("알 수 없는 커스텀 스텝 id예요");
        if (taken.has(sid)) return err("같은 스텝이 두 번 들어 있어요");
      } else {
        sid = stepIdFromLabel(label, taken);
        newCustomIds.push(sid);
      }
      taken.add(sid);
      next.push({ id: sid, label, kind: "custom", enabled });
    } else {
      return err("스텝 종류가 올바르지 않아요");
    }
  }
  // 전부 꺼두면 파이프라인에 실행할 단계가 없어진다 — 최소 1개는 켜져 있어야 한다.
  if (!next.some((s) => s.enabled !== false))
    return err("스텝은 최소 1개가 켜져 있어야 해요");
  // 새 목록에 없는 기존 스텝(id)의 오버라이드/프롬프트 파일을 정리한다 — 그대로 두면 같은
  // 라벨(id)로 스텝을 재추가했을 때 옛 지시가 조용히 부활한다. custom 스텝의 프롬프트 파일과
  // builtin 스텝의 오버라이드 파일 둘 다 같은 경로(steps/<id>.md)를 쓰므로 동일하게 정리한다.
  const nextIds = new Set(next.map((s) => s.id));
  for (const old of m.steps) {
    if (!nextIds.has(old.id)) rmSync(stepPromptPath(o, id, old.id), { force: true });
  }
  writeManifest(o, { ...m, steps: next });
  // 새 커스텀 스텝에는 플레이스홀더 프롬프트를 만들어 편집 진입점을 제공한다
  mkdirSync(join(tplDir(o, id), "steps"), { recursive: true });
  for (const sid of newCustomIds) {
    const p = stepPromptPath(o, id, sid);
    if (!existsSync(p)) atomicWrite(p, NEW_STEP_PLACEHOLDER);
  }
  const updated = getTemplate(o, id);
  if (!updated) return err("스텝을 저장했지만 다시 불러오지 못했어요");
  return { ok: true, value: updated };
}

export function splitFrontmatter(content: string): { fm: string; body: string } {
  if (content.startsWith("---\n")) {
    const end = content.indexOf("\n---\n", 4);
    if (end !== -1) return { fm: content.slice(0, end + 5), body: content.slice(end + 5) };
  }
  return { fm: "", body: content };
}

// 템플릿·스텝 존재 검증 공통부. default는 readonly로 표시해 돌려준다.
function resolveStep(
  o: TplStoreOpts, id: string, stepId: string,
): TplResult<{ tpl: TemplateInfo; step: TemplateStep }> {
  const tpl = getTemplate(o, id);
  if (!tpl) return err("템플릿을 찾을 수 없어요");
  const step = tpl.steps.find((s) => s.id === stepId);
  if (!step || !idSafe(stepId)) return err("스텝을 찾을 수 없어요");
  return { ok: true, value: { tpl, step } };
}

function specialPromptPath(o: TplStoreOpts, id: string, stepId: string): string | null {
  if (
    stepId === "free-feedback" &&
    (id === FREE_FEEDBACK_TEMPLATE_ID || id === THREE_STEP_TEMPLATE_ID || id === DEVELOPMENT_TEMPLATE_ID)
  ) return builtinPromptPath(o, "free-feedback");
  if (id === DEVELOPMENT_TEMPLATE_ID && stepId === "dev-discuss")
    return join(o.repoRoot, "commands", "pipeline", "pipeline-dev-discuss.md");
  if (id === DEVELOPMENT_TEMPLATE_ID && stepId === "wireframe")
    return join(o.repoRoot, "commands", "pipeline", "pipeline-wireframe-dev.md");
  if (
    stepId === "develop" &&
    (id === THREE_STEP_TEMPLATE_ID || id === DEVELOPMENT_TEMPLATE_ID)
  ) return join(o.repoRoot, "commands", "pipeline", "pipeline-develop-simple.md");
  return null;
}

export function getStepPrompt(
  o: TplStoreOpts, id: string, stepId: string,
): TplResult<{ body: string; overridden: boolean }> {
  const r = resolveStep(o, id, stepId);
  if (!r.ok) return r;
  const { step } = r.value;
  const overridePath = stepPromptPath(o, id, stepId);
  if (id !== DEFAULT_TEMPLATE_ID && existsSync(overridePath)) {
    return {
      ok: true,
      value: {
        body: readFileSync(overridePath, "utf8"),
        overridden: step.kind === "builtin" || !!builtinTemplate(id),
      },
    };
  }
  const specialPath = specialPromptPath(o, id, step.id);
  if (specialPath) {
    if (!existsSync(specialPath)) return err(`${step.label} 프롬프트 정본이 없어요`);
    return {
      ok: true,
      value: { body: splitFrontmatter(readFileSync(specialPath, "utf8")).body, overridden: false },
    };
  }
  if (step.kind === "custom") return { ok: true, value: { body: "", overridden: false } };
  const builtinPath = builtinPromptPath(o, stepId);
  if (!existsSync(builtinPath))
    return err(`기본 스텝 프롬프트 정본이 없어요: pipeline-${stepId}.md`);
  const raw = readFileSync(builtinPath, "utf8");
  return { ok: true, value: { body: splitFrontmatter(raw).body, overridden: false } };
}

export function setStepPrompt(
  o: TplStoreOpts, id: string, stepId: string, body: string,
): TplResult<null> {
  // 9단계 default는 UI에서 폐기된 내부 하위호환용 템플릿이라 override를 만들지 않는다.
  if (id === DEFAULT_TEMPLATE_ID) return err("사용하지 않는 레거시 템플릿이에요");
  const r = resolveStep(o, id, stepId);
  if (!r.ok) return r;
  if (typeof body !== "string" || Buffer.byteLength(body) > MAX_PROMPT_BYTES)
    return err("프롬프트가 너무 길어요(64KB 제한)");
  mkdirSync(join(tplDir(o, id), "steps"), { recursive: true });
  atomicWrite(stepPromptPath(o, id, stepId), body);
  return { ok: true, value: null };
}

export function resetStepPrompt(
  o: TplStoreOpts, id: string, stepId: string,
): TplResult<null> {
  if (id === DEFAULT_TEMPLATE_ID) return err("사용하지 않는 레거시 템플릿이에요");
  const r = resolveStep(o, id, stepId);
  if (!r.ok) return r;
  if (r.value.step.kind !== "builtin" && !builtinTemplate(id))
    return err("커스텀 스텝에는 기본값이 없어요");
  rmSync(stepPromptPath(o, id, stepId), { force: true });
  return { ok: true, value: null };
}

// 시드용 스킬 합성: _CONTRACT + 스텝별 pipeline-<id>.md
export function composeSeedSkills(
  o: TplStoreOpts, id: string,
): TplResult<Array<{ filename: string; content: string }>> {
  const tpl = getTemplate(o, id);
  if (!tpl) return err("템플릿을 찾을 수 없어요");
  const contractPath = join(o.repoRoot, "commands", "pipeline", "_CONTRACT.md");
  const skeletonPath = join(o.repoRoot, "commands", "pipeline", "_GENERIC_STEP.md");
  if (!existsSync(contractPath) || !existsSync(skeletonPath))
    return err("시드 소스(_CONTRACT/_GENERIC_STEP)가 없습니다");
  const out = [{ filename: "_CONTRACT.md", content: readFileSync(contractPath, "utf8") }];
  const skeleton = readFileSync(skeletonPath, "utf8");
  for (const step of tpl.steps) {
    if (step.enabled === false) continue; // 꺼진 스텝은 스킬을 시드하지 않는다
    const filename = `pipeline-${step.id}.md`;
    const overridePath = stepPromptPath(o, id, step.id);
    const specialPath = specialPromptPath(o, id, step.id);
    if (specialPath) {
      if (!existsSync(specialPath)) return err(`${step.label} 프롬프트 정본이 없어요`);
      const raw = readFileSync(specialPath, "utf8");
      const content = existsSync(overridePath)
        ? splitFrontmatter(raw).fm + readFileSync(overridePath, "utf8")
        : raw;
      out.push({ filename, content });
    } else if (step.kind === "builtin") {
      const builtinPath = builtinPromptPath(o, step.id);
      if (!existsSync(builtinPath))
        return err(`기본 스텝 프롬프트 정본이 없어요: pipeline-${step.id}.md`);
      const raw = readFileSync(builtinPath, "utf8");
      if (id !== DEFAULT_TEMPLATE_ID && existsSync(overridePath)) {
        const { fm } = splitFrontmatter(raw);
        out.push({ filename, content: fm + readFileSync(overridePath, "utf8") });
      } else {
        out.push({ filename, content: raw });
      }
    } else {
      const instructions = existsSync(overridePath)
        ? readFileSync(overridePath, "utf8")
        : NEW_STEP_PLACEHOLDER;
      // USER_INSTRUCTIONS는 마지막에 치환한다: 사용자 본문 속 리터럴 "{{...}}"를 보존하는 게
      // 스켈레톤 자체의 플레이스홀더(STEP_ID/STEP_LABEL/USER_INSTRUCTIONS) 3종 치환보다 우선이다.
      out.push({
        filename,
        content: skeleton
          .replaceAll("{{STEP_ID}}", step.id)
          .replaceAll("{{STEP_LABEL}}", step.label)
          .replaceAll("{{USER_INSTRUCTIONS}}", instructions),
      });
    }
  }
  return { ok: true, value: out };
}
