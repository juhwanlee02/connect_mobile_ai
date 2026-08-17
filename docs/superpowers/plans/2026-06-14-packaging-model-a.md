# 패키징 (모델 A: 자가호스팅) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 비개발자 고객이 **명령 하나(`npm start`)** 로 중계서버+호스트+터널을 띄우고, 화면에 뜬 **주소·코드·비번** 카드를 폰에 입력해 바로 쓰게 한다. 실행은 **라이선스 키**로 잠근다. 고객용/판매자용 가이드 문서를 만든다.

**Architecture:** 한 프로세스(`src/launch.ts`)가 ① 라이선스 검증 → ② 중계서버 인프로세스 기동(비번 미설정 시 자동 생성) → ③ 호스트 연결(localhost) → ④ cloudflared 터널 spawn 후 공개 URL 파싱 → ⑤ 코드와 URL이 모두 준비되면 "공유 카드" 출력. 재사용을 위해 호스트 로직을 `src/cli/host.ts`로 추출(기존 `dev:cli`도 이를 사용). 순수 로직(터널 URL 파싱, 라이선스)은 단위테스트, 오케스트레이션은 수동 검증.

**Tech Stack:** 기존과 동일 (TypeScript/Node, ws, vitest, tsx). 터널은 cloudflared(고객 사전설치).

---

## Task T1: 순수 헬퍼 — 터널 URL 파서 + 라이선스 키

**Files:**
- Create: `src/tunnel.ts`
- Create: `src/license.ts`
- Test: `tests/tunnel.test.ts`
- Test: `tests/license.test.ts`

- [ ] **Step 1: tunnel 테스트 작성** — Create `tests/tunnel.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseTunnelUrl } from "../src/tunnel.js";

describe("parseTunnelUrl", () => {
  it("cloudflared 출력에서 trycloudflare URL을 뽑는다", () => {
    const line =
      "INF |  https://championships-bedding-adapter-functioning.trycloudflare.com  |";
    expect(parseTunnelUrl(line)).toBe(
      "https://championships-bedding-adapter-functioning.trycloudflare.com",
    );
  });
  it("URL이 없으면 null", () => {
    expect(parseTunnelUrl("그냥 로그 줄")).toBeNull();
  });
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/tunnel.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: tunnel.ts 작성** — Create `src/tunnel.ts`:
```ts
// cloudflared 출력 한 줄에서 공개 trycloudflare URL을 추출(없으면 null).
export function parseTunnelUrl(text: string): string | null {
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  return m ? m[0] : null;
}
```

- [ ] **Step 4: license 테스트 작성** — Create `tests/license.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  makeLicenseKey,
  isValidLicenseKey,
  randomLicenseKey,
} from "../src/license.js";

describe("license keys", () => {
  it("발급한 키는 유효하다", () => {
    expect(isValidLicenseKey(makeLicenseKey("ABC234"))).toBe(true);
  });
  it("랜덤 발급 키도 유효하다", () => {
    expect(isValidLicenseKey(randomLicenseKey())).toBe(true);
  });
  it("체크섬이 틀리면 무효", () => {
    expect(isValidLicenseKey("CPMC-ABC234-ZZ")).toBe(false);
  });
  it("형식이 틀리면 무효", () => {
    expect(isValidLicenseKey("hello")).toBe(false);
    expect(isValidLicenseKey(undefined)).toBe(false);
  });
});
```

- [ ] **Step 5: 실행해 실패 확인** — `npx vitest run tests/license.test.ts` → FAIL(모듈 없음).

- [ ] **Step 6: license.ts 작성** — Create `src/license.ts`:
```ts
import { randomBytes } from "node:crypto";

// 주의: 오프라인 검증이라 "기본 잠금"용이다. 결정적 복제 방지는
// 서버 검증(모델 B)이 필요. 판매자 가이드에 명시.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32
const SECRET = "cpmc-v1-7nQ2"; // 난독화용 솔트

function checksum(payload: string): string {
  let h = 0;
  const s = SECRET + payload;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ALPHABET[(h >>> 5) % 32] + ALPHABET[h % 32];
}

// 6자 base32 payload → 전체 키. payload는 호출자가 base32로 보장.
export function makeLicenseKey(payload: string): string {
  const p = payload.toUpperCase().slice(0, 6).padEnd(6, "2");
  return `CPMC-${p}-${checksum(p)}`;
}

