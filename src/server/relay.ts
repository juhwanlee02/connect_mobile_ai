import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { CodeMsg, ErrorMsg, PairedMsg } from "../shared/protocol.js";
import { handleSetupRequest, type AdminOpts } from "./setup-api.js";

export interface RelayHandle {
  port: number;
  close: () => Promise<void>;
  // 테스트 전용: code에 매인 host 소켓을 서버 쪽에서 강제 종료(재연결 시나리오 시뮬레이션용).
  // 세션이 없거나 host가 없으면 false.
  terminateHostForTest?: (code: string) => boolean;
}

interface Session {
  host?: WebSocket;
  phone?: WebSocket;
  // host 부재 TTL 정리 타이머(host가 재연결하면 clear됨).
  hostAwayTimer?: NodeJS.Timeout;
  // 세션 재획득용 host 전용 비밀(고엔트로피 랜덤). code는 폰에도 노출되는 공개
  // 식별자라서 code만으로 재획득을 허용하면 code를 아는 제3자가 살아있는 host를
  // 무통지로 밀어낼 수 있다(세션 하이재킹). 재획득은 이 키가 일치할 때만 허용한다.
  reconnectKey: string;
  // /preview/** HTTP 서빙 인증용 세션별 서명 토큰(고엔트로피 랜덤). reconnectKey와
  // 달리 폰에도 전달된다(code·paired 메시지 양쪽) — 폰이 preview/뷰어 URL에
  // ?t=<token>으로 부착해 1회 검증받고 이후엔 발급된 쿠키로 서브리소스를 받는다.
  previewToken: string;
  // 폰 자동 로그인용 세션 토큰(paired로 폰에 전달, localStorage 저장).
  // 세션 수명 한정 — 릴레이 재시작이면 무효(스펙 §8).
  phoneToken: string;
}

// host 부재(재연결 대기) 세션을 정리하기까지의 유예 시간. 이 시간 안에 같은
// code로 재연결하면 세션(코드·폰 연결)을 그대로 재획득한다.
const DEFAULT_HOST_TTL_MS = 10 * 60 * 1000;
// 이미지 3개 × 4MB의 base64 오버헤드와 JSON 메타데이터를 수용하되 무제한 payload는 막는다.
const MAX_WS_PAYLOAD_BYTES = 20 * 1024 * 1024;

// 수익화 seam: 나중에 plan/limit 검사를 여기에 붙인다.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Fix C: extension → MIME type map
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function generateCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

// host 전용 재연결 비밀. crypto.randomBytes로 생성(Math.random 금지 — 예측 가능한
// PRNG로 재연결 키를 만들면 하이재킹 방지 목적이 무력화된다). 64자 hex(32바이트).
function generateReconnectKey(): string {
  return randomBytes(32).toString("hex");
}

// /preview/** 서빙 인증용 세션 토큰. crypto.randomBytes로 생성(위조 방지).
function generatePreviewToken(): string {
  return randomBytes(32).toString("hex");
}

// 폰 자동 로그인용 세션 토큰(paired로 폰에 전달, localStorage 저장).
// 세션 수명 한정 — 릴레이 재시작이면 무효(스펙 §8).
function generatePhoneToken(): string {
  return randomBytes(32).toString("hex");
}

// preview 인증 쿠키 이름. Path=/preview로 스코프되어 다른 경로로는 전송되지 않는다.
const PREVIEW_COOKIE = "cpmc_pt";

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

// Fix A: safe forward — only sends if the target socket is open
function forward(target: WebSocket | undefined, data: string): void {
  if (target && target.readyState === WebSocket.OPEN) {
    target.send(data);
  }
}

function safeSend(target: WebSocket | undefined, msg: unknown): void {
  if (target && target.readyState === WebSocket.OPEN) {
    target.send(JSON.stringify(msg));
  }
}

