import { authFilePath, readRelayAuth, writeRelayAuth } from "../src/shared/auth-store.js";

// 사용법: npm run set-password -- <비밀번호>
const raw = process.argv[2];
if (!raw) {
  console.error("사용법: npm run set-password -- <비밀번호>");
  process.exit(1);
}

try {
  const existing = readRelayAuth(process.cwd());
  const id = existing?.id ?? "admin";
  const auth = writeRelayAuth(process.cwd(), { id, password: raw });
  console.log(`✅ 비밀번호를 저장했어요 (${authFilePath(process.cwd())})`);
  console.log(`   이제부터 폰 연결 시 아이디 "${auth.id}"와 이 비밀번호를 입력하세요: ${auth.password}`);
} catch (e) {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
}
