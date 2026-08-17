import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  IdeaLibraryItem,
  PreferencesMsg,
  PreferencesPayload,
  PrefNeverAgainItem,
  PrefTaggedItem,
} from "../shared/protocol.js";

function tagged(text: string, project = "기본"): PrefTaggedItem {
  return {
    id: `tg-${text.slice(0, 24)}`,
    text,
    project,
    date: "",
  };
}

const DEFAULT_PREFERENCES = {
  version: 1,
  updated_at: "",
  explicit: {
    liked_categories: [],
    disliked_categories: [],
    liked_mechanics: [
      tagged("다른 국가에서 검증된 핵심 기능의 문화권 현지화"),
      tagged("반복 사용을 만드는 명확한 리텐션 루프"),
    ],
    disliked_mechanics: [
      tagged("일회성 사용 후 다시 열 이유가 없는 기능"),
    ],
    allowed_cloud_exceptions: [],
    preferred_targets: [],
    preferred_markets: [],
    preferred_ui: [tagged("참고 앱과 구분되는 예쁘고 현지 문화에 맞는 UI")],
    preferred_content_depth: [
      tagged("첫 실행부터 시드 콘텐츠가 충분히 채워진 화면"),
      tagged("하루 써도 고갈되지 않는 초기 콘텐츠 풀"),
    ],
    preferred_retention: [
      tagged("트리거→행동→보상→축적이 홈에서 보이는 리텐션 루프"),
      tagged("오늘 진행 상태와 연속 기록(스트릭/누적)이 드러나는 UX"),
    ],
    liked_sparks: [] as PrefTaggedItem[],
    // 카테고리(장르)별로 사용자가 고른 와이어프레임/정보구조. 개발 시 같은 category에 재사용.
    ui_wireframe_by_category: [] as Array<{
      id: string;
      category: string;
      pattern: string;
      nav: string;
      reason: string;
      project: string;
      date: string;
    }>,
    disliked_wireframe_patterns: [] as PrefTaggedItem[],
    disliked_app_patterns: [
      tagged("빈 리스트·플레이스홀더만 있는 홈"),
      tagged("가짜 데이터 몇 개로 끝내는 데모 앱"),
      tagged("다시 열 이유가 없는 일회성 기능만 있는 앱"),
      tagged("리텐션 루프 없이 화면만 나열한 앱"),
    ],
  },
  never_again: [] as Array<{
    id: string;
    pattern: string;
    reason: string;
    source_project: string;
    date: string;
    raw_feedback: string;
  }>,
  inferred: [],
  decisions: [],
};

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

function asText(value: unknown, max: number): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
  if (typeof value === "string") return value.slice(0, max);
  return "";
}

function operatingCostText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return `월 ${value}원`;
  if (value && typeof value === "object") {
    const o = value as { monthly?: unknown; grade?: unknown; optional_service?: unknown };
    const monthly =
      typeof o.monthly === "number" && Number.isFinite(o.monthly) ? `월 ${o.monthly}원` : "";
    const grade = asText(o.grade, 8);
    const opt = asText(o.optional_service, 80);
    const parts = [monthly || null, grade && `등급 ${grade}`, opt].filter(Boolean);
    if (parts.length) return parts.join(" · ").slice(0, 120);
  }
  const text = asText(value, 80);
  return text || "월 0원";
}

function onDeviceAiText(value: unknown): string {
  if (typeof value === "boolean") return value ? "있음" : "없음";
  const plain = asText(value, 200);
  if (plain) return plain;
  if (value && typeof value === "object") {
    const o = value as { required?: unknown; approach?: unknown; verified?: unknown };
    if (o.required === false) return "불필요";
    const approach = asText(o.approach, 160);
    if (approach) return approach;
    if (o.required === true) return "온디바이스 AI 필요";
  }
  return "";
}

function retentionLoopText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((x) => asText(x, 80))
      .filter(Boolean)
      .join(" · ")
      .slice(0, 240);
  }
  return asText(value, 240);
}