export function randomLicenseKey(): string {
  const bytes = randomBytes(6);
  let p = "";
  for (let i = 0; i < 6; i++) p += ALPHABET[bytes[i] % 32];
  return makeLicenseKey(p);
}

export function isValidLicenseKey(key: string | undefined): boolean {
  if (!key) return false;
  const m = key.match(/^CPMC-([A-Z2-7]{6})-([A-Z2-7]{2})$/);
  if (!m) return false;
  return checksum(m[1]) === m[2];
}
```

- [ ] **Step 7: 실행해 통과 확인** — `npx vitest run tests/tunnel.test.ts tests/license.test.ts` → 전부 PASS(tunnel 2 + license 4 = 6). `npx tsc --noEmit` 클린.

- [ ] **Step 8: Commit**
```bash
git add src/tunnel.ts src/license.ts tests/tunnel.test.ts tests/license.test.ts
git commit -m "feat: tunnel URL parser + offline license key helpers"
```

---

## Task T2: 호스트 로직 추출 (재사용 가능하게)

**Files:**
- Create: `src/cli/host.ts`
- Modify: `src/cli/index.ts`

기존 `cli/index.ts`의 연결/재연결 로직을 `startHost(opts)`로 추출해 런처와 CLI가 공유한다. `onCode` 콜백으로 페어링 코드를 외부에 넘긴다.

- [ ] **Step 1: host.ts 작성** — Create `src/cli/host.ts`:
```ts
import { WebSocket } from "ws";
import { handleCommand } from "./agent.js";
import { nextBackoff } from "./backoff.js";
import type { Executor } from "./executor.js";
import type { CommandMsg } from "../shared/protocol.js";

export interface HostOptions {
  relayUrl: string;
  password?: string;
  executor: Executor;
  onCode?: (code: string) => void;
  log?: (msg: string) => void;
}

// 중계서버에 host로 붙어 명령을 받아 executor로 처리한다. 끊기면 지수 백오프로 재연결.
export function startHost(opts: HostOptions): void {
  const { relayUrl, password, executor } = opts;
  const log = opts.log ?? ((m: string) => console.log(m));
  let attempt = 0;

  function connect(): void {
    const hostUrl = password
      ? `${relayUrl}/host?secret=${encodeURIComponent(password)}`
      : `${relayUrl}/host`;
    const ws = new WebSocket(hostUrl);

    let reconnectScheduled = false;
    const scheduleReconnect = () => {
      if (reconnectScheduled) return;
      reconnectScheduled = true;
      const delay = nextBackoff(attempt++);
      log(`중계서버 연결 종료 — ${delay}ms 후 재연결 시도`);
      setTimeout(connect, delay);
    };

    ws.on("open", () => {
      attempt = 0;
      log(`중계서버 연결됨: ${relayUrl}`);
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "code") {
        opts.onCode?.(msg.code);
      } else if (msg.type === "command") {
        const cmd = msg as CommandMsg;
        log(`명령 수신: ${cmd.text}`);
        handleCommand(cmd.text, executor, (m) => ws.send(JSON.stringify(m)));
      } else if (msg.type === "error") {
        console.error(
          `⚠️  릴레이 오류: ${msg.text} (RELAY_PASSWORD가 서버와 일치하는지 확인하세요)`,
        );
      }
    });

    ws.on("close", scheduleReconnect);
    ws.on("error", () => {
      // error 뒤에 close가 이어지며 scheduleReconnect가 중복을 막는다
    });
  }

  connect();
}
```

- [ ] **Step 2: cli/index.ts를 host.ts 사용으로 교체** — `src/cli/index.ts` 전체를 다음으로 교체:
```ts
import { join } from "node:path";
import { RealExecutor } from "./executor.js";
import { startHost } from "./host.js";

const relayUrl = process.env.RELAY_URL ?? "ws://localhost:8080";
const password = process.env.RELAY_PASSWORD || undefined;
const executor = new RealExecutor(join(process.cwd(), "workspace"));

