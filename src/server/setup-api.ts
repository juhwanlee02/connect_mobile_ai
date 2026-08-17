// /setup 관리 페이지: loopback + 실행별 관리키 이중 게이트(스펙 §3.4).
// 터널로는 절대 도달 불가 — 원격 주소가 loopback이 아니면 무조건 404.
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { readRelayAuth, writeRelayAuth } from "../shared/auth-store.js";
import {
  listTemplates, cloneTemplate, createTemplate, deleteTemplate, setTemplateSteps,
  getStepPrompt, setStepPrompt, resetStepPrompt, type TplStoreOpts, type TplResult,
} from "../shared/template-store.js";

export interface AdminOpts {
  key: string;
  configRoot: string;
  repoRoot: string;
  setupDir: string;
  getInfo: () => { id: string; url: string | null };
}

const MAX_BODY = 256 * 1024;

function isLoopback(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
const fail = (res: ServerResponse, error: string, status = 400) =>
  json(res, status, { ok: false, error });

function tplOpts(admin: AdminOpts): TplStoreOpts {
  return { repoRoot: admin.repoRoot, pipelinesRoot: join(admin.configRoot, "pipelines") };
}

function tplFail(res: ServerResponse, r: TplResult<unknown>): void {
  if (!r.ok) fail(res, r.error);
}

// templates/ 바로 아래 .md/.html 파일만 편집 대상(스펙 §3.3). 이름 검증+멤버십으로 경로 탈출 차단.
const DOC_NAME_RE = /^[A-Za-z0-9._-]+$/;
function docTemplatesDir(admin: AdminOpts): string { return join(admin.repoRoot, "templates"); }
function listDocTemplates(admin: AdminOpts): Array<{ name: string; customized: boolean }> {
  const dir = docTemplatesDir(admin);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && DOC_NAME_RE.test(e.name) && (e.name.endsWith(".md") || e.name.endsWith(".html")))
    .map((e) => ({ name: e.name, customized: existsSync(join(dir, ".orig", e.name)) }));
}
function resolveDocTemplate(admin: AdminOpts, raw: unknown): string | null {
  const name = String(raw ?? "");
  return listDocTemplates(admin).some((f) => f.name === name) ? name : null;
}

function readBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    let size = 0;
    let overLimit = false;
    let settled = false;
    const chunks: Buffer[] = [];
    const finish = (v: unknown | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        // 상한 초과: 이후 chunk는 버퍼링만 중단하고 호출자에게 알린다.
        // 소켓은 살려둬야 fail(res, ..., 413) 응답이 클라이언트로 flush된다.
        // 남은 본문은 버리되(drain) 소켓 자체는 파괴하지 않는다.
        overLimit = true;
        finish(undefined);
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (overLimit) return;
      try { finish(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { finish(null); }
    });
    req.on("error", () => finish(null));
  });
}

