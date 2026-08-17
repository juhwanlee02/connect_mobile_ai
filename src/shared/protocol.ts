import type { PipelineSnapshot } from "./pipeline.js";
import type { TemplateInfo } from "./template-store.js";

// 만들 대상: 🍎 iOS 크기 | 🤖 Android 크기 | 🌐 웹(데스크톱)
// 결과물은 모두 웹/PWA지만, 각 기기 화면 크기·스타일에 맞춰 만들고 미리보기도
// 그 크기 틀로 보여준다. (네이티브 빌드가 아니라 '기기별 미리보기·스타일')
export type ProjectTarget = "ios" | "android" | "web";

// 폰 → (중계) → PC
export interface ImageAttachment {
  name: string;
  mime: string;
  base64: string;
}
export interface CommandMsg {
  type: "command";
  project: string;
  text: string;
  attachments?: ImageAttachment[];
}
export interface CreateProjectMsg {
  type: "createProject";
  name: string;
  target?: ProjectTarget;
  pipeline?: boolean;
  template?: string;
  ideaSlug?: string;
  /** 저장하지 않은 즉석 아이디어로 대화형 개발을 시작할 때 첫 입력 */
  initialPrompt?: string;
}
export interface ListProjectsMsg {
  type: "listProjects";
}
// ── 파이프라인: 폰 → PC ──
export interface ConfirmMsg { type: "confirm"; project: string; stage: string }
export interface StageRollbackMsg { type: "stage_rollback"; project: string; toStage: string }
export interface StageCancelMsg { type: "stage_cancel"; project: string }
export interface PipelineSyncMsg { type: "pipeline_sync" }
export interface ArtifactGetMsg { type: "artifact_get"; project: string; key: string }
// 🔨 다시 빌드: preview/를 flutter build web으로 다시 생성(Claude 개입 없이 PC가 직접 빌드)
export interface PipelineRebuildMsg { type: "pipeline_rebuild"; project: string }
export interface ArtifactSetMsg { type: "artifact_set"; project: string; key: string; content: string }
export interface ChatHistoryGetMsg { type: "chat_history_get"; project: string }
// ── 설문 폼(비즈니스 모델 단계): 폰 → PC ──
export interface FormGetMsg { type: "form_get"; project: string }
export interface FormSubmitMsg { type: "form_submit"; project: string; answers: Record<string, string> }
// ── 보조 스킬 목록: 폰 → PC (프로젝트에 시드된 .claude/commands/skills/* 카탈로그) ──
export interface SkillsGetMsg { type: "skills_get"; project: string }
export interface IdeasLibraryGetMsg { type: "ideas_library_get" }
export interface IdeasDeleteMsg { type: "ideas_delete"; slug: string }
export interface IdeasProposedGetMsg { type: "ideas_proposed_get"; project: string }
export interface IdeasKeepMsg {
  type: "ideas_keep";
  project: string;
  slug: string;
  /** 왜 좋았는지 한 줄 — 다음 회의에 비슷한 신박함 학습용 */
  feedback?: string;
}
// ── 보관/삭제: 폰 → PC (스펙 §8) ──
export interface ProjectArchiveMsg { type: "project_archive"; project: string; archived: boolean }
export interface ProjectDeleteMsg { type: "project_delete"; project: string }
// ── 템플릿(곁가지): 폰 → PC ──
export interface TplListMsg { type: "tpl_list" }
export interface TplCreateMsg { type: "tpl_create"; name: string }
export interface TplCloneMsg { type: "tpl_clone"; basedOn: string; name: string }
export interface TplDeleteMsg { type: "tpl_delete"; id: string }
export interface TplStepsSetMsg {
  type: "tpl_steps_set"; id: string;
  steps: Array<{ id?: string; label: string; kind: string; enabled?: boolean }>;
}
export interface TplPromptGetMsg { type: "tpl_prompt_get"; id: string; stepId: string }
export interface TplPromptSetMsg { type: "tpl_prompt_set"; id: string; stepId: string; body: string }
export interface TplPromptResetMsg { type: "tpl_prompt_reset"; id: string; stepId: string }

// ── 전역 설정(CLI 제공자 + 모델): 폰 → PC ──
export interface SettingsGetMsg { type: "settings_get" }
export interface SettingsSetMsg {
  type: "settings_set";
  provider: "claude" | "codex" | "cursor";
  model: string;
}

// ── 사용자 취향/금지 목록: 폰 → PC ──
export interface PrefNeverAgainItem {
  id: string;
  pattern: string;
  reason: string;
  date: string;
  /** 어느 프로젝트에서 나온 피드백인지 */
  sourceProject: string;
  rawFeedback: string;
}
/** 원함/비선호 한 줄 + 출처 프로젝트 */
export interface PrefTaggedItem {
  id: string;
  text: string;
  project: string;
  date: string;
}
export interface PreferencesPayload {
  neverAgain: PrefNeverAgainItem[];
  dislikedPatterns: PrefTaggedItem[];
  wants: PrefTaggedItem[];
}
export interface PreferencesGetMsg { type: "preferences_get" }
export interface PreferencesSetMsg extends PreferencesPayload { type: "preferences_set" }

export type PhoneOutbound =
  | CommandMsg | CreateProjectMsg | ListProjectsMsg
  | ConfirmMsg | StageRollbackMsg | StageCancelMsg | PipelineSyncMsg | ArtifactGetMsg
  | ArtifactSetMsg | PipelineRebuildMsg
  | ChatHistoryGetMsg | ProjectArchiveMsg | ProjectDeleteMsg
  | FormGetMsg | FormSubmitMsg | SkillsGetMsg
  | IdeasLibraryGetMsg | IdeasDeleteMsg | IdeasProposedGetMsg | IdeasKeepMsg
  | SettingsGetMsg | SettingsSetMsg
  | PreferencesGetMsg | PreferencesSetMsg
  | TplListMsg | TplCreateMsg | TplCloneMsg | TplDeleteMsg | TplStepsSetMsg | TplPromptGetMsg
  | TplPromptSetMsg | TplPromptResetMsg;

