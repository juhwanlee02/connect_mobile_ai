# 체험판 → 구매 (Try-before-buy) + 최적화 — 설계 문서

> 작성일: 2026-06-14
> 상태: 설계 승인됨(사용자가 빌드 지시)

## 한 줄 요약

라이선스 없이도 **체험판(프로젝트 1개로 전체 루프 경험)** 으로 돌아가고, 일회성 키를 넣으면 **멀티프로젝트+병렬이 해제**된다. 곁들여 코드 최적화(불필요 반환값 제거, 시드 중복 제거).

## 동기

- 일회성 구매 모델 A. 사용자가 **써보고 살지 결정**할 수 있어야 함.
- 지금은 라이선스 없으면 런처가 즉시 종료 → 체험 불가. 이를 **체험판 실행**으로 바꾼다.
- 체험의 잠금은 강한 DRM이 아니라 **구매 유도 깔때기**(모델 A 오프라인 한계는 수용; 강한 보호는 추후 서버검증).

## 핵심 결정

| 항목 | 결정 |
|---|---|
| 체험 모델 | 기능 제한(프리미엄) — 무료=프로젝트 **1개**, 구매=무제한+병렬 |
| 라이선스 없음 | 종료가 아니라 **체험판으로 실행** |
| 유료 해제 지점 | 프로젝트 **생성 개수** (멀티프로젝트가 구매 가치) |
| 폰 표시 | "체험판" 배너 + 한도 도달 시 구매 안내 |
| Electron 설치프로그램 | **이번 범위 아님**(다음 패키징 단계) |

## 동작

- **라이선스 유효** → 정상(프로젝트 무제한 생성, 병렬). 
- **라이선스 없음/무효** → 체험판: 프로젝트 1개까지만. 2번째 생성 시 거부 + "구매하면 무제한" 안내.
- 첫 실행 시 기본 `my-app` 시드 → 체험 사용자는 그 1개로 전체 루프(폰 명령→생성→미리보기) 경험.

## 컴포넌트 변경

### `src/cli/host.ts`
- `HostOptions`에 `licensed?: boolean` 추가(기본 `true` — 기존 동작/테스트 보존).
- `createProject` 처리: `!licensed && listProjects(root).length >= 1` 이면 거부:
  `status{project: raw, state:"error", text:"체험판은 프로젝트 1개까지예요. 구매하면 무제한!"}`. 생성 안 함.
- `projects` 전송 시 체험 여부를 함께: `ProjectsMsg`에 `trial?: boolean` 추가(=`!licensed`).

### `src/shared/protocol.ts`
- `ProjectsMsg`에 `trial?: boolean` 추가(옵셔널 — 하위호환).

### `src/launch.ts`
- 라이선스 없을 때 **종료하지 않음**. `const licensed = isValidLicenseKey(resolveLicense())`.
- `startHost({..., licensed})`. 카드에 상태 한 줄: 유료면 "✅ 정품", 체험이면 "🧪 체험판 — 프로젝트 1개 (구매 시 무제한)".

### `src/cli/index.ts`(dev:cli) / `src/server/index.ts`
- dev:cli도 `licensed = isValidLicenseKey(env)` 전달(개발자가 키 없이 돌리면 체험 동작 확인 가능). dev:server는 변경 없음(릴레이만).

### 폰 UI(`src/web/app.js`, `index.html`)
- `projects` 메시지의 `trial`이 true면 상단에 체험 배너 표시: "🧪 체험판 — 프로젝트 1개. 구매하면 여러 개!" (구매 안내 텍스트/링크 자리).
- `➕ 새 프로젝트` 시도가 거부되면(에러 status) 그 메시지가 로그/안내로 보임.

## 최적화(곁들임)

1. **불필요 반환값 제거:** `Executor.run`이 `{url}`을 반환하지만 아무도 안 씀(handleCommand가 `/preview/<project>/` 직접 구성). `run(...)→Promise<void>`로 정리. RealExecutor·가짜 executor·테스트 갱신.
2. **시드 중복 제거:** `server/index.ts`와 `launch.ts`에 같은 `if (listProjects==0) createProject(...,"my-app")` → `ensureSeedProject(root)` 헬퍼를 `projects.ts`에 추가해 공용화.

## 테스트

- host: `licensed:false`에서 2번째 createProject 거부 + `projects.trial===true`; `licensed:true`에서 2개 생성 OK + `trial` falsy.
- 기존 host/agent/relay/projects 테스트는 시그니처 변경(Executor.run 반환 제거)에 맞춰 갱신, 통과 유지.
- 폰 UI: 수동(배너 표시) + 정적 서빙 확인.

## 범위 밖
- Electron/Tauri 설치프로그램 포장(다음 단계, 화면 검증 필요).
- 기간제/만료 키(일회성만).
- 서버 기반 라이선스 검증(모델 B).
