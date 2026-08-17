# Connect PC Mobile Claude

휴대폰에서 아이디어를 정리하고 작업을 지시하면, PC에 설치된 AI 코딩 CLI가 앱을 만들고 결과를 휴대폰에 바로 보여주는 로컬 앱 제작 도구입니다.

- 휴대폰은 채팅·검토·승인·미리보기에 사용합니다.
- 실제 AI 실행과 파일 생성은 PC에서 이루어집니다.
- 별도 배포 없이 Cloudflare 임시 주소로 휴대폰과 PC를 연결합니다.
- Claude Code, Codex, Cursor Agent CLI를 지원합니다.

## 준비물

- [Node.js 20 이상](https://nodejs.org/)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
- 아래 AI 코딩 CLI 중 하나(설치 및 로그인 완료 상태)
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [Codex CLI](https://github.com/openai/codex)
  - [Cursor Agent CLI](https://cursor.com/docs/cli/overview)

앱 파이프라인에서 Flutter 프로젝트를 생성하려면 [Flutter SDK](https://docs.flutter.dev/get-started/install)도 필요합니다.

설치 여부는 터미널에서 확인할 수 있습니다.

```bash
node --version
cloudflared --version
claude --version
codex --version
agent --version
flutter --version
```

AI CLI는 모두 설치할 필요 없이 실제로 사용할 것 하나만 준비하면 됩니다.

## 설치

프로젝트 폴더에서 한 번만 실행합니다.

```bash
npm install
```

## 실행

가장 간단한 방법은 운영체제에 맞는 파일을 더블클릭하는 것입니다.

- Windows: `launchers/시작.bat`
- macOS: `launchers/시작.command`
- Linux: `launchers/시작.sh`

터미널에서는 다음 명령으로 실행할 수 있습니다.

```bash
npm start
```

잠시 후 터미널에 휴대폰 접속 정보가 표시됩니다.

```text
✅ 준비 완료! 폰에서 아래로 접속하세요
  주소:     https://xxxx.trycloudflare.com
  아이디:   admin
  비밀번호: ********
  링크:     https://xxxx.trycloudflare.com/#id=admin
  관리:     http://localhost:8080/setup?k=...
```

1. 휴대폰에서 `링크`를 엽니다.
2. 표시된 비밀번호로 로그인합니다.
3. 홈에서 `＋ 새 프로젝트`를 누르고 원하는 작업 방식을 선택합니다.
4. 사용이 끝나면 PC 터미널에서 `Ctrl+C`를 누릅니다.

`trycloudflare.com` 주소는 실행할 때마다 새로 발급됩니다. PC를 다시 실행한 뒤에는 새 링크로 접속해 한 번 다시 로그인해야 합니다.

## 처음 실행할 때

처음 실행하면 PC 브라우저에 관리 화면이 자동으로 열립니다. 이후에는 터미널에 표시된 `관리` 주소로 열 수 있습니다.

관리 화면에서 다음 항목을 설정할 수 있습니다.

- 휴대폰 로그인 아이디와 비밀번호
- 파이프라인 템플릿과 단계별 프롬프트
- PRD 등 산출물 템플릿

휴대폰의 `설정` 화면에서는 사용할 AI CLI와 모델을 선택할 수 있습니다. 선택한 CLI가 PC에서 설치·로그인된 상태여야 합니다.

비밀번호만 터미널에서 변경하려면 다음 명령을 사용합니다.

```bash
npm run set-password -- 새비밀번호
```

## 프로젝트 만들기

`＋ 새 프로젝트`에서 다음 흐름을 선택할 수 있습니다.

### 아이디어 연구소

AI와 아이디어 후보를 토론하고 마음에 드는 후보를 공용 보관함에 저장합니다. 프로젝트를 여러 번 만들어도 보관한 아이디어와 사용자 취향은 계속 누적됩니다.

### 떠오른 아이디어로 바로 개발

아이디어를 직접 입력하고 곧바로 앱 제작 파이프라인을 시작합니다. 보관함을 거칠 필요가 없습니다.

### 저장된 아이디어로 개발

아이디어 연구소에서 보관한 후보를 골라 별도의 개발 프로젝트로 진행합니다. 개발을 시작한 아이디어는 보관함에서 빠집니다.

### 내 복제 템플릿

기본 파이프라인을 복제·수정해 만든 작업 순서로 프로젝트를 시작합니다.

파이프라인에서는 각 단계의 결과를 휴대폰에서 확인하고 피드백하거나 승인합니다. 생성된 코드와 문서는 `projects/<프로젝트명>/`에 저장됩니다.

## 휴대폰에서 작업하기

- 채팅으로 기능 추가, 문구 수정, 디자인 변경 등을 요청할 수 있습니다.
- PNG, JPG, WebP, GIF 이미지를 한 번에 3개까지 첨부할 수 있습니다(장당 4MB 이하).
- 문서 산출물은 `직접 수정`으로 편집할 수 있습니다.
- 여러 프로젝트는 서로 독립적으로 저장되며 프로젝트별 대화 기록도 유지됩니다.
- 홈의 `내 취향`에서 프로젝트를 사용하며 쌓인 선호·금지 항목을 확인하고 수정할 수 있습니다.

## 실행 중 저장되는 데이터

아래 데이터는 사용자의 로컬 실행 데이터이므로 Git에 커밋되지 않도록 `.gitignore`에 등록되어 있습니다.

- `projects/`: 생성한 앱, 아이디어 보관함, 사용자 취향, 채팅 기록, 첨부 이미지
- `pipelines/`: 복제하거나 수정한 파이프라인
- `templates/.orig/`: 산출물 템플릿 원본 백업
- `.relay-auth.json`: 휴대폰 로그인 정보
- `.host-settings.json`: 선택한 AI CLI와 모델
- 각종 원자적 저장용 임시 파일

필요한 데이터는 Git 대신 별도 위치에 백업하세요. 특히 `projects/`를 삭제하면 생성한 앱과 누적된 아이디어·취향도 함께 사라집니다.

## 문제 해결

- 공개 주소가 나오지 않음: `cloudflared --version`과 인터넷 연결을 확인합니다.
- AI 작업이 시작되지 않음: 휴대폰 설정에서 선택한 CLI가 PC에서 설치·로그인됐는지 확인합니다.
- Flutter 앱 생성 실패: `flutter doctor`를 실행해 SDK 구성을 확인합니다.
- 휴대폰 로그인이 안 됨: 현재 실행의 터미널 카드에 나온 아이디와 비밀번호를 사용합니다.
- 관리 화면이 안 열림: 휴대폰이 아니라 실행 중인 PC에서 `관리` 주소 전체를 엽니다.
- 포트 충돌: 다른 프로그램이 8080 포트를 사용 중이면 종료하거나 `PORT` 환경변수로 포트를 바꿉니다.

## 개발

```bash
# 테스트
npm test

# 릴레이 서버와 CLI 호스트를 각각 실행
npm run dev:server
npm run dev:cli
```

주요 디렉터리:

- `src/server/`: HTTP·WebSocket 릴레이 서버
- `src/cli/`: AI CLI 실행, 프로젝트 및 파이프라인 관리
- `src/web/`: 휴대폰 PWA와 PC 관리 화면
- `commands/`: 파이프라인 단계 및 보조 스킬
- `templates/`: 산출물 및 Flutter 스타터 템플릿
- `tests/`: Vitest 테스트

상세 인수 절차는 [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md), 고객용 설치 가이드는 [`docs/SETUP-customer.md`](docs/SETUP-customer.md)를 참고하세요.