export function startRelayServer(
  port: number,
  staticDir?: string,
  opts?: {
    heartbeatMs?: number;
    password?: string;
    previewDir?: string;
    // host 부재 세션 정리 TTL(ms). 테스트에서 짧은 값 주입 가능. 기본 10분.
    hostTtlMs?: number;
    // ID/비밀번호 로그인(스펙 §1)용 자격증명 콜백. 로그인 시도마다 호출되므로
    // 캐시하지 말 것 — 자격증명 변경이 즉시 반영돼야 한다. 초기 설정 전이면
    // undefined를 반환한다.
    getPhoneAuth?: () => { id: string; password: string } | undefined;
    // /setup 관리 페이지(스펙 §3.4). 지정 시 loopback+관리키 게이트 뒤에서
    // handleSetupRequest가 정적 서빙/API를 위임 처리한다.
    admin?: AdminOpts;
  },
): Promise<RelayHandle> {
  // 세션은 host 식별(코드) 단위로 유지된다: host 소켓이 끊겨도 세션은 즉시 지우지
  // 않고, hostTtlMs 동안 재연결(같은 code 제시)을 기다린 뒤에만 정리한다.
  const sessions = new Map<string, Session>();
  const heartbeatMs = opts?.heartbeatMs ?? 30000;
  const password = opts?.password;
  const previewDir = opts?.previewDir;
  const hostTtlMs = opts?.hostTtlMs ?? DEFAULT_HOST_TTL_MS;
  const getPhoneAuth = opts?.getPhoneAuth;

  // 세션 저장 토큰과 상등이면 통과(단일 사용자 모델 — 어느 세션의 토큰이든 유효).
  // 세션이 삭제되면(TTL 만료 등) 그 토큰도 즉시 무효가 된다.
  // ⚠️ 단일 사용자 모델 전제 — 모든 라이브 세션의 previewToken을 유효로 간주.
  // 스펙 §4 로드맵의 상시 원격 릴레이(공유형)로 전환 시 세션별 토큰 격리로 재검토 필요
  // (현재는 1호스트-1릴레이라 세션 간 격리 불요).
  function isValidPreviewToken(token: string | undefined): boolean {
    if (!token) return false;
    for (const s of sessions.values()) {
      if (s.previewToken === token) return true;
    }
    return false;
  }

  const httpServer: Server = createServer(async (req, res) => {
    if (opts?.admin && (await handleSetupRequest(req, res, opts.admin))) return;

    const rawPath = (req.url ?? "/").split("?")[0];
    const queryStr = (req.url ?? "/").split("?")[1] ?? "";
    const query = new URLSearchParams(queryStr);

    // /preview/** 서빙 인증(스펙 §4·§12.2): 무인증 예외 없음. 쿠키에 유효 토큰이
    // 있으면 통과, 없으면 ?t=<token> 쿼리를 검증해 통과 시 HttpOnly 쿠키를 발급한다.
    // 둘 다 없거나 무효면 403(경로 존재 여부와 무관 — 전 구간에 동일 적용).
    if (rawPath.startsWith("/preview/")) {
      const cookies = parseCookies(req.headers.cookie);
      const cookieToken = cookies[PREVIEW_COOKIE];
      if (cookieToken && isValidPreviewToken(cookieToken)) {
        // 쿠키만으로 이미 인증됨 — 재발급 불필요
      } else {
        const queryToken = query.get("t") ?? undefined;
        if (queryToken && isValidPreviewToken(queryToken)) {
          res.setHeader("Referrer-Policy", "no-referrer");
          res.setHeader(
            "Set-Cookie",
            `${PREVIEW_COOKIE}=${queryToken}; HttpOnly; Path=/preview; SameSite=Lax`,
          );
        } else {
          res.writeHead(403);
          res.end();
          return;
        }
      }
    }

    // /preview/<name>/<rest> → <previewDir>/<name>/public/<rest>, 그 외 → staticDir
    let baseDir: string | undefined;
    let rel = "/";
    if (rawPath.startsWith("/preview/")) {
      const SERVE_DIRS = new Set(["wireframe", "mockup", "preview", "release"]);
      const sub = rawPath.slice("/preview/".length);
      const i = sub.indexOf("/");
      const name = i === -1 ? sub : sub.slice(0, i);
      const rest = i === -1 ? "/" : sub.slice(i);
      if (previewDir && name) {
        const seg = rest.split("/").filter(Boolean)[0];
        if (seg && SERVE_DIRS.has(seg)) {
          baseDir = join(previewDir, name, seg);
          rel = rest.slice(seg.length + 1) || "/";
        } else {
          baseDir = join(previewDir, name, "public");
          rel = rest;
        }
      }
    } else {
      baseDir = staticDir;
      rel = rawPath;
    }

    if (!baseDir) {
      res.writeHead(404);
      res.end();
      return;
    }

    const relFile = rel === "/" ? "/index.html" : rel;
    const filePath = normalize(join(baseDir, relFile));
    if (!filePath.startsWith(normalize(baseDir))) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(filePath);
      const dot = filePath.lastIndexOf(".");
      const ext = dot === -1 ? "" : filePath.slice(dot).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      const headers: Record<string, string> = { "content-type": contentType };
      if (rawPath.startsWith("/preview/")) {
        headers["referrer-policy"] = "no-referrer";
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const live = client as WebSocket & { isAlive?: boolean };
      if (live.isAlive === false) {
        client.terminate();
        continue;
      }
      live.isAlive = false;
      client.ping();
    }
  }, heartbeatMs);

  wss.on("connection", (ws, req) => {
    const live = ws as WebSocket & { isAlive?: boolean };
    live.isAlive = true;
    ws.on("pong", () => {
      live.isAlive = true;
    });
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/host") {
      if (password !== undefined && url.searchParams.get("secret") !== password) {
        send(ws, { type: "error", text: "인증 실패" } satisfies ErrorMsg);
        ws.close();
        return;
      }
      // 세션 재획득: host가 이전에 받은 code와 함께, host에게만 전달됐던
      // reconnectKey를 ?code=&reconnectKey=로 제시하고 그 세션의 저장된 키와
      // 일치할 때만(아직 TTL 안에 있는 세션이면) 같은 세션(코드·폰 연결)을 그대로
      // 이어받는다. code는 폰에도 노출되는 공개 식별자이므로, code만 아는 제3자가
      // reconnectKey 없이/틀리게 제시하면 절대 재획득을 허용하지 않고 항상 신규
      // 세션을 발급한다(기존 세션은 건드리지 않음 — 하이재킹 방지).
      const presentedCode = url.searchParams.get("code");
      const presentedKey = url.searchParams.get("reconnectKey");
      let code: string;
      let session: Session;
      const existing = presentedCode ? sessions.get(presentedCode) : undefined;
      const keyMatches =
        !!existing && !!presentedKey && presentedKey === existing.reconnectKey;
      if (presentedCode && existing && keyMatches) {
        code = presentedCode;
        session = existing;
        if (session.hostAwayTimer) {
          clearTimeout(session.hostAwayTimer);
          session.hostAwayTimer = undefined;
        }
        // 정당 host(reconnectKey 일치)의 중복 접속: 기존 host 소켓이 아직 살아
        // 있으면(예: 재시작 중 이전 소켓이 아직 안 끊긴 경우) 새 소켓으로 교체하기
        // 전에 통지 후 종료한다(self-eviction — 밀려나는 쪽도 같은 host이므로 정당).
        if (session.host && session.host.readyState === WebSocket.OPEN) {
          safeSend(session.host, {
            type: "error",
            text: "다른 곳에서 같은 세션으로 재연결되어 이 연결은 종료됩니다",
          } satisfies ErrorMsg);
          session.host.terminate();
        }
        session.host = ws;
      } else {
        // Fix B: collision-free code generation
        code = generateCode();
        while (sessions.has(code)) code = generateCode();
        session = {
          host: ws,
          reconnectKey: generateReconnectKey(),
          previewToken: generatePreviewToken(),
          phoneToken: generatePhoneToken(),
        };
        sessions.set(code, session);
      }
      // reconnectKey는 host에게만 전달된다 — 폰이 받는 어떤 메시지(paired 등)에도
      // 절대 포함하지 않는다. previewToken은 반대로 폰에도 전달돼야 하므로(paired)
      // host 전용이 아니다.
      send(
        ws,
        { type: "code", code, reconnectKey: session.reconnectKey, token: session.previewToken } satisfies CodeMsg,
      );
      ws.on("message", (data) => {
        // Fix A: guard against sending to a closed phone socket
        forward(sessions.get(code)?.phone, data.toString());
      });
      ws.on("close", () => {
        const s = sessions.get(code);
        // 재연결로 이미 새 host 소켓이 들어와 있으면(stale close), 이 핸들러는 무시한다.
        if (!s || s.host !== ws) return;
        s.host = undefined;
        safeSend(s.phone, {
          type: "error",
          text: "PC 연결이 잠시 끊겼어요 — 자동 재연결 중",
        } satisfies ErrorMsg);
        s.hostAwayTimer = setTimeout(() => {
          const cur = sessions.get(code);
          if (cur && !cur.host) {
            safeSend(cur.phone, { type: "error", text: "세션이 만료되었습니다" } satisfies ErrorMsg);
            cur.phone?.close();
            sessions.delete(code);
          }
        }, hostTtlMs);
      });
      return;
    }

    if (url.pathname === "/phone") {
      const code = url.searchParams.get("code") ?? "";
      const presentedToken = url.searchParams.get("phoneToken") ?? "";
      let session: Session | undefined;
      if (code) {
        // 레거시 경로(코드 페어링): dev·기존 계약 유지 — 공유 비밀 대조
        if (password !== undefined && url.searchParams.get("secret") !== password) {
          send(ws, { type: "error", text: "인증 실패" } satisfies ErrorMsg);
          ws.close();
          return;
        }
        session = sessions.get(code);
        if (!session) {
          send(ws, { type: "error", text: "유효하지 않은 코드" } satisfies ErrorMsg);
          ws.close();
          return;
        }
      } else if (presentedToken) {
        // 자동 로그인: 세션 저장 phoneToken 상등(고엔트로피). 세션 소멸 = 토큰 무효.
        for (const s of sessions.values()) {
          if (s.phoneToken === presentedToken) session = s;
        }
        if (!session) {
          send(ws, { type: "error", text: "세션이 만료됐어요 — 다시 로그인해 주세요" } satisfies ErrorMsg);
          ws.close();
          return;
        }
      } else {
        // ID/비밀번호 로그인(스펙 §1): 코드 개념 없이 유일한 활성 host 세션에 붙인다.
        const auth = getPhoneAuth?.();
        if (!auth) {
          send(ws, { type: "error", text: "PC에서 초기 설정을 먼저 완료해 주세요" } satisfies ErrorMsg);
          ws.close();
          return;
        }
        const id = url.searchParams.get("id") ?? "";
        const secret = url.searchParams.get("secret") ?? "";
        if (id !== auth.id || secret !== auth.password) {
          send(ws, { type: "error", text: "아이디 또는 비밀번호가 올바르지 않아요" } satisfies ErrorMsg);
          ws.close();
          return;
        }
        // 재연결 유예로 세션이 2개 이상일 수 있음 — host 소켓이 살아있는 최신 세션(삽입순 마지막)
        for (const s of sessions.values()) {
          if (s.host && s.host.readyState === WebSocket.OPEN) session = s;
        }
        if (!session) {
          send(ws, { type: "error", text: "PC가 아직 준비되지 않았어요 — 잠시 후 다시 시도하세요" } satisfies ErrorMsg);
          ws.close();
          return;
        }
      }
      if (session.phone && session.phone.readyState === WebSocket.OPEN) {
        send(ws, { type: "error", text: "이미 다른 기기가 연결되어 있습니다" } satisfies ErrorMsg);
        ws.close();
        return;
      }
      const sess = session; // code 없는 경로도 있으므로 세션 객체로 캡처(호스트 스왑은 같은 객체를 공유)
      sess.phone = ws;
      send(ws, { type: "paired", token: sess.previewToken, phoneToken: sess.phoneToken } satisfies PairedMsg);
      ws.on("message", (data) => {
        forward(sess.host, data.toString());
      });
      ws.on("close", () => {
        if (sess.phone === ws) sess.phone = undefined;
      });
      return;
    }

    ws.close();
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: actualPort,
        close: () =>
          new Promise((res) => {
            clearInterval(heartbeat);
            // 대기 중인 host 부재 TTL 타이머도 정리(테스트/프로세스 종료 시 누수 방지)
            for (const s of sessions.values()) {
              if (s.hostAwayTimer) clearTimeout(s.hostAwayTimer);
            }
            // Terminate all open clients so wss.close() resolves immediately
            for (const client of wss.clients) client.terminate();
            wss.close(() => httpServer.close(() => res()));
          }),
        terminateHostForTest: (code: string) => {
          const s = sessions.get(code);
          if (!s?.host) return false;
          s.host.terminate();
          return true;
        },
      });
    });
  });
}
