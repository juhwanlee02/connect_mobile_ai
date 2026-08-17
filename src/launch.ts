import { join } from "node:path";
import { randomBytes } from "node:crypto";
import spawn from "cross-spawn";
import { startRelayServer } from "./server/relay.js";
import { startHost } from "./cli/host.js";
import { parseTunnelUrl } from "./tunnel.js";
import { readRelayAuth, resolveOrCreateRelayAuth } from "./shared/auth-store.js";

const port = Number(process.env.PORT ?? 8080);
// 우선순위: RELAY_ID/RELAY_PASSWORD > .relay-auth.json > .relay-password 승계 생성.
const { auth, created: authCreated } = resolveOrCreateRelayAuth(process.cwd());
const password = auth.password; // host 게이트·레거시 경로용 공유 비밀(값은 로그인 비밀번호와 동일)
const staticDir = join(process.cwd(), "src", "web");
const projectsRoot = join(process.cwd(), "projects");

// /setup 관리 페이지: 실행별 관리키(터미널에만 노출 — 같은 PC의 다른 사용자 차단)
const adminKey = randomBytes(16).toString("hex");
const setupUrl = `http://localhost:${port}/setup?k=${adminKey}`;

// PC 기본 브라우저 열기(실패해도 무시 — URL은 카드에 항상 출력됨)
function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { stdio: "ignore" }); } catch { /* headless 등 — 무시 */ }
}

let tunnelUrl: string | undefined;
let printed = false;
let tunnelHintPrinted = false;

function printCardIfReady(): void {
  // 카드에는 페어링 code가 더 이상 필요 없음(아이디/비밀번호 로그인).
  // tunnelUrl만 오면 즉시 출력한다 — code를 기다리다 최종 URL이 안 뜨던 문제 방지.
  if (printed || !tunnelUrl) return;
  printed = true;
  console.log("\n========================================");
  console.log("✅ 준비 완료! 폰에서 아래로 접속하세요");
  console.log(`  주소:   ${tunnelUrl}`);
  console.log(`  아이디:  ${auth.id}`);
  console.log(`  비밀번호: ${auth.password}`);
  console.log(`  ── 또는 이 링크 하나만 폰에서 열기(아이디 자동 입력) ──`);
  console.log(`  링크:   ${tunnelUrl}/#id=${auth.id}`);
  console.log(`  관리:   ${setupUrl}`);
  if (authCreated) {
    console.log("  (비밀번호 변경: npm run set-password -- <원하는값> · 아이디는 .relay-auth.json)");
  }
  console.log("========================================\n");
}

await startRelayServer(port, staticDir, {
  password,
  previewDir: projectsRoot,
  // 관리 페이지(계획 ③)가 파일을 바꾸면 다음 로그인부터 반영되도록 매 로그인 시 재읽기.
  getPhoneAuth: () => readRelayAuth(process.cwd()) ?? auth,
  admin: {
    key: adminKey,
    configRoot: process.cwd(),
    repoRoot: process.cwd(),
    setupDir: join(process.cwd(), "src", "web", "setup"),
    getInfo: () => ({
      id: (readRelayAuth(process.cwd()) ?? auth).id,
      url: tunnelUrl ?? null,
    }),
  },
});

if (authCreated) {
  console.log(`🛠 처음이시죠? 설정 페이지를 여는 중… ${setupUrl}`);
  openInBrowser(setupUrl);
}

startHost({
  relayUrl: `ws://localhost:${port}`,
  password,
  projectsRoot,
  // 파이프라인 프로젝트 시드 소스(commands/pipeline·templates 등)를 찾을 리포 루트.
  // projectsRoot(=<repo>/projects)의 부모가 곧 리포 루트다.
  repoRoot: process.cwd(),
  configRoot: process.cwd(),
  // 로그에만 쓰고, 최종 URL 카드 출력 조건에는 쓰지 않는다.
  onCode: () => { /* pairing code는 재연결용 — 카드와 무관 */ },
  // 폰에서 보낸 명령이 PC에서 실제로 도는 모습을 터미널에 미러링한다.
  log: (m) => console.log(m),
});

console.log("⏳ 터널(공개 URL)을 여는 중… cloudflared가 주소를 주면 아래에 표시됩니다.");

const cf = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`]);
const onData = (buf: Buffer) => {
  const text = buf.toString();
  // 실패 원인을 숨기지 않기 — 카드가 안 뜰 때 터미널에서 바로 보이게
  if (/failed|error|unable|refused|timeout/i.test(text) && !/Thank you for trying/i.test(text)) {
    const line = text.trim().split(/\r?\n/).find((l) => l.trim());
    if (line) console.error(`⚠️ cloudflared: ${line.slice(0, 240)}`);
  }
  const url = parseTunnelUrl(text);
  if (url && !tunnelUrl) {
    tunnelUrl = url;
    printCardIfReady();
  }
};
cf.stdout?.on("data", onData);
cf.stderr?.on("data", onData);
cf.on("error", (err) => {
  console.error(
    "❌ cloudflared 실행 실패 — 설치·PATH를 확인하세요.",
  );
  console.error(`   (${err instanceof Error ? err.message : String(err)})`);
  console.error("   Windows: winget install cloudflare.cloudflared");
  console.error("   Mac: brew install cloudflared");
  console.error(`   당장은 같은 PC에서만: http://localhost:${port}/#id=${auth.id}`);
  process.exit(1);
});
cf.on("exit", (code, signal) => {
  if (printed) return;
  console.error(
    `❌ cloudflared가 종료됐어요 (code=${code ?? "?"}, signal=${signal ?? "-"}). 공개 URL을 받지 못했습니다.`,
  );
  console.error("   인터넷 연결·방화벽·cloudflared 버전을 확인한 뒤 npm start를 다시 실행하세요.");
  console.error(`   같은 PC 브라우저 테스트: http://localhost:${port}/#id=${auth.id}`);
});

// 45초 안에 URL이 안 오면 대기 중임을 알려 중계 로그만 보고 멈춘 것처럼 보이지 않게 한다.
setTimeout(() => {
  if (printed || tunnelHintPrinted) return;
  tunnelHintPrinted = true;
  console.error("⏳ 아직 공개 URL이 안 왔어요. cloudflared가 응답을 기다리는 중입니다…");
  console.error("   잠시 더 기다리거나, 다른 터미널에서 `cloudflared tunnel --url http://localhost:" + port + "` 를 직접 실행해 보세요.");
  console.error(`   같은 PC에서는 관리 페이지: ${setupUrl}`);
}, 45_000);