// PC → (중계) → 폰
export interface LogMsg {
  type: "log";
  project: string;
  text: string;
}
export interface StatusMsg {
  type: "status";
  project: string;
  state: "idle" | "working" | "done" | "error";
  text?: string;
}
export interface PreviewMsg {
  type: "preview";
  project: string;
  url: string;
}
export interface ProjectsMsg {
  type: "projects";
  names: string[];
  targets?: Record<string, ProjectTarget>;
  pipelines?: string[];
  archived?: string[];
}
export interface AssistantMsg {
  type: "assistant";
  project: string;
  text: string;
}
// ── 파이프라인: PC → 폰 ──
export interface StageUpdateMsg { type: "stage_update"; project: string; pipeline: PipelineSnapshot }
export interface ArtifactMsg { type: "artifact"; project: string; key: string; content: string }

// 설문 폼 스키마(비즈니스 모델 단계). 스킬이 business/form.json으로 쓴 것을 host가 폰에 전달한다.
export interface FormOption { value: string; label: string; warn?: string }
export interface FormQuestion { id: string; label: string; options: FormOption[]; default?: string }
export interface FormSchema { title: string; questions: FormQuestion[] }
export interface FormMsg { type: "form"; project: string; schema: FormSchema }

// 보조 스킬 목록(PC → 폰): 프로젝트에 실제로 시드된 스킬 디렉터리 기준.
// label/desc는 host의 한글 카탈로그 매핑(SKILL.md 형식이 제각각이라 파싱하지 않는다).
export interface SkillItem { id: string; label: string; desc: string }
export interface SkillsMsg { type: "skills"; project: string; items: SkillItem[] }
export interface IdeaLibraryItem {
  slug: string;
  direction: string;
  category: string;
  /** 대표 소개 한 줄 — 목록에 항상 보임 */
  oneLiner: string;
  /** 상세 설명 — 목록에서 클릭해야 펼쳐짐 */
  detail: string;
  /** 해외 검증·현지화 레퍼런스 앱명(없으면 빈 문자열) */
  sourceApp: string;
  /** inspiration_basis 요약 — 상세에 표시 */
  inspirationBasis: string;
  targetUser: string;
  onDeviceAi: string;
  retentionLoop: string;
  operatingCost: string;
  monetization: string;
  adopted: string | null;
  /** 이번 제안 중 사용자가 이미 보관한 경우 */
  kept?: boolean;
}
export interface IdeasLibraryMsg { type: "ideas_library"; items: IdeaLibraryItem[] }
export interface IdeasProposedMsg {
  type: "ideas_proposed";
  project: string;
  items: IdeaLibraryItem[];
}

// 프로젝트별 채팅 히스토리 한 건(§: cli/chat-log.ts가 append/read). shared가 cli에
// 의존하면 안 되므로 여기 정의하고 chat-log.ts가 이 타입을 import한다.
export interface ChatEntry {
  ts: string;
  role: "user" | "assistant" | "log";
  text: string;
}
export interface ChatHistoryMsg { type: "chat_history"; project: string; entries: ChatEntry[] }

// ── 템플릿: PC → 폰 ──
export interface TplListOutMsg { type: "tpl_list"; templates: TemplateInfo[] }
export interface TplPromptOutMsg {
  type: "tpl_prompt"; id: string; stepId: string; body: string; overridden: boolean;
}

// ── 전역 설정: PC → 폰 ──
export interface SettingsMsg {
  type: "settings";
  provider: "claude" | "codex" | "cursor";
  model: string;
}

export interface PreferencesMsg extends PreferencesPayload {
  type: "preferences";
  updatedAt: string;
}

export type HostOutbound =
  | LogMsg | StatusMsg | PreviewMsg | ProjectsMsg | AssistantMsg
  | StageUpdateMsg | ArtifactMsg | ChatHistoryMsg | FormMsg | SkillsMsg
  | IdeasLibraryMsg | IdeasProposedMsg
  | SettingsMsg | PreferencesMsg
  | TplListOutMsg | TplPromptOutMsg | ErrorMsg;

// 서버 → PC
export interface CodeMsg {
  type: "code";
  code: string;
  // host 전용 세션 재획득 비밀(고엔트로피 랜덤). code는 폰에도 노출되는 공개
  // 식별자라서 재획득 인가로 쓸 수 없다 — 이 키를 아는 host만 세션을 재획득할
  // 수 있다. 절대 폰에게 전달되는 메시지에 포함하면 안 된다.
  reconnectKey: string;
  // /preview/** HTTP 서빙용 세션별 서명 토큰(고엔트로피 랜덤). reconnectKey와
  // 달리 폰에도 전달돼야 하므로(PairedMsg) host 전용이 아니다.
  token: string;
}
// 서버 → 폰
export interface PairedMsg {
  type: "paired";
  // /preview/** HTTP 서빙용 세션별 서명 토큰. 폰(app.js)이 preview·뷰어 URL에
  // ?t=<token>으로 부착한다(1회 검증 후 relay가 HttpOnly 쿠키 발급).
  token: string;
  // 폰 자동 로그인용 세션 토큰(localStorage 저장, ?phoneToken=으로 재접속). 세션
  // 수명 한정 — 릴레이 재시작이면 무효(스펙 §8).
  phoneToken: string;
}
export interface ErrorMsg {
  type: "error";
  text: string;
}
