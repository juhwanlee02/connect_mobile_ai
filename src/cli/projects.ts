import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ProjectTarget } from "../shared/protocol.js";
import { getTemplate, DEFAULT_TEMPLATE_ID } from "../shared/template-store.js";
import { hasPipeline, seedPipelineState } from "./pipeline-store.js";
import { seedPipelineAssets, type SeedTemplateOpts } from "./seed-assets.js";

export const DEFAULT_TARGET: ProjectTarget = "ios";

// 이름을 파일/URL 안전한 슬러그로. 결과가 비면 null.
// 영문/숫자만 허용: 비ASCII(한글 등)가 하나라도 있으면 조용히 바꾸지 않고 거부.
export function slugifyProjectName(raw: string): string | null {
  if (/[^\x00-\x7F]/.test(raw)) return null;
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length < 1 || s.length > 40) return null;
  return s;
}

export function projectDir(root: string, name: string): string {
  return join(root, name);
}

export function projectPublicDir(root: string, name: string): string {
  return join(root, name, "public");
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryableFsError(e: unknown): boolean {
  const code =
    e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code) : "";
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

function stripProjectMarkers(dir: string): void {
  // listProjects는 meta.json / pipeline.json 이 있는 폴더만 프로젝트로 본다.
  // OS가 폴더 전체를 못 지울 때라도 목록에서 바로 사라지게 표식만 제거한다.
  for (const f of ["meta.json", "pipeline.json", "pipeline.host.json"]) {
    try {
      rmSync(join(dir, f), { force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* 잠긴 파일은 다음 기회에 */
    }
  }
}

/**
 * 프로젝트를 projects/.trash/<name>-<ts> 로 옮긴다.
 * Windows에서는 fs.watch·미리보기·백신 등이 폴더를 잠가 rename/rmdir이
 * EBUSY/EPERM 나는 경우가 많다. 재시도 → 복사+삭제 → 목록에서만 제거 순으로 버틴다.
 */
export function moveProjectToTrash(
  root: string,
  name: string,
  opts?: {
    rename?: typeof renameSync;
    /** 테스트용: 재시도 대기 생략 */
    retryDelayMs?: number;
  },
): string {
  const rename = opts?.rename ?? renameSync;
  const delay = opts?.retryDelayMs ?? 150;
  const src = projectDir(root, name);
  const trash = join(root, ".trash");
  mkdirSync(trash, { recursive: true });
  const dest = join(trash, `${name}-${Date.now()}`);

  // watcher.close() 직후 핸들이 풀릴 틈을 준다(Windows).
  sleepSync(delay);

  for (let i = 0; i < 10; i++) {
    try {
      rename(src, dest);
      return dest;
    } catch (e) {
      if (!isRetryableFsError(e)) throw e;
      sleepSync(delay * (i + 1));
    }
  }

  // rename이 끝까지 안 되면: 휴지통에 복사한 뒤 원본 삭제 재시도
  cpSync(src, dest, { recursive: true, force: true });

  for (let i = 0; i < 10; i++) {
    try {
      rmSync(src, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      return dest;
    } catch (e) {
      if (!isRetryableFsError(e)) throw e;
      sleepSync(delay * (i + 2));
    }
  }

  // 원본 폴더가 잠겨 지워지지 않아도, 휴지통 복사본은 있으므로
  // 프로젝트 표식만 제거해 앱 목록에서는 삭제된 것처럼 보이게 한다.
  try {
    rename(src, join(trash, `.pending-${name}-${Date.now()}`));
  } catch {
    stripProjectMarkers(src);
  }
  return dest;
}

// meta.json 또는 pipeline.json을 가진 디렉터리만 프로젝트로 인정한다.
// (.trash/ 등 관리용 디렉터리를 프로젝트로 오인하지 않도록 — 스펙 §12.6)
export function listProjects(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter(
      (name) =>
        existsSync(join(root, name, "meta.json")) ||
        existsSync(join(root, name, "pipeline.json")),
    )
    .sort();
}

// 대상별 미리보기 화면 크기(논리 px). app.js의 틀 크기와 일치시킨다.
export const TARGET_VIEWPORT: Record<ProjectTarget, { w: number; h: number }> = {
  ios: { w: 390, h: 844 }, // iPhone 14 급
  android: { w: 412, h: 915 }, // Pixel 급
  web: { w: 1280, h: 800 }, // 데스크톱
};

// 대상별로 Claude에게 붙일 시스템 프롬프트(무엇을 어떻게 만들지).
export function targetSystemPrompt(target: ProjectTarget): string {
  const common =
    "결과물은 반드시 public/ 폴더 안에 정적 파일(index.html 등)로 만드세요.";
  if (target === "web") {
    return [
      "이 프로젝트는 데스크톱/반응형 '웹사이트'입니다.",
      common,
      `데스크톱 화면(약 ${TARGET_VIEWPORT.web.w}px 너비)을 기준으로 하되 모바일에서도 깨지지 않게 반응형으로 만드세요.`,
    ].join(" ");
  }
  if (target === "android") {
    return [
      "이 프로젝트는 'Android 앱(PWA)'입니다.",
      common,
      `Android 폰 화면(약 ${TARGET_VIEWPORT.android.w}x${TARGET_VIEWPORT.android.h}px, 세로)에 맞춘 모바일 우선 UI로 만들고,`,
      "Material Design 스타일(라운드, 입체감, FAB 등)과 터치 조작을 따르세요.",
      "가능하면 manifest.json과 간단한 서비스워커로 홈 화면에 설치 가능하게 하세요.",
    ].join(" ");
  }
  return [
    "이 프로젝트는 'iOS 앱(PWA)'입니다.",
    common,
    `iPhone 화면(약 ${TARGET_VIEWPORT.ios.w}x${TARGET_VIEWPORT.ios.h}px, 세로)에 맞춘 모바일 우선 UI로 만들고,`,
    "iOS Human Interface Guidelines 스타일(깔끔한 여백, 시스템 폰트 느낌, 하단 탭바 등)과 터치 조작을 따르세요.",
    "가능하면 manifest.json과 간단한 서비스워커로 홈 화면에 설치 가능하게 하세요.",
  ].join(" ");
}

function metaPath(root: string, name: string): string {
  return join(projectDir(root, name), "meta.json");
}

// 프로젝트의 대상을 읽는다. 없거나 깨졌으면 기본값(iOS).
export function readProjectTarget(root: string, name: string): ProjectTarget {
  try {
    const raw = readFileSync(metaPath(root, name), "utf8");
    const t = JSON.parse(raw)?.target;
    if (t === "ios" || t === "android" || t === "web") return t;
    if (t === "mobile") return "ios"; // 예전 값 호환
    return DEFAULT_TARGET;
  } catch {
    return DEFAULT_TARGET;
  }
}

// 모든 프로젝트의 대상 맵.
export function listProjectTargets(root: string): Record<string, ProjectTarget> {
  const out: Record<string, ProjectTarget> = {};
  for (const name of listProjects(root)) out[name] = readProjectTarget(root, name);
  return out;
}

const SEED_HTML = `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>새 프로젝트</title>
  </head>
  <body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px;">
    <h1>🚀 새 프로젝트</h1>
    <p>폰에서 명령을 보내면 이 페이지가 바뀝니다.</p>
  </body>
</html>
`;

// projects/<name>/public/ 생성 + 시작 index.html 시드(이미 있으면 보존) + 대상 기록.
export function createProject(
  root: string,
  name: string,
  target: ProjectTarget = DEFAULT_TARGET,
): void {
  const pub = projectPublicDir(root, name);
  mkdirSync(pub, { recursive: true });
  const index = join(pub, "index.html");
  if (!existsSync(index)) writeFileSync(index, SEED_HTML);
  // 대상은 최초 생성 시에만 기록(이미 있으면 보존).
  if (!existsSync(metaPath(root, name)))
    writeFileSync(metaPath(root, name), JSON.stringify({ target }));
}

// 프로젝트가 하나도 없으면 기본 프로젝트(my-app)를 시드한다.
export function ensureSeedProject(root: string): void {
  if (listProjects(root).length === 0) createProject(root, "my-app");
}

// 파이프라인 프로젝트: public/ 시드 없음, pipeline.json이 상태 원장.
// 멱등: 이미 pipeline.json이 있으면 seed를 생략해 진행 중 상태를 보존한다
// (repoRoot를 넘겨도 이 경로에서는 자산 시드를 재실행하지 않는다).
// 레거시 프로젝트(meta.json은 있는데 pipeline !== true)와 이름이 충돌하면
// 잡종 상태를 만들지 않도록 생성을 거부하고 false를 반환한다.
// repoRoot가 주어지면 신규 생성 시에만 리포의 스킬/템플릿/설정을 함께 시드한다
// (생략 시 기존 계약대로 자산 시드 없이 pipeline.json만 생성).
export function createPipelineProject(
  root: string,
  name: string,
  repoRoot?: string,
  tpl?: SeedTemplateOpts,
): boolean {
  const dir = projectDir(root, name);
  if (hasPipeline(dir)) return true; // 이미 파이프라인 프로젝트 — 진행 상태 보존
  const mp = metaPath(root, name);
  if (existsSync(mp)) {
    try {
      const meta = JSON.parse(readFileSync(mp, "utf8"));
      if (meta?.pipeline !== true) return false; // 레거시 프로젝트와 이름 충돌
    } catch {
      return false;
    }
  }
  mkdirSync(dir, { recursive: true });
  if (!existsSync(mp)) writeFileSync(mp, JSON.stringify({ pipeline: true }));
  let steps;
  let templateId = DEFAULT_TEMPLATE_ID;
  if (!repoRoot) {
    console.warn(`[pipeline] repoRoot 미지정 — 스킬/템플릿 시드를 건너뜁니다: ${name}`);
  } else {
    // 시드가 상태보다 먼저: 합성 실패 시 throw해 잡종 프로젝트 생성을 막는다.
    seedPipelineAssets(repoRoot, dir, tpl);
    if (tpl) {
      const info = getTemplate({ repoRoot, pipelinesRoot: tpl.pipelinesRoot }, tpl.template);
      if (info) {
        templateId = info.id;
        // 꺼둔 스텝은 프로젝트에 넣지 않는다(비활성 = 그 단계 자체를 건너뜀).
        steps = info.steps
          .filter((s) => s.enabled !== false)
          .map(({ id, label, kind, timeoutMin }) => ({ id, label, kind, timeoutMin }));
      }
    }
  }
  seedPipelineState(dir, name, new Date().toISOString(), steps, templateId);
  return true;
}

export function isPipelineProject(root: string, name: string): boolean {
  try {
    return JSON.parse(readFileSync(metaPath(root, name), "utf8"))?.pipeline === true;
  } catch {
    return false;
  }
}

export interface ProjectMeta {
  target?: ProjectTarget;
  pipeline?: boolean;
  archived?: boolean;
}

// meta.json을 읽는다. 없거나 깨졌으면 빈 객체.
export function readProjectMeta(root: string, name: string): ProjectMeta {
  try {
    const o = JSON.parse(readFileSync(metaPath(root, name), "utf8"));
    return typeof o === "object" && o !== null ? o : {};
  } catch {
    return {};
  }
}

// 기존 meta 필드를 보존하며 patch를 병합해 쓴다.
export function writeProjectMeta(root: string, name: string, patch: Partial<ProjectMeta>): void {
  writeFileSync(metaPath(root, name), JSON.stringify({ ...readProjectMeta(root, name), ...patch }));
}
