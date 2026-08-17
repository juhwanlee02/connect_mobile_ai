import { join } from "node:path";
import { startRelayServer } from "./relay.js";
import { ensureSeedProject } from "../cli/projects.js";
import { readRelayAuth } from "../shared/auth-store.js";

const port = Number(process.env.PORT ?? 8080);
const staticDir = join(process.cwd(), "src", "web");
const projectsRoot = join(process.cwd(), "projects");
const password = process.env.RELAY_PASSWORD || undefined;

ensureSeedProject(projectsRoot);

startRelayServer(port, staticDir, {
  password,
  previewDir: projectsRoot,
  // RELAY_PASSWORD만 설정된 dev 흐름이면 id는 "dev"가 된다(auth-store 규칙)
  getPhoneAuth: () => readRelayAuth(process.cwd()),
}).then(
  ({ port }) => {
    console.log(`중계서버 실행 중: http://localhost:${port}`);
    console.log(`폰 웹앱: http://<PC의 LAN IP 또는 터널 주소>:${port}`);
    console.log(`미리보기: projects/<이름>/public → /preview/<이름>/ 서빙`);
    console.log('폰 로그인: 아이디/비밀번호 (RELAY_PASSWORD만 설정 시 아이디는 "dev")');
    if (password) {
      console.log("🔒 비밀번호 보호: 켜짐");
    } else {
      console.log("⚠️ RELAY_PASSWORD 미설정 — 폰 로그인 불가(자격증명 없음). RELAY_PASSWORD를 설정하세요.");
    }
  },
);