startHost({
  relayUrl,
  password,
  executor,
  onCode: (code) =>
    console.log(`\n📱 폰에서 이 코드를 입력하세요:  ${code}\n`),
});
```

- [ ] **Step 3: 타입체크 + 기존 테스트** — `npx tsc --noEmit` 클린. `npx vitest run` 통과(기존 + T1의 6 = 25). (host.ts/cli는 통합이라 단위테스트 없음; `agent.test.ts`는 그대로 유효.)

- [ ] **Step 4: 수동 확인** — 백그라운드로 `npm run dev:server` + `npm run dev:cli` → CLI가 `📱 …코드…` 출력하면 OK. 두 프로세스 종료.

- [ ] **Step 5: Commit**
```bash
git add src/cli/host.ts src/cli/index.ts
git commit -m "refactor: extract reusable startHost from CLI entrypoint"
```

---

## Task T3: 원커맨드 런처 + 라이선스 게이트

**Files:**
- Create: `src/launch.ts`
- Create: `scripts/gen-license.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: launch.ts 작성** — Create `src/launch.ts`:
```ts
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { startRelayServer } from "./server/relay.js";
import { startHost } from "./cli/host.js";
import { RealExecutor } from "./cli/executor.js";
import { parseTunnelUrl } from "./tunnel.js";
import { isValidLicenseKey } from "./license.js";

if (!isValidLicenseKey(process.env.LICENSE_KEY)) {
  console.error(
    "❌ 유효한 LICENSE_KEY가 필요합니다. 구매처에서 받은 키를 LICENSE_KEY 환경변수로 설정하세요.",
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8080);
const password =
  process.env.RELAY_PASSWORD || randomBytes(6).toString("base64url");
const staticDir = join(process.cwd(), "src", "web");
const previewDir = join(process.cwd(), "workspace", "public");
const workdir = join(process.cwd(), "workspace");

let code: string | undefined;
let tunnelUrl: string | undefined;
let printed = false;
function printCardIfReady(): void {
  if (printed || !code || !tunnelUrl) return;
  printed = true;
  console.log("\n========================================");
  console.log("✅ 준비 완료! 폰에서 아래로 접속하세요");
  console.log(`  주소:   ${tunnelUrl}`);
  console.log(`  코드:   ${code}`);
  console.log(`  비밀번호: ${password}`);
  console.log("========================================\n");
}

await startRelayServer(port, staticDir, { password, previewDir });

startHost({
  relayUrl: `ws://localhost:${port}`,
  password,
  executor: new RealExecutor(workdir),
  onCode: (c) => {
    code = c;
    printCardIfReady();
  },
  log: () => {
    /* 카드가 UX라 호스트 로그는 숨김 */
  },
});

const cf = spawn("cloudflared", [
  "tunnel",
  "--url",
  `http://localhost:${port}`,
]);
const onData = (buf: Buffer) => {
  const url = parseTunnelUrl(buf.toString());
  if (url && !tunnelUrl) {
    tunnelUrl = url;
    printCardIfReady();
  }
};
cf.stdout.on("data", onData);
cf.stderr.on("data", onData);
cf.on("error", () => {
  console.error(
    "❌ cloudflared 실행 실패 — 설치돼 있나요? (mac: brew install cloudflared)",
  );
  process.exit(1);
});

console.log("⏳ 시작 중… 잠시 후 접속 정보가 표시됩니다.");
```

- [ ] **Step 2: gen-license.ts 작성** — Create `scripts/gen-license.ts`:
```ts
import { randomLicenseKey } from "../src/license.js";

// 판매자가 고객에게 줄 라이선스 키를 1개(또는 N개) 발급한다.
const n = Number(process.argv[2] ?? 1);
for (let i = 0; i < n; i++) console.log(randomLicenseKey());
```

- [ ] **Step 3: package.json 스크립트 추가** — `scripts`에 다음 두 줄을 추가(기존 dev:server/dev:cli/test 유지):
```json
    "start": "tsx src/launch.ts",
    "gen-license": "tsx scripts/gen-license.ts"