function sourceAppText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((x) => asText(x, 80))
      .filter(Boolean)
      .join(" · ")
      .slice(0, 160);
  }
  if (value === null || value === undefined) return "";
  return asText(value, 160);
}

function inspirationBasisText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((x) => asText(x, 80))
      .filter(Boolean)
      .join(" · ")
      .slice(0, 240);
  }
  return asText(value, 240);
}

/** 옛 항목에 detail이 없으면 메타 필드로 한 단락을 만든다. */
function synthesizeDetail(x: Record<string, unknown>): string {
  const explicit = asText(x.detail, 2000);
  if (explicit) return explicit;
  const parts = [
    sourceAppText(x.source_app) && `참고 앱: ${sourceAppText(x.source_app)}`,
    inspirationBasisText(x.inspiration_basis) &&
      `참고한 점: ${inspirationBasisText(x.inspiration_basis)}`,
    asText(x.target_user, 160) && `타깃: ${asText(x.target_user, 160)}`,
    asText(x.on_device_ai, 200) && `온디바이스 AI: ${asText(x.on_device_ai, 200)}`,
    asText(x.retention_loop, 240) && `리텐션: ${asText(x.retention_loop, 240)}`,
    asText(x.monetization, 200) && `수익화: ${asText(x.monetization, 200)}`,
    `운영비: ${operatingCostText(x.operating_cost)}`,
  ].filter(Boolean);
  return parts.join("\n");
}

export function ensureIdeaMemory(projectsRoot: string): void {
  mkdirSync(projectsRoot, { recursive: true });
  const ideas = join(projectsRoot, "ideas-index.json");
  if (!existsSync(ideas)) {
    writeFileSync(ideas, "[]\n");
  } else {
    // 이미 개발에 쓴(adopted) 항목은 보관함에서 제거 — 미사용만 남긴다.
    try {
      const raw = JSON.parse(readFileSync(ideas, "utf8"));
      if (Array.isArray(raw)) {
        const open = raw.filter((x) => x && typeof x === "object" && x.adopted == null);
        if (open.length !== raw.length) writeJsonAtomic(ideas, open);
      }
    } catch { /* 손상 파일은 덮어쓰지 않음 */ }
  }
  const preferences = join(projectsRoot, "user-preferences.json");
  if (!existsSync(preferences)) {
    writeJsonAtomic(
      preferences,
      {
        ...DEFAULT_PREFERENCES,
        updated_at: new Date().toISOString().slice(0, 10),
      },
    );
  } else {
    // 과거 기본으로 강제하던 0원·온디바이스 정책을 제거한다. 이제 이 정책은 프로젝트의
    // "운영비 0원 · 온디바이스" 보조 스킬을 선택했을 때만 적용된다.
    try {
      const current = JSON.parse(readFileSync(preferences, "utf8"));
      const explicit = current?.explicit;
      if (explicit && typeof explicit === "object") {
        const oldPolicyTexts = new Set([
          "온디바이스 AI로 신기함을 주는 기능",
          "유료 API",
          "Firebase·Supabase·외부 DB",
          "랭킹 외 용도의 Firebase·Supabase·외부 DB",
          "별도 서버와 지속적 클라우드 비용",
        ]);
        const withoutOldPolicy = (items: unknown) =>
          Array.isArray(items)
            ? items.filter((x: unknown) => {
              const text = typeof x === "string"
                ? x
                : x && typeof x === "object" && "text" in x
                  ? String((x as { text?: unknown }).text ?? "")
                  : "";
              return !oldPolicyTexts.has(text);
            })
            : [];
        explicit.liked_mechanics = withoutOldPolicy(explicit.liked_mechanics);
        explicit.disliked_mechanics = withoutOldPolicy(explicit.disliked_mechanics);
        explicit.allowed_cloud_exceptions = [];
        if (explicit.required_operating_cost === 0) delete explicit.required_operating_cost;
        // 필드가 없을 때만 기본값을 채운다. 이미 배열이 있으면 사용자가 지운 항목을
        // 다시 강제 삽입하지 않는다(폰 취향 편집과 충돌 방지).
        const defaults = DEFAULT_PREFERENCES.explicit;
        for (const key of [
          "preferred_content_depth",
          "preferred_retention",
          "disliked_app_patterns",
          "liked_sparks",
          "ui_wireframe_by_category",
          "disliked_wireframe_patterns",
        ] as const) {
          if (!Array.isArray(explicit[key])) {
            const fallback = (defaults as Record<string, unknown>)[key];
            explicit[key] = Array.isArray(fallback) ? [...fallback] : [];
          }
        }
        if (!Array.isArray(current.never_again)) current.never_again = [];
        // 옛 project_notes → wants(출처 프로젝트 표시)로 흡수 후 제거
        if (Array.isArray(current.project_notes) && current.project_notes.length > 0) {
          const depth = Array.isArray(explicit.preferred_content_depth)
            ? explicit.preferred_content_depth
            : [];
          for (const n of current.project_notes) {
            if (!n || typeof n !== "object") continue;
            const note = asText((n as { note?: unknown }).note, 160).trim();
            const project = asText((n as { project?: unknown }).project, 80).trim() || "unknown";
            if (!note) continue;
            depth.push({
              id: asText((n as { id?: unknown }).id, 80) || `mig-${Date.now()}`,
              text: note,
              project,
              date: asText((n as { date?: unknown }).date, 32),
            });
          }
          explicit.preferred_content_depth = depth;
        }
        current.project_notes = [];
        if (!Array.isArray(current.decisions)) current.decisions = [];
        if (!Array.isArray(current.inferred)) current.inferred = [];
        writeJsonAtomic(preferences, current);
      }
    } catch { /* 사용자가 편집 중이거나 손상된 파일은 덮어쓰지 않는다 */ }
  }
}

