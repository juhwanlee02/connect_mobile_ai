import { join } from "node:path";
import { startHost } from "./host.js";
import { readRelayPassword } from "./relay-password.js";

const relayUrl = process.env.RELAY_URL ?? "ws://localhost:8080";
// 외부 릴레이에 붙는 쪽이라 여기선 자동 생성하지 않는다: 환경변수 > 파일 > 없음.
const password = readRelayPassword(process.cwd());
const projectsRoot = join(process.cwd(), "projects");

startHost({
  relayUrl,
  password,
  projectsRoot,
  // 파이프라인 프로젝트 시드 소스(commands/pipeline·templates 등)를 찾을 리포 루트.
  // launch.ts와 동일 — 생략하면 dev:cli(이 진입점)에서 템플릿 시드가 조용히 무시된다.
  repoRoot: process.cwd(),
  configRoot: process.cwd(),
  onCode: () =>
    console.log(
      "\n📱 폰 로그인 준비 완료 (아이디는 RELAY_ID 또는 'dev', 비밀번호는 RELAY_PASSWORD)\n",
    ),
});