export async function handleSetupRequest(
  req: IncomingMessage, res: ServerResponse, admin: AdminOpts,
): Promise<boolean> {
  const [rawPath, queryStr = ""] = (req.url ?? "/").split("?");
  if (rawPath !== "/setup" && !rawPath.startsWith("/setup/")) return false;
  // 게이트 ①: loopback이 아니면 존재 자체를 숨긴다
  if (!isLoopback(req)) { res.writeHead(404); res.end(); return true; }
  // 게이트 ②: 관리키 — 정적 페이지는 ?k= 허용(+헤더), API는 x-admin-key 헤더만.
  // ?k=는 로그·브라우저 히스토리에 남으므로 유출면을 넓히지 않기 위해 API에는 쓰지 않는다.
  const isStaticPage = rawPath === "/setup" || rawPath === "/setup/" || rawPath === "/setup/setup.js";
  const headerKey = String(req.headers["x-admin-key"] ?? "");
  const key = isStaticPage ? (new URLSearchParams(queryStr).get("k") ?? headerKey) : headerKey;
  if (key !== admin.key) {
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    res.end("관리키가 올바르지 않아요");
    return true;
  }

  // 정적 페이지 — 키가 URL(?k=)에 남을 수 있으므로 no-referrer(relay.ts /preview와 동일 정책).
  // readFileSync 실패(파일 부재·권한 등)가 프로세스를 죽이지 않도록 try/catch → 500 fail.
  if (rawPath === "/setup" || rawPath === "/setup/") {
    try {
      // 브라우저의 <script src> 서브리소스 요청은 x-admin-key 헤더를 실을 수 없으므로
      // 서빙 시점에 관리키를 주입한다(페이지 URL에 이미 ?k=가 있고 no-referrer라 노출면 동일).
      const html = readFileSync(join(admin.setupDir, "index.html"), "utf8")
        .replace('src="/setup/setup.js"', `src="/setup/setup.js?k=${admin.key}"`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer" });
      res.end(html);
    } catch (e) {
      fail(res, "설정 페이지를 불러오지 못했어요: " + (e instanceof Error ? e.message : String(e)), 500);
    }
    return true;
  }
  if (rawPath === "/setup/setup.js") {
    try {
      const js = readFileSync(join(admin.setupDir, "setup.js"));
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "referrer-policy": "no-referrer" });
      res.end(js);
    } catch (e) {
      fail(res, "설정 스크립트를 불러오지 못했어요: " + (e instanceof Error ? e.message : String(e)), 500);
    }
    return true;
  }

  // ---------- JSON API ----------
  const body = req.method === "POST" ? await readBody(req) : null;
  if (req.method === "POST" && body === undefined) { fail(res, "요청이 너무 커요", 413); return true; }
  const o = (body ?? {}) as Record<string, unknown>;

  try {
    if (rawPath === "/setup/api/info") {
      const { id, url } = admin.getInfo();
      const link = url ? `${url}/#id=${encodeURIComponent(id)}` : null;
      const qr = link ? await QRCode.toDataURL(link, { margin: 1, width: 240 }) : null;
      json(res, 200, { ok: true, id, url, link, qr });
      return true;
    }
    if (rawPath === "/setup/api/account" && req.method === "GET") {
      const auth = readRelayAuth(admin.configRoot);
      json(res, 200, { ok: true, id: auth?.id ?? null });
      return true;
    }
    if (rawPath === "/setup/api/account" && req.method === "POST") {
      try {
        const auth = writeRelayAuth(admin.configRoot, {
          id: String(o.id ?? ""), password: String(o.password ?? ""),
        });
        json(res, 200, { ok: true, id: auth.id });
      } catch (e) {
        fail(res, e instanceof Error ? e.message : String(e));
      }
      return true;
    }

    // ---------- 파이프라인 템플릿(shared/template-store 위임) ----------
    if (rawPath === "/setup/api/templates" && req.method === "GET") {
      json(res, 200, { ok: true, templates: listTemplates(tplOpts(admin)) });
      return true;
    }
    if (rawPath === "/setup/api/templates/clone" && req.method === "POST") {
      const r = cloneTemplate(tplOpts(admin), String(o.basedOn ?? ""), String(o.name ?? ""));
      if (r.ok) json(res, 200, { ok: true, template: r.value, templates: listTemplates(tplOpts(admin)) });
      else tplFail(res, r);
      return true;
    }
    if (rawPath === "/setup/api/templates/create" && req.method === "POST") {
      const r = createTemplate(tplOpts(admin), String(o.name ?? ""));
      if (r.ok) json(res, 200, { ok: true, template: r.value, templates: listTemplates(tplOpts(admin)) });
      else tplFail(res, r);
      return true;
    }
    if (rawPath === "/setup/api/templates/delete" && req.method === "POST") {
      const r = deleteTemplate(tplOpts(admin), String(o.id ?? ""));
      if (r.ok) json(res, 200, { ok: true, templates: listTemplates(tplOpts(admin)) });
      else tplFail(res, r);
      return true;
    }
    if (rawPath === "/setup/api/templates/steps" && req.method === "POST") {
      const r = setTemplateSteps(
        tplOpts(admin), String(o.id ?? ""),
        Array.isArray(o.steps) ? (o.steps as Array<{ id?: string; label: string; kind: string }>) : [],
      );
      if (r.ok) json(res, 200, { ok: true, template: r.value, templates: listTemplates(tplOpts(admin)) });
      else tplFail(res, r);
      return true;
    }
    if (rawPath === "/setup/api/templates/prompt" && req.method === "GET") {
      const qs = new URLSearchParams(queryStr);
      const r = getStepPrompt(tplOpts(admin), qs.get("id") ?? "", qs.get("stepId") ?? "");
      if (r.ok) json(res, 200, { ok: true, ...r.value });
      else tplFail(res, r);
      return true;
    }
    if (rawPath === "/setup/api/templates/prompt" && req.method === "POST") {
      const r = setStepPrompt(tplOpts(admin), String(o.id ?? ""), String(o.stepId ?? ""), String(o.body ?? ""));
      if (r.ok) json(res, 200, { ok: true });
      else tplFail(res, r);
      return true;
    }
    if (rawPath === "/setup/api/templates/prompt-reset" && req.method === "POST") {
      const r = resetStepPrompt(tplOpts(admin), String(o.id ?? ""), String(o.stepId ?? ""));
      if (r.ok) json(res, 200, { ok: true });
      else tplFail(res, r);
      return true;
    }

    // ---------- 산출물 템플릿(templates/ 루트 .md/.html, .orig 백업/복원) ----------
    if (rawPath === "/setup/api/doc-templates" && req.method === "GET") {
      json(res, 200, { ok: true, files: listDocTemplates(admin) });
      return true;
    }
    if (rawPath === "/setup/api/doc-templates/get" && req.method === "GET") {
      const name = resolveDocTemplate(admin, new URLSearchParams(queryStr).get("name"));
      if (!name) { fail(res, "대상을 찾을 수 없어요"); return true; }
      const content = readFileSync(join(docTemplatesDir(admin), name), "utf8");
      json(res, 200, { ok: true, content });
      return true;
    }
    if (rawPath === "/setup/api/doc-templates/put" && req.method === "POST") {
      const name = resolveDocTemplate(admin, o.name);
      if (!name) { fail(res, "대상을 찾을 수 없어요"); return true; }
      const content = o.content;
      if (typeof content !== "string") { fail(res, "내용이 올바르지 않아요"); return true; }
      const dir = docTemplatesDir(admin);
      const target = join(dir, name);
      const origDir = join(dir, ".orig");
      const origPath = join(origDir, name);
      if (!existsSync(origPath)) {
        try {
          mkdirSync(origDir, { recursive: true });
          cpSync(target, origPath);
        } catch (e) {
          fail(res, "백업 실패로 저장을 중단했어요: " + (e instanceof Error ? e.message : String(e)));
          return true;
        }
      }
      const tmp = `${target}.tmp-${process.pid}`;
      writeFileSync(tmp, content);
      renameSync(tmp, target);
      // md인데 섹션 헤더("## ")가 하나도 없으면 서식 붕괴 가능성 경고(저장은 이미 수행됨).
      const warning = name.endsWith(".md") && !content.includes("## ")
        ? "섹션 헤더가 없어요 — 서식이 깨졌을 수 있어요"
        : undefined;
      json(res, 200, { ok: true, files: listDocTemplates(admin), ...(warning ? { warning } : {}) });
      return true;
    }
    if (rawPath === "/setup/api/doc-templates/reset" && req.method === "POST") {
      const name = resolveDocTemplate(admin, o.name);
      if (!name) { fail(res, "대상을 찾을 수 없어요"); return true; }
      const dir = docTemplatesDir(admin);
      const origPath = join(dir, ".orig", name);
      if (!existsSync(origPath)) { fail(res, "백업이 없어요 — 수정한 적이 없나 봐요"); return true; }
      cpSync(origPath, join(dir, name));
      json(res, 200, { ok: true, files: listDocTemplates(admin) });
      return true;
    }

    res.writeHead(404); res.end(); return true;
  } catch (e) {
    fail(res, "처리 중 오류: " + (e instanceof Error ? e.message : String(e)), 500);
    return true;
  }
}