export function readIdeaLibrary(projectsRoot: string, limit = 80): IdeaLibraryItem[] {
  try {
    const raw = JSON.parse(readFileSync(join(projectsRoot, "ideas-index.json"), "utf8"));
    if (!Array.isArray(raw)) return [];
    // 보관함에는 미사용(아직 개발 안 한) 아이디어만. 개발되면 claim 시 삭제한다.
    return raw
      .map((x) => (x && typeof x === "object" ? mapRawIdea(x as Record<string, unknown>) : null))
      .filter((x): x is IdeaLibraryItem => !!x && x.adopted === null)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

/** 슬러그로 공용 아이디어 1건 조회(미사용만 — 보관함 기준). */
export function findIdeaInLibrary(projectsRoot: string, slug: string): IdeaLibraryItem | null {
  return readIdeaLibrary(projectsRoot, 10000).find((x) => x.slug === slug) ?? null;
}

function cleanStringList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim().slice(0, maxLen);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanNeverAgain(value: unknown): PrefNeverAgainItem[] {
  if (!Array.isArray(value)) return [];
  const out: PrefNeverAgainItem[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const pattern = asText((item as { pattern?: unknown }).pattern, 80).trim();
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    const idRaw = asText((item as { id?: unknown }).id, 80).trim();
    out.push({
      id: idRaw || `na-${Date.now()}-${out.length}`,
      pattern,
      reason: asText((item as { reason?: unknown }).reason, 160).trim(),
      date: asText((item as { date?: unknown }).date, 32).trim()
        || new Date().toISOString().slice(0, 10),
      sourceProject: asText(
        (item as { sourceProject?: unknown; source_project?: unknown }).sourceProject
          ?? (item as { source_project?: unknown }).source_project,
        80,
      ).trim(),
      rawFeedback: asText(
        (item as { rawFeedback?: unknown; raw_feedback?: unknown }).rawFeedback
          ?? (item as { raw_feedback?: unknown }).raw_feedback,
        120,
      ).trim(),
    });
    if (out.length >= 80) break;
  }
  return out;
}

function cleanTaggedList(value: unknown, maxItems: number, maxLen: number): PrefTaggedItem[] {
  if (!Array.isArray(value)) return [];
  const out: PrefTaggedItem[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    let text = "";
    let project = "";
    let date = "";
    let id = "";
    if (typeof item === "string") {
      text = item.trim().slice(0, maxLen);
    } else if (item && typeof item === "object") {
      text = asText((item as { text?: unknown; note?: unknown; pattern?: unknown }).text
        ?? (item as { note?: unknown }).note
        ?? (item as { pattern?: unknown }).pattern, maxLen).trim();
      project = asText(
        (item as { project?: unknown; source_project?: unknown; sourceProject?: unknown }).project
          ?? (item as { source_project?: unknown }).source_project
          ?? (item as { sourceProject?: unknown }).sourceProject,
        80,
      ).trim();
      date = asText((item as { date?: unknown }).date, 32).trim();
      id = asText((item as { id?: unknown }).id, 80).trim();
    }
    if (!text) continue;
    const key = `${project}\n${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: id || `tg-${out.length}-${Date.now().toString(36)}`,
      text,
      project,
      date,
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

function wireframePrefsAsTagged(value: unknown): PrefTaggedItem[] {
  if (!Array.isArray(value)) return [];
  const out: PrefTaggedItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const category = asText(o.category, 40);
    const pattern = asText(o.pattern, 80);
    if (!category || !pattern) continue;
    const nav = asText(o.nav, 60);
    out.push({
      id: asText(o.id, 80) || `uw-${out.length}`,
      text: `[${category} UI] ${pattern}${nav ? ` · ${nav}` : ""}`.slice(0, 120),
      project: asText(o.project ?? o.source_project, 80),
      date: asText(o.date, 32),
    });
  }
  return out;
}

function wantsFromExplicit(explicit: Record<string, unknown>): PrefTaggedItem[] {
  return cleanTaggedList([
    ...(Array.isArray(explicit.liked_sparks) ? explicit.liked_sparks : []),
    ...wireframePrefsAsTagged(explicit.ui_wireframe_by_category),
    ...(Array.isArray(explicit.preferred_content_depth) ? explicit.preferred_content_depth : []),
    ...(Array.isArray(explicit.preferred_retention) ? explicit.preferred_retention : []),
    ...(Array.isArray(explicit.preferred_ui) ? explicit.preferred_ui : []),
    ...(Array.isArray(explicit.liked_mechanics) ? explicit.liked_mechanics : []),
  ], 80, 120);
}

function mapRawIdea(x: Record<string, unknown>): IdeaLibraryItem | null {
  if (typeof x.slug !== "string" || typeof x.one_liner !== "string") return null;
  if (!(x.adopted === null || typeof x.adopted === "string" || x.adopted === undefined)) return null;
  const item: IdeaLibraryItem = {
    slug: x.slug.slice(0, 80),
    direction: asText(x.direction, 40),
    category: asText(x.category, 80),
    oneLiner: x.one_liner.slice(0, 240),
    detail: synthesizeDetail(x),
    sourceApp: sourceAppText(x.source_app),
    inspirationBasis: inspirationBasisText(x.inspiration_basis),
    targetUser: asText(x.target_user, 160),
    onDeviceAi: onDeviceAiText(x.on_device_ai),
    retentionLoop: retentionLoopText(x.retention_loop),
    operatingCost: operatingCostText(x.operating_cost),
    monetization: asText(x.monetization, 200),
    adopted: typeof x.adopted === "string" ? x.adopted : null,
  };
  if (x.kept === true) item.kept = true;
  return item;
}

/** PROPOSED_IDEAS.json — 배열 또는 { candidates: [] } 둘 다 허용 */
function parseProposedFile(raw: unknown): {
  items: Record<string, unknown>[];
  wrap: Record<string, unknown> | null;
} {
  if (Array.isArray(raw)) {
    return {
      items: raw.filter((x): x is Record<string, unknown> => !!x && typeof x === "object"),
      wrap: null,
    };
  }
  if (raw && typeof raw === "object") {
    const wrap = raw as Record<string, unknown>;
    const candidates = wrap.candidates;
    if (Array.isArray(candidates)) {
      return {
        items: candidates.filter((x): x is Record<string, unknown> => !!x && typeof x === "object"),
        wrap,
      };
    }
  }
  return { items: [], wrap: null };
}

function writeProposedFile(
  path: string,
  items: Record<string, unknown>[],
  wrap: Record<string, unknown> | null,
): void {
  if (wrap) {
    writeJsonAtomic(path, { ...wrap, candidates: items });
  } else {
    writeJsonAtomic(path, items);
  }
}

/** 연구소 회차 후보(아직 공용 DB에 안 넣은 것). PROPOSED_IDEAS.json */
export function readProposedIdeas(projectDir: string): IdeaLibraryItem[] {
  try {
    const raw = JSON.parse(readFileSync(join(projectDir, "PROPOSED_IDEAS.json"), "utf8"));
    const { items } = parseProposedFile(raw);
    return items
      .map((x) => mapRawIdea(x))
      .filter((x): x is IdeaLibraryItem => !!x);
  } catch {
    return [];
  }
}

function appendLikedSpark(
  projectsRoot: string,
  spark: string,
  project: string,
  decision: Record<string, unknown>,
): void {
  const path = join(projectsRoot, "user-preferences.json");
  ensureIdeaMemory(projectsRoot);
  try {
    const current = JSON.parse(readFileSync(path, "utf8"));
    const explicit = current?.explicit && typeof current.explicit === "object" ? current.explicit : {};
    const entry = {
      id: `spark-${Date.now()}`,
      text: spark.slice(0, 120),
      project: project.slice(0, 80) || "idea-lab",
      date: new Date().toISOString().slice(0, 10),
    };
    explicit.liked_sparks = cleanTaggedList(
      [entry, ...(Array.isArray(explicit.liked_sparks) ? explicit.liked_sparks : [])],
      40,
      120,
    );
    const decisions = Array.isArray(current.decisions) ? current.decisions : [];
    decisions.push(decision);
    writeJsonAtomic(path, {
      ...current,
      updated_at: new Date().toISOString().slice(0, 10),
      explicit,
      decisions,
      project_notes: [],
    });
  } catch { /* ignore */ }
}

/**
 * 사용자가 고른 제안만 공용 ideas-index에 넣고, 칭찬 피드백을 liked_sparks에 누적한다.
 */
export function keepProposedIdea(
  projectsRoot: string,
  projectDir: string,
  slug: string,
  feedback = "",
): { ok: true; idea: IdeaLibraryItem } | { ok: false; error: string } {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(slug)) {
    return { ok: false, error: "아이디어 식별자가 올바르지 않아요" };
  }
  const proposedPath = join(projectDir, "PROPOSED_IDEAS.json");
  const indexPath = join(projectsRoot, "ideas-index.json");
  try {
    const proposedRaw = JSON.parse(readFileSync(proposedPath, "utf8"));
    const { items: proposed, wrap } = parseProposedFile(proposedRaw);
    if (proposed.length === 0) {
      return { ok: false, error: "제안 목록이 없어요. 먼저 아이디어 연구소를 돌려 주세요" };
    }
    const raw = proposed.find((x) => x?.slug === slug);
    if (!raw) return { ok: false, error: "이번 후보 목록에서 해당 아이디어를 찾지 못했어요" };

    ensureIdeaMemory(projectsRoot);
    let ideas: unknown[] = [];
    try {
      const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
      if (Array.isArray(parsed)) ideas = parsed;
    } catch { ideas = []; }

    const exists = ideas.some((x) => (x as { slug?: string })?.slug === slug);
    const entry = {
      ...raw,
      adopted: null,
      kept_at: new Date().toISOString().slice(0, 10),
      keep_feedback: asText(feedback, 120),
    };
    if (!exists) {
      ideas.push(entry);
      writeJsonAtomic(indexPath, ideas);
    }

    const mapped = mapRawIdea(entry as Record<string, unknown>);
    if (!mapped) return { ok: false, error: "아이디어 형식이 올바르지 않아요" };

    const sourceProject = basename(projectDir).slice(0, 80) || "idea-lab";
    const praise = asText(feedback, 120).trim();
    // 칭찬이 있으면 그걸 우선(구조적 요약). 없으면 one_liner만 — 표면적 자동문구 금지.
    const spark = (praise || mapped.oneLiner).slice(0, 120);
    appendLikedSpark(projectsRoot, spark, sourceProject, {
      date: new Date().toISOString().slice(0, 10),
      project: sourceProject,
      stage: "ideation",
      type: "keep_praise",
      slug,
      request: praise || mapped.oneLiner,
      preference_update: [`liked_sparks += [@${sourceProject}] ${spark}`],
    });

    // 제안 목록에 kept 표시(UI 구분용) — 원본이 {candidates}면 형식 유지
    const nextProposed = proposed.map((x) =>
      x?.slug === slug ? { ...x, kept: true, keep_feedback: praise || x.keep_feedback } : x,
    );
    writeProposedFile(proposedPath, nextProposed, wrap);

    return { ok: true, idea: mapped };
  } catch {
    return { ok: false, error: "선택한 아이디어를 저장하지 못했어요" };
  }
}

export function readPreferencesView(projectsRoot: string): PreferencesMsg {
  ensureIdeaMemory(projectsRoot);
  try {
    const raw = JSON.parse(readFileSync(join(projectsRoot, "user-preferences.json"), "utf8"));
    const explicit = raw?.explicit && typeof raw.explicit === "object" ? raw.explicit : {};
    return {
      type: "preferences",
      updatedAt: asText(raw?.updated_at, 32) || new Date().toISOString().slice(0, 10),
      neverAgain: cleanNeverAgain(raw?.never_again),
      dislikedPatterns: cleanTaggedList([
        ...(Array.isArray(explicit.disliked_app_patterns) ? explicit.disliked_app_patterns : []),
        ...(Array.isArray(explicit.disliked_wireframe_patterns)
          ? explicit.disliked_wireframe_patterns
          : []),
      ], 60, 120),
      wants: wantsFromExplicit(explicit),
    };
  } catch {
    return {
      type: "preferences",
      updatedAt: new Date().toISOString().slice(0, 10),
      neverAgain: [],
      dislikedPatterns: [],
      wants: [],
    };
  }
}

export function writePreferencesView(
  projectsRoot: string,
  payload: PreferencesPayload,
): { ok: true; value: PreferencesMsg } | { ok: false; error: string } {
  ensureIdeaMemory(projectsRoot);
  const path = join(projectsRoot, "user-preferences.json");
  try {
    let current: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed === "object") current = parsed;
    } catch { /* 손상 시 아래에서 재구성 */ }

    const explicit = (
      current.explicit && typeof current.explicit === "object"
        ? { ...(current.explicit as Record<string, unknown>) }
        : { ...DEFAULT_PREFERENCES.explicit }
    ) as Record<string, unknown>;

    const neverAgain = cleanNeverAgain(payload.neverAgain);
    const dislikedPatterns = cleanTaggedList(payload.dislikedPatterns, 60, 120);
    const wants = cleanTaggedList(payload.wants, 60, 120);

    explicit.disliked_app_patterns = dislikedPatterns;
    // 폰 편집본을 원함 목록의 정본으로 두고, 하위 배열은 비워 중복을 막는다.
    // 단, 카테고리별 와이어프레임 이력은 파이프라인이 쌓는 정본이므로 보존한다.
    const keepWireframeByCategory = Array.isArray(explicit.ui_wireframe_by_category)
      ? explicit.ui_wireframe_by_category
      : [];
    const keepDislikedWireframe = Array.isArray(explicit.disliked_wireframe_patterns)
      ? explicit.disliked_wireframe_patterns
      : [];
    explicit.preferred_content_depth = wants;
    explicit.preferred_retention = [];
    explicit.preferred_ui = [];
    explicit.liked_mechanics = [];
    explicit.liked_sparks = [];
    explicit.ui_wireframe_by_category = keepWireframeByCategory;
    explicit.disliked_wireframe_patterns = keepDislikedWireframe;

    const next = {
      ...current,
      version: 1,
      updated_at: new Date().toISOString().slice(0, 10),
      explicit,
      never_again: neverAgain.map((x) => ({
        id: x.id,
        pattern: x.pattern,
        reason: x.reason,
        source_project: x.sourceProject,
        date: x.date,
        raw_feedback: x.rawFeedback,
      })),
      project_notes: [],
      inferred: Array.isArray(current.inferred) ? current.inferred : [],
      decisions: Array.isArray(current.decisions) ? current.decisions : [],
    };
    writeJsonAtomic(path, next);
    return { ok: true, value: readPreferencesView(projectsRoot) };
  } catch {
    return { ok: false, error: "취향 설정을 저장하지 못했어요" };
  }
}

export function deleteIdeaFromLibrary(
  projectsRoot: string,
  slug: string,
): { ok: true } | { ok: false; error: string } {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(slug)) {
    return { ok: false, error: "아이디어 식별자가 올바르지 않아요" };
  }
  const path = join(projectsRoot, "ideas-index.json");
  try {
    const ideas = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(ideas)) return { ok: false, error: "공용 아이디어 DB가 손상됐어요" };
    const idx = ideas.findIndex((x) => x?.slug === slug);
    if (idx < 0) return { ok: false, error: "삭제할 아이디어를 찾을 수 없어요" };
    if (ideas[idx]?.adopted != null) {
      return { ok: false, error: "이미 개발 중인 아이디어는 삭제할 수 없어요" };
    }
    ideas.splice(idx, 1);
    writeJsonAtomic(path, ideas);
    return { ok: true };
  } catch {
    return { ok: false, error: "아이디어를 삭제하지 못했어요" };
  }
}

export function claimIdeaForProject(
  projectsRoot: string,
  projectDir: string,
  slug: string,
  project: string,
): { ok: true } | { ok: false; error: string } {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(slug)) {
    return { ok: false, error: "아이디어 식별자가 올바르지 않아요" };
  }
  const path = join(projectsRoot, "ideas-index.json");
  try {
    const ideas = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(ideas)) return { ok: false, error: "공용 아이디어 DB가 손상됐어요" };
    const idx = ideas.findIndex((x) => x?.slug === slug);
    if (idx < 0) return { ok: false, error: "선택한 아이디어를 찾을 수 없어요" };
    const idea = ideas[idx];
    if (idea.adopted != null) {
      return { ok: false, error: "이미 개발에 쓴 아이디어예요" };
    }
    const selected = {
      ...idea,
      adopted: project,
      selected_at: new Date().toISOString(),
    };
    mkdirSync(projectDir, { recursive: true });
    writeJsonAtomic(join(projectDir, "SELECTED_IDEA.json"), selected);
    // 개발 시작하면 보관함에서 제거(미사용만 남김)
    ideas.splice(idx, 1);
    writeJsonAtomic(path, ideas);
    return { ok: true };
  } catch {
    return { ok: false, error: "공용 아이디어를 개발 프로젝트로 가져오지 못했어요" };
  }
}

/** 보관함 아이디어 없이 대화로 시작하는 개발 프로젝트의 입력 골격을 만든다. */
export function seedDirectIdeaForProject(
  projectDir: string,
  project: string,
): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(projectDir, { recursive: true });
    writeJsonAtomic(join(projectDir, "SELECTED_IDEA.json"), {
      slug: `direct-${project}`,
      one_liner: "사용자와 대화로 정할 새 프로젝트",
      category: "other",
      direct_input: true,
      adopted: project,
      selected_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "대화형 개발 프로젝트 입력을 준비하지 못했어요" };
  }
}
