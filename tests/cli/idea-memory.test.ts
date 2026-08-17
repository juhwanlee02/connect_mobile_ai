import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimIdeaForProject,
  deleteIdeaFromLibrary,
  ensureIdeaMemory,
  keepProposedIdea,
  readIdeaLibrary,
  readPreferencesView,
  readProposedIdeas,
  seedDirectIdeaForProject,
  writePreferencesView,
} from "../../src/cli/idea-memory.js";

function texts(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((x) => (typeof x === "string" ? x : (x as { text?: string })?.text || ""));
}

describe("idea memory", () => {
  it("공용 아이디어와 선호도 파일을 로컬에 초기화한다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-memory-"));
    ensureIdeaMemory(root);
    expect(JSON.parse(readFileSync(join(root, "ideas-index.json"), "utf8"))).toEqual([]);
    const prefs = JSON.parse(readFileSync(join(root, "user-preferences.json"), "utf8"));
    expect(prefs.explicit.required_operating_cost).toBeUndefined();
    expect(texts(prefs.explicit.liked_mechanics)).not.toContain("온디바이스 AI로 신기함을 주는 기능");
    expect(prefs.explicit.allowed_cloud_exceptions).toEqual([]);
    expect(prefs.explicit.preferred_content_depth.length).toBeGreaterThan(0);
    expect(prefs.explicit.preferred_retention.length).toBeGreaterThan(0);
    expect(texts(prefs.explicit.disliked_app_patterns)).toContain("빈 리스트·플레이스홀더만 있는 홈");
    expect(Array.isArray(prefs.never_again)).toBe(true);
  });

  it("옛 선호도 파일에 콘텐츠·리텐션·never_again 필드를 보강한다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-prefs-migrate-"));
    writeFileSync(join(root, "ideas-index.json"), "[]\n");
    writeFileSync(join(root, "user-preferences.json"), JSON.stringify({
      version: 1,
      updated_at: "2026-01-01",
      explicit: {
        liked_mechanics: [],
        disliked_mechanics: ["Firebase·Supabase·외부 DB"],
        preferred_ui: [],
      },
      inferred: [],
      decisions: [],
    }));
    ensureIdeaMemory(root);
    const prefs = JSON.parse(readFileSync(join(root, "user-preferences.json"), "utf8"));
    expect(texts(prefs.explicit.disliked_app_patterns)).toContain("리텐션 루프 없이 화면만 나열한 앱");
    expect(texts(prefs.explicit.preferred_retention)[0]).toContain("리텐션 루프");
    expect(prefs.never_again).toEqual([]);
    expect(prefs.project_notes).toEqual([]);
  });

  it("옛 project_notes를 출처 달린 원함으로 흡수한다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-prefs-notes-"));
    writeFileSync(join(root, "ideas-index.json"), "[]\n");
    writeFileSync(join(root, "user-preferences.json"), JSON.stringify({
      version: 1,
      updated_at: "2026-01-01",
      explicit: {
        preferred_content_depth: [],
        preferred_retention: [],
        preferred_ui: [],
        disliked_app_patterns: [],
        liked_mechanics: [],
      },
      project_notes: [{
        id: "pn-1",
        project: "dragon-quest",
        note: "용·퀘스트 넣어줘",
        date: "2026-07-19",
        stage: "develop",
      }],
      inferred: [],
      decisions: [],
    }));
    ensureIdeaMemory(root);
    const view = readPreferencesView(root);
    expect(view.wants.some((w) => w.project === "dragon-quest" && w.text.includes("퀘스트"))).toBe(true);
    const file = JSON.parse(readFileSync(join(root, "user-preferences.json"), "utf8"));
    expect(file.project_notes).toEqual([]);
  });

  it("이미 있는 취향 배열은 기본값으로 다시 채우지 않는다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-prefs-keep-"));
    writeFileSync(join(root, "ideas-index.json"), "[]\n");
    writeFileSync(join(root, "user-preferences.json"), JSON.stringify({
      version: 1,
      updated_at: "2026-01-01",
      explicit: {
        disliked_app_patterns: ["사용자만의 금지"],
        preferred_content_depth: [],
        preferred_retention: [],
        preferred_ui: [],
        disliked_mechanics: [],
      },
      never_again: [],
      inferred: [],
      decisions: [],
    }));
    ensureIdeaMemory(root);
    const prefs = JSON.parse(readFileSync(join(root, "user-preferences.json"), "utf8"));
    expect(texts(prefs.explicit.disliked_app_patterns)).toEqual(["사용자만의 금지"]);
  });

  it("보관함에는 미사용 아이디어만 보여준다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-library-"));
    ensureIdeaMemory(root);
    writeFileSync(join(root, "ideas-index.json"), JSON.stringify([
      { slug: "old", direction: "US→KR", category: "도구", one_liner: "채택됨", detail: "채택 상세", adopted: "app" },
      { slug: "legacy", direction: "US→KR", category: "도구", one_liner: "옛 아이디어", adopted: null,
        source_app: "LegacyApp", target_user: "직장인", on_device_ai: "없음",
        retention_loop: "매일 체크", monetization: "광고", operating_cost: 0 },
      { slug: "new", direction: "JP→BR", category: "게임", one_liner: "새 아이디어",
        detail: "상세한 설명입니다. 온디바이스와 리텐션이 핵심입니다.",
        adopted: null, source_app: "Source", target_user: "User", on_device_ai: "없음",
        retention_loop: "매일 반복", operating_cost: 0, monetization: "무료" },
    ]));
    const lib = readIdeaLibrary(root);
    expect(lib.map((x) => x.slug)).toEqual(["new", "legacy"]);
    expect(lib.every((x) => x.adopted === null)).toBe(true);
  });

  it("이미 adopted된 항목은 기동 시 보관함에서 정리한다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-purge-"));
    writeFileSync(join(root, "ideas-index.json"), JSON.stringify([
      { slug: "used", one_liner: "쓴 것", adopted: "app" },
      { slug: "free", one_liner: "남은 것", adopted: null },
    ]));
    ensureIdeaMemory(root);
    const left = JSON.parse(readFileSync(join(root, "ideas-index.json"), "utf8"));
    expect(left.map((x: { slug: string }) => x.slug)).toEqual(["free"]);
  });

  it("미채택 아이디어를 보관함에서 삭제한다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-delete-"));
    ensureIdeaMemory(root);
    writeFileSync(join(root, "ideas-index.json"), JSON.stringify([
      { slug: "keep", direction: "JP→BR", category: "게임", one_liner: "유지", detail: "유지 상세", adopted: null },
      { slug: "drop", direction: "US→KR", category: "도구", one_liner: "삭제", detail: "삭제 상세", adopted: null },
      { slug: "used", direction: "DE→TH", category: "소셜", one_liner: "사용중", detail: "사용 상세", adopted: "app" },
    ]));
    expect(deleteIdeaFromLibrary(root, "drop")).toEqual({ ok: true });
    expect(deleteIdeaFromLibrary(root, "used")).toEqual({
      ok: false,
      error: "이미 개발 중인 아이디어는 삭제할 수 없어요",
    });
    const left = JSON.parse(readFileSync(join(root, "ideas-index.json"), "utf8")).map((x: { slug: string }) => x.slug);
    expect(left).toEqual(["keep", "used"]);
  });

  it("취향 목록을 읽고 폰에서 수정한 금지/선호을 저장한다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-prefs-ui-"));
    ensureIdeaMemory(root);
    const before = readPreferencesView(root);
    expect(before.dislikedPatterns.length).toBeGreaterThan(0);
    expect(before.wants.length).toBeGreaterThan(0);

    const saved = writePreferencesView(root, {
      neverAgain: [{
        id: "na-1",
        pattern: "허전한 홈",
        reason: "콘텐츠 부족",
        date: "2026-07-19",
        sourceProject: "my-app",
        rawFeedback: "홈이 허전함",
      }],
      dislikedPatterns: [{
        id: "dp-1", text: "데모용 가짜 데이터", project: "my-app", date: "2026-07-19",
      }],
      wants: [
        { id: "w-1", text: "홈에 오늘 진행 보이기", project: "my-app", date: "2026-07-19" },
        { id: "w-2", text: "용·퀘스트 원함", project: "dragon-quest", date: "2026-07-19" },
      ],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.neverAgain[0].sourceProject).toBe("my-app");
    expect(saved.value.dislikedPatterns[0]).toMatchObject({ text: "데모용 가짜 데이터", project: "my-app" });
    expect(saved.value.wants.some((w) => w.project === "dragon-quest")).toBe(true);

    const file = JSON.parse(readFileSync(join(root, "user-preferences.json"), "utf8"));
    expect(file.project_notes).toEqual([]);
    expect(file.never_again[0].source_project).toBe("my-app");
  });

  it("제안은 보관함에 자동 저장되지 않고 선택한 것만 들어가며 칭찬을 학습한다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-keep-"));
    const lab = join(root, "idea-lab");
    mkdirSync(lab, { recursive: true });
    ensureIdeaMemory(root);
    writeFileSync(join(lab, "PROPOSED_IDEAS.json"), JSON.stringify([
      {
        slug: "spark-a", direction: "JP→BR", category: "게임",
        one_liner: "신박한 A", detail: "상세 A입니다. 리텐션과 온디바이스가 있어요.",
        source_app: "X", target_user: "Y", on_device_ai: "없음",
        retention_loop: "매일", operating_cost: 0, monetization: "광고", adopted: null,
      },
      {
        slug: "spark-b", direction: "DE→TH", category: "도구",
        one_liner: "평범한 B", detail: "상세 B",
        source_app: "X", target_user: "Y", on_device_ai: "없음",
        retention_loop: "매주", operating_cost: 0, monetization: "무료", adopted: null,
      },
    ]));
    expect(readProposedIdeas(lab)).toHaveLength(2);
    expect(readIdeaLibrary(root)).toEqual([]);

    const kept = keepProposedIdea(root, lab, "spark-a", "와 이런 신박한 걸 원했어요");
    expect(kept.ok).toBe(true);
    expect(readIdeaLibrary(root).map((x) => x.slug)).toEqual(["spark-a"]);

    const prefs = JSON.parse(readFileSync(join(root, "user-preferences.json"), "utf8"));
    expect(texts(prefs.explicit.liked_sparks)[0]).toContain("신박");
    expect(prefs.explicit.liked_sparks[0].project).toBe("idea-lab");
    expect(readProposedIdeas(lab).find((x) => x.slug === "spark-a")?.kept).toBe(true);
  });

  it("PROPOSED_IDEAS가 candidates 래퍼 형식이어도 읽고 보관한다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-wrap-"));
    const lab = join(root, "idea-lab");
    mkdirSync(lab, { recursive: true });
    ensureIdeaMemory(root);
    writeFileSync(join(lab, "PROPOSED_IDEAS.json"), JSON.stringify({
      version: 1,
      round_at: "2026-07-27",
      candidates: [
        {
          slug: "wrap-a", direction: "JP→KR", category: "운세",
          one_liner: "래퍼 후보 A", detail: "상세 A",
          source_app: "X", target_user: "Y", on_device_ai: false,
          retention_loop: "매일", operating_cost: "0원", monetization: "광고", adopted: null,
        },
      ],
    }));
    expect(readProposedIdeas(lab)).toHaveLength(1);
    expect(readProposedIdeas(lab)[0].slug).toBe("wrap-a");
    const kept = keepProposedIdea(root, lab, "wrap-a", "좋아요");
    expect(kept.ok).toBe(true);
    const file = JSON.parse(readFileSync(join(lab, "PROPOSED_IDEAS.json"), "utf8"));
    expect(file.candidates[0].kept).toBe(true);
    expect(readIdeaLibrary(root).some((x) => x.slug === "wrap-a")).toBe(true);
  });

  it("선택한 아이디어를 개발 프로젝트에 복사하고 보관함에서 제거한다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-claim-"));
    const project = join(root, "my-app");
    ensureIdeaMemory(root);
    writeFileSync(join(root, "ideas-index.json"), JSON.stringify([
      { slug: "chosen", direction: "JP→BR", category: "게임", one_liner: "선택", detail: "상세", adopted: null },
      { slug: "other", direction: "US→KR", category: "도구", one_liner: "남음", detail: "상세", adopted: null },
    ]));
    expect(claimIdeaForProject(root, project, "chosen", "my-app")).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(join(project, "SELECTED_IDEA.json"), "utf8")).slug).toBe("chosen");
    expect(JSON.parse(readFileSync(join(root, "ideas-index.json"), "utf8")).map((x: { slug: string }) => x.slug))
      .toEqual(["other"]);
  });

  it("보관함 선택 없이 대화형 개발 입력 골격을 만든다", () => {
    const root = mkdtempSync(join(tmpdir(), "idea-direct-"));
    const project = join(root, "talk-app");
    expect(seedDirectIdeaForProject(project, "talk-app")).toEqual({ ok: true });
    const selected = JSON.parse(readFileSync(join(project, "SELECTED_IDEA.json"), "utf8"));
    expect(selected.direct_input).toBe(true);
    expect(selected.adopted).toBe("talk-app");
  });
});