```

- [ ] **Step 4: 타입체크** — `npx tsc --noEmit` 클린. `npx vitest run` 그대로 통과.

- [ ] **Step 5: 수동 검증(라이선스 게이트 + 카드 + 터널)**
  - 라이선스 없이: `npm start` → `❌ 유효한 LICENSE_KEY가 필요합니다` 출력하고 종료되는지 확인.
  - 키 발급: `npm run gen-license` → `CPMC-XXXXXX-YY` 출력. 그 값을 사용.
  - 정상 실행(백그라운드): `LICENSE_KEY=<발급키> npm start` → 잠시 후 "공유 카드"(주소/코드/비밀번호)가 출력되는지 확인.
  - 카드의 트runnel URL로 curl: `curl -s <주소> | grep -c 'connect-pc-mobile-claude'` → >=1 (폰 PWA가 터널 통해 서빙).
  - 모든 백그라운드 프로세스(node/tsx/cloudflared) 종료. 남기지 말 것.

- [ ] **Step 6: Commit**
```bash
git add src/launch.ts scripts/gen-license.ts package.json
git commit -m "feat: one-command launcher (relay+host+tunnel) with license gate"
```

---

## Task T4: 가이드 문서 (고객용 + 판매자용)

**Files:**
- Create: `docs/SETUP-customer.md` (고객용 설치/사용 가이드)
- Create: `docs/PACKAGING-seller.md` (판매자용 패키징/판매 가이드)
- Modify: `README.md` (두 가이드로의 링크 추가)

- [ ] **Step 1: 고객용 가이드 작성** — Create `docs/SETUP-customer.md`. 비개발자도 따라오게 번호 순서로. 내용:
  1. 준비물: Node.js 20+ 설치(링크), cloudflared 설치(mac `brew install cloudflared`, Windows winget/다운로드), Claude Code 설치 후 로그인(`claude` 명령), 받은 **라이선스 키**.
  2. 도구 받기: 배포 zip 풀기(또는 `git clone`) → 폴더에서 `npm install`.
  3. 실행: `LICENSE_KEY=받은키 npm start` (한 줄). 잠시 뒤 **주소/코드/비밀번호 카드**가 뜸.
  4. 폰에서: 그 **주소** 열기 → **코드**+**비밀번호** 입력 → 연결.
  5. 사용: 채팅에 "public/index.html을 …" 식으로 명령 → 미리보기가 즉시 갱신.
  6. 종료: 터미널 Ctrl+C (접속 주소도 사라짐).
  7. 자주 묻는 문제: cloudflared 미설치/주소 안 뜸/코드·비번 불일치/claude 로그인 안 됨 → 각 한 줄 해결.

- [ ] **Step 2: 판매자용 가이드 작성** — Create `docs/PACKAGING-seller.md`. 내용:
  1. 개요: 모델 A(고객 PC에서 전부 실행, 운영자 서버비용 0). 한계: 미리보기는 고객이 켜둔 동안만, 영구 URL 아님.
  2. 라이선스 발급: `npm run gen-license [개수]` → 키 출력 → 고객에게 전달. (정직한 한계: 오프라인 검증이라 결정적 복제는 못 막음 → 강한 보호는 모델 B 서버검증 필요. `src/license.ts`의 SECRET은 배포본마다 바꿀 것.)
  3. 패키징/배포 방법(택1): (a) GitHub 비공개 레포 접근권 판매, (b) 소스 zip 배포, (c) `npm pack`/사내 레지스트리, (d) `pkg`/`node --build`로 단일 실행파일(고급). 각 1~2줄.
  4. 고객 지원 체크리스트: Node/cloudflared/claude 로그인 3종 + 라이선스 키.
  5. 가격/수익화: 일회성 라이선스 vs 기간제 키(키에 만료 넣으려면 license 스킴 확장). AI·배포 비용은 고객 부담(원가 0) 재확인.
  6. 다음 단계(모델 B 로드맵): 중계서버 클라우드 호스팅 + 미리보기 프록시 + 계정/구독 결제 → 진짜 SaaS.

- [ ] **Step 3: README 링크 추가** — README에 "고객용 설치: docs/SETUP-customer.md / 판매자용: docs/PACKAGING-seller.md" 링크 한 섹션 추가. 기존 개발자용 실행법(dev:server/dev:cli)은 유지.

- [ ] **Step 4: Commit**
```bash
git add docs/SETUP-customer.md docs/PACKAGING-seller.md README.md
git commit -m "docs: customer setup guide + seller packaging guide"
```

---

## 완료 기준

- [ ] `npm test` 통과 (기존 19 + tunnel 2 + license 4 = 25)
- [ ] `npx tsc --noEmit` 클린
- [ ] `npm start`가 라이선스 없으면 거부, 있으면 relay+host+tunnel 띄우고 주소/코드/비번 카드 출력
- [ ] `npm run gen-license`로 유효 키 발급
- [ ] 고객용/판매자용 가이드 문서 존재
- [ ] 중계서버는 여전히 WS 내용 미파싱 + 비밀번호 게이트 유지
