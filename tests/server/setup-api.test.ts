import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelayServer, type RelayHandle } from "../../src/server/relay.js";
import { readRelayAuth } from "../../src/shared/auth-store.js";
import { DEFAULT_STEPS } from "../../src/shared/pipeline.js";

let relay: RelayHandle;
let base: string;
let configRoot: string;
let repoRoot: string;
let setupDir: string;
const KEY = "testkey123";

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { "x-admin-key": KEY, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

beforeEach(async () => {
  configRoot = mkdtempSync(join(tmpdir(), "setup-cfg-"));
  repoRoot = mkdtempSync(join(tmpdir(), "setup-repo-"));
  mkdirSync(join(repoRoot, "templates"), { recursive: true });
  // 파이프라인 템플릿 정본(tests/shared/template-store.test.ts fixture 재사용):
  // 7종 빌트인 프롬프트 + _CONTRACT + _GENERIC_STEP
  mkdirSync(join(repoRoot, "commands", "pipeline"), { recursive: true });
  for (const s of DEFAULT_STEPS) {
    writeFileSync(
      join(repoRoot, "commands", "pipeline", `pipeline-${s.id}.md`),
      `---\ndescription: ${s.id}\n---\n# ${s.id} 본문\n`,
    );
  }
  writeFileSync(join(repoRoot, "commands", "pipeline", "_CONTRACT.md"), "# 계약\n");
  writeFileSync(
    join(repoRoot, "commands", "pipeline", "_GENERIC_STEP.md"),
    "---\ndescription: 커스텀 — {{STEP_LABEL}}\n---\n# /pipeline-{{STEP_ID}}\n\n{{USER_INSTRUCTIONS}}\n",
  );
  writeFileSync(join(repoRoot, "templates", "PRD.template.md"), "# PRD 원본\n");
  setupDir = mkdtempSync(join(tmpdir(), "setup-web-"));
  // 실제 페이지와 동일하게 script 태그 포함(브라우저 서브리소스 로드 검증용)
  writeFileSync(
    join(setupDir, "index.html"),
    '<h1>setup</h1>\n<script type="module" src="/setup/setup.js"></script>',
  );
  writeFileSync(join(setupDir, "setup.js"), "// js");
  relay = await startRelayServer(0, undefined, {
    admin: {
      key: KEY, configRoot, repoRoot, setupDir,
      getInfo: () => ({ id: "testuser", url: "https://x.example" }),
    },
  });
  base = `http://127.0.0.1:${relay.port}`;
});
afterEach(async () => {
  await relay.close();
  rmSync(configRoot, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("게이트", () => {
  it("키 없이/틀린 키는 401, ?k=로 페이지 진입 가능", async () => {
    expect((await fetch(`${base}/setup/api/info`)).status).toBe(401);
    expect((await fetch(`${base}/setup/api/info`, { headers: { "x-admin-key": "wrong" } })).status).toBe(401);
    const page = await fetch(`${base}/setup?k=${KEY}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("setup");
    expect((await fetch(`${base}/setup?k=wrong`)).status).toBe(401);
  });

  it("API 경로는 ?k=가 정상 키여도 거부 — 헤더만 인정", async () => {
    const r = await fetch(`${base}/setup/api/info?k=${KEY}`);
    expect(r.status).toBe(401);
  });

  it("401 응답에 content-type: text/plain; charset=utf-8가 있다(계획③ 이월)", async () => {
    const r = await fetch(`${base}/setup/api/info`);
    expect(r.status).toBe(401);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("페이지의 script src는 브라우저 서브리소스 요청(헤더 없음)으로도 200이다", async () => {
    // 브라우저의 <script src> 요청은 x-admin-key 헤더를 실을 수 없다 — 서빙된 HTML이
    // 참조하는 src를 그대로(추가 쿼리·헤더 없이) 요청했을 때 로드돼야 페이지 JS가 산다.
    const html = await (await fetch(`${base}/setup?k=${KEY}`)).text();
    const m = html.match(/<script[^>]*src="([^"]+)"/);
    expect(m).not.toBeNull();
    const js = await fetch(`${base}${m![1]}`);
    expect(js.status).toBe(200);
  });

  it("정적 페이지 응답에 Referrer-Policy: no-referrer가 있다", async () => {
    const page = await fetch(`${base}/setup?k=${KEY}`);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    const js = await fetch(`${base}/setup/setup.js?k=${KEY}`);
    expect(js.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("정적 자산 부재(계획③ 이월)", () => {
  it("index.html이 없으면 프로세스 죽지 않고 500 fail 응답", async () => {
    rmSync(join(setupDir, "index.html"));
    const r = await fetch(`${base}/setup?k=${KEY}`);
    expect(r.status).toBe(500);
    const j = await r.json();
    expect(j.ok).toBe(false);
  });
  it("setup.js가 없으면 프로세스 죽지 않고 500 fail 응답", async () => {
    rmSync(join(setupDir, "setup.js"));
    const r = await fetch(`${base}/setup/setup.js?k=${KEY}`);
    expect(r.status).toBe(500);
    const j = await r.json();
    expect(j.ok).toBe(false);
  });
});

describe("413", () => {
  it("256KB 초과 POST 본문은 413 + JSON 응답을 실제로 받는다(소켓 파괴 없이)", async () => {
    const big = "x".repeat(300 * 1024);
    const r = await api("/setup/api/account", { method: "POST", body: JSON.stringify({ id: "a", password: big }) });
    expect(r.status).toBe(413);
    const j = await r.json();
    expect(j.ok).toBe(false);
  });
});

describe("info / account", () => {
  it("info는 id·링크·QR data URI를 준다", async () => {
    const r = await (await api("/setup/api/info")).json();
    expect(r.ok).toBe(true);
    expect(r.id).toBe("testuser");
    expect(r.link).toBe("https://x.example/#id=testuser");
    expect(r.qr).toMatch(/^data:image\/png;base64,/);
  });
  it("account GET은 id만(비밀번호 금지), POST는 검증·저장", async () => {
    const before = await (await api("/setup/api/account")).json();
    expect(before.ok).toBe(true);
    expect(JSON.stringify(before)).not.toContain("password");
    const bad = await (await api("/setup/api/account", { method: "POST", body: JSON.stringify({ id: "  ", password: "pw1234" }) })).json();
    expect(bad.ok).toBe(false);
    const good = await (await api("/setup/api/account", { method: "POST", body: JSON.stringify({ id: "Newid", password: "pw1234" }) })).json();
    expect(good.ok).toBe(true);
    expect(readRelayAuth(configRoot)).toEqual({ id: "newid", password: "pw1234" });
  });
});

describe("파이프라인 템플릿 API", () => {
  it("목록→복제→스텝 저장→프롬프트 편집→삭제 왕복", async () => {
    let r = await (await api("/setup/api/templates")).json();
    expect(r.templates[0].id).toBe("idea-lab");
    r = await (await api("/setup/api/templates/create", {
      method: "POST", body: JSON.stringify({ name: "빈 작업" }),
    })).json();
    expect(r.ok).toBe(true);
    expect(r.template.basedOn).toBeNull();
    r = await (await api("/setup/api/templates/clone", { method: "POST", body: JSON.stringify({ basedOn: "idea-lab", name: "관리자 곁가지" }) })).json();
    expect(r.ok).toBe(true);
    const tid = r.templates.find((t: { basedOn: string | null }) => t.basedOn === "idea-lab").id;
    r = await (await api("/setup/api/templates/steps", { method: "POST", body: JSON.stringify({ id: tid, steps: [{ id: "ideation", label: "아이디어", kind: "builtin" }, { label: "market check", kind: "custom" }] }) })).json();
    expect(r.ok).toBe(true);
    r = await (await api("/setup/api/templates/prompt", { method: "POST", body: JSON.stringify({ id: tid, stepId: "market-check", body: "시장 조사\n" }) })).json();
    expect(r.ok).toBe(true);
    r = await (await api(`/setup/api/templates/prompt?id=${tid}&stepId=market-check`)).json();
    expect(r.body).toContain("시장 조사");
    r = await (await api("/setup/api/templates/delete", { method: "POST", body: JSON.stringify({ id: tid }) })).json();
    expect(r.ok).toBe(true);
  });
  it("default 수정은 거부된다", async () => {
    const r = await (await api("/setup/api/templates/steps", { method: "POST", body: JSON.stringify({ id: "default", steps: [{ label: "x", kind: "custom" }] }) })).json();
    expect(r.ok).toBe(false);
  });
});

describe("산출물 템플릿 API", () => {
  it("목록→수정(백업 생성)→복원 왕복, 경로 탈출·비대상 거부", async () => {
    let r = await (await api("/setup/api/doc-templates")).json();
    expect(r.files.some((f: { name: string }) => f.name === "PRD.template.md")).toBe(true);
    r = await (await api("/setup/api/doc-templates/put", { method: "POST", body: JSON.stringify({ name: "PRD.template.md", content: "# 수정본\n" }) })).json();
    expect(r.ok).toBe(true);
    expect(readFileSync(join(repoRoot, "templates", ".orig", "PRD.template.md"), "utf8")).toContain("원본");
    expect(readFileSync(join(repoRoot, "templates", "PRD.template.md"), "utf8")).toContain("수정본");
    r = await (await api("/setup/api/doc-templates")).json();
    expect(r.files.find((f: { name: string }) => f.name === "PRD.template.md").customized).toBe(true);
    r = await (await api("/setup/api/doc-templates/reset", { method: "POST", body: JSON.stringify({ name: "PRD.template.md" }) })).json();
    expect(r.ok).toBe(true);
    expect(readFileSync(join(repoRoot, "templates", "PRD.template.md"), "utf8")).toContain("원본");
    for (const name of ["../secret.md", "ideas-index.schema.json", "flutter-starter"]) {
      const bad = await (await api("/setup/api/doc-templates/get?name=" + encodeURIComponent(name))).json();
      expect(bad.ok).toBe(false);
    }
  });
  it("md인데 '## ' 섹션 헤더가 없으면 저장은 하되 응답에 warning을 담는다(계획③ 이월)", async () => {
    const r = await (await api("/setup/api/doc-templates/put", {
      method: "POST",
      body: JSON.stringify({ name: "PRD.template.md", content: "그냥 문단만 있는 내용\n" }),
    })).json();
    expect(r.ok).toBe(true);
    expect(r.warning).toBe("섹션 헤더가 없어요 — 서식이 깨졌을 수 있어요");
    // 저장 자체는 수행된다
    expect(readFileSync(join(repoRoot, "templates", "PRD.template.md"), "utf8")).toContain("그냥 문단만");
  });
  it("'## ' 헤더가 있으면 warning이 없다", async () => {
    const r = await (await api("/setup/api/doc-templates/put", {
      method: "POST",
      body: JSON.stringify({ name: "PRD.template.md", content: "## 개요\n내용\n" }),
    })).json();
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
  });
});
