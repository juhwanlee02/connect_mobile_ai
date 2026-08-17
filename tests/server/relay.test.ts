import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { startRelayServer, type RelayHandle } from "../../src/server/relay.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let handle: RelayHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
}

describe("relay pairing", () => {
  it("host가 연결하면 6자 페어링 코드를 받는다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const msg = await nextMessage(host);
    expect(msg.type).toBe("code");
    expect(typeof msg.code).toBe("string");
    expect(msg.code).toHaveLength(6);
    host.close();
  });

  it("폰이 올바른 코드로 참가하면 paired를 받고, 양방향 전달된다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code } = await nextMessage(host);

    const phone = new WebSocket(
      `ws://localhost:${handle.port}/phone?code=${code}`,
    );
    expect((await nextMessage(phone)).type).toBe("paired");

    // 폰 → host
    const hostGot = nextMessage(host);
    phone.send(JSON.stringify({ type: "command", text: "hi" }));
    expect(await hostGot).toEqual({ type: "command", text: "hi" });

    // host → 폰
    const phoneGot = nextMessage(phone);
    host.send(JSON.stringify({ type: "log", text: "working" }));
    expect(await phoneGot).toEqual({ type: "log", text: "working" });

    host.close();
    phone.close();
  });

  it("잘못된 코드로 참가하면 error를 받는다", async () => {
    handle = await startRelayServer(0);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=ZZZZZZ`);
    expect((await nextMessage(phone)).type).toBe("error");
    phone.close();
  });

  it("호스트가 끊기면 폰에 재연결 안내 에러를 보내되 연결은 유지한다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await nextMessage(phone); // paired

    const errMsg = nextMessage(phone);
    const hostClosed = new Promise((r) => host.once("close", r));
    host.close();
    await hostClosed;

    const err = await errMsg;
    expect(err.type).toBe("error");
    expect(err.text).toContain("자동 재연결");
    // 세션 유지 중이므로 서버가 폰을 끊지 않는다
    await new Promise((r) => setTimeout(r, 30));
    expect(phone.readyState).toBe(WebSocket.OPEN);
    phone.close();
  });

  it("이미 폰이 연결된 세션에 두 번째 폰은 거부되고 첫 폰은 유지된다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code } = await nextMessage(host);
    const phone1 = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await nextMessage(phone1); // paired

    const phone2 = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    expect((await nextMessage(phone2)).type).toBe("error");

    // 첫 폰은 여전히 동작 (host→phone1 전달됨)
    const got = nextMessage(phone1);
    host.send(JSON.stringify({ type: "log", text: "still here" }));
    expect(await got).toEqual({ type: "log", text: "still here" });

    host.close();
    phone1.close();
  });

  it("heartbeat으로 연결된 클라이언트에 ping을 보낸다", async () => {
    handle = await startRelayServer(0, undefined, { heartbeatMs: 30 });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    await nextMessage(host); // code
    await new Promise<void>((resolve) => host.once("ping", () => resolve()));
    host.close();
  });

  it("호스트가 끊긴 뒤 폰이 보내도 서버가 죽지 않는다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await nextMessage(phone); // paired

    // 호스트 종료 후 폰이 메시지를 보낸다 → 서버가 throw 하면 안 됨
    host.close();
    await new Promise((r) => setTimeout(r, 50));
    phone.send(JSON.stringify({ type: "command", text: "after host gone" }));
    await new Promise((r) => setTimeout(r, 50));

    // 서버가 살아있으면 새 host가 여전히 코드를 받는다
    const host2 = new WebSocket(`ws://localhost:${handle.port}/host`);
    expect((await nextMessage(host2)).type).toBe("code");
    phone.close();
    host2.close();
  });
});

describe("안정 페어링 세션(host 재연결)", () => {
  it("host가 끊겼다 같은 code+reconnectKey로 재연결하면 코드 불변으로 세션을 재획득한다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code, reconnectKey } = await nextMessage(host);

    const closed = new Promise((r) => host.once("close", r));
    expect(handle.terminateHostForTest?.(code)).toBe(true);
    await closed;

    const host2 = new WebSocket(
      `ws://localhost:${handle.port}/host?code=${code}&reconnectKey=${reconnectKey}`,
    );
    const msg2 = await nextMessage(host2);
    expect(msg2.type).toBe("code");
    expect(msg2.code).toBe(code);
    host2.close();
  });

  it("host 재연결 사이 폰은 연결을 유지하고, host 복귀 후 재페어링 없이 전달이 복원된다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code, reconnectKey } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await nextMessage(phone); // paired

    const errPromise = nextMessage(phone);
    const hostClosed = new Promise((r) => host.once("close", r));
    expect(handle.terminateHostForTest?.(code)).toBe(true);
    await hostClosed;
    const err = await errPromise;
    expect(err.type).toBe("error");
    expect(err.text).toContain("자동 재연결");
    expect(phone.readyState).toBe(WebSocket.OPEN);

    // host가 같은 code+reconnectKey로 재연결
    const host2 = new WebSocket(
      `ws://localhost:${handle.port}/host?code=${code}&reconnectKey=${reconnectKey}`,
    );
    const msg2 = await nextMessage(host2);
    expect(msg2.code).toBe(code);

    // 재페어링(paired 메시지) 없이 기존 폰 소켓으로 전달이 복원된다
    const hostGot = nextMessage(host2);
    phone.send(JSON.stringify({ type: "command", text: "still alive" }));
    expect(await hostGot).toEqual({ type: "command", text: "still alive" });

    const phoneGot = nextMessage(phone);
    host2.send(JSON.stringify({ type: "log", text: "resumed" }));
    expect(await phoneGot).toEqual({ type: "log", text: "resumed" });

    host2.close();
    phone.close();
  });

  it("host 부재가 TTL을 초과하면 세션이 정리된다(짧은 TTL 주입)", async () => {
    handle = await startRelayServer(0, undefined, { hostTtlMs: 30 });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code } = await nextMessage(host);

    const hostClosed = new Promise((r) => host.once("close", r));
    expect(handle.terminateHostForTest?.(code)).toBe(true);
    await hostClosed;

    // TTL(30ms)을 넘겨서 대기
    await new Promise((r) => setTimeout(r, 150));

    // 세션이 정리됐으므로 같은 code로 재연결해도 새 코드가 발급된다
    const host2 = new WebSocket(`ws://localhost:${handle.port}/host?code=${code}`);
    const msg2 = await nextMessage(host2);
    expect(msg2.type).toBe("code");
    expect(msg2.code).not.toBe(code);
    host2.close();
  });

  it("다중 host 세션은 서로 충돌하지 않는다", async () => {
    handle = await startRelayServer(0);
    const hostA = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code: codeA, reconnectKey: keyA } = await nextMessage(hostA);
    const hostB = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code: codeB } = await nextMessage(hostB);
    expect(codeA).not.toBe(codeB);

    const closedA = new Promise((r) => hostA.once("close", r));
    expect(handle.terminateHostForTest?.(codeA)).toBe(true);
    await closedA;

    const hostA2 = new WebSocket(
      `ws://localhost:${handle.port}/host?code=${codeA}&reconnectKey=${keyA}`,
    );
    const msgA2 = await nextMessage(hostA2);
    expect(msgA2.code).toBe(codeA);

    // hostB 세션은 영향을 받지 않고 정상 동작한다
    const phoneB = new WebSocket(`ws://localhost:${handle.port}/phone?code=${codeB}`);
    await nextMessage(phoneB); // paired
    const gotB = nextMessage(hostB);
    phoneB.send(JSON.stringify({ type: "command", text: "b" }));
    expect(await gotB).toEqual({ type: "command", text: "b" });

    hostA2.close();
    hostB.close();
    phoneB.close();
  });
});

describe("세션 재획득 하이재킹 방지(reconnectKey)", () => {
  it("① 정당 host: code+올바른 reconnectKey 재접속 → 같은 세션·같은 code 재획득, 폰 연결 유지", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code, reconnectKey } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await nextMessage(phone); // paired

    const closed = new Promise((r) => host.once("close", r));
    expect(handle.terminateHostForTest?.(code)).toBe(true);
    await closed;

    const host2 = new WebSocket(
      `ws://localhost:${handle.port}/host?code=${code}&reconnectKey=${reconnectKey}`,
    );
    const msg2 = await nextMessage(host2);
    expect(msg2.type).toBe("code");
    expect(msg2.code).toBe(code);
    expect(phone.readyState).toBe(WebSocket.OPEN);

    // 재페어링 없이 전달 복원
    const hostGot = nextMessage(host2);
    phone.send(JSON.stringify({ type: "command", text: "legit" }));
    expect(await hostGot).toEqual({ type: "command", text: "legit" });

    host2.close();
    phone.close();
  });

  it("② 하이재킹 차단: code만 알고 reconnectKey가 틀리거나 없으면 기존 세션을 탈취하지 못하고 신규 세션이 발급된다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await nextMessage(phone); // paired

    // 공격자 1: reconnectKey를 아예 제시하지 않음
    const attacker1 = new WebSocket(`ws://localhost:${handle.port}/host?code=${code}`);
    const msg1 = await nextMessage(attacker1);
    expect(msg1.type).toBe("code");
    expect(msg1.code).not.toBe(code); // 기존 세션이 아니라 신규 세션(다른 code) 발급

    // 공격자 2: 틀린 reconnectKey를 제시
    const attacker2 = new WebSocket(
      `ws://localhost:${handle.port}/host?code=${code}&reconnectKey=wrong-key`,
    );
    const msg2 = await nextMessage(attacker2);
    expect(msg2.type).toBe("code");
    expect(msg2.code).not.toBe(code);

    // 정당 host 소켓은 여전히 살아있고 세션을 그대로 유지한다(밀려나지 않음)
    expect(host.readyState).toBe(WebSocket.OPEN);

    // 폰이 보낸 메시지는 여전히 정당 host로 전달된다(공격자에게 가지 않음)
    const hostGot = nextMessage(host);
    phone.send(JSON.stringify({ type: "command", text: "still legit" }));
    expect(await hostGot).toEqual({ type: "command", text: "still legit" });

    host.close();
    phone.close();
    attacker1.close();
    attacker2.close();
  });

  it("③ reconnectKey는 paired(폰) 메시지에 포함되지 않는다(폰이 key를 볼 수 없음). paired는 대신 preview 인증 토큰을 포함한다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code, reconnectKey, token } = await nextMessage(host);
    expect(typeof reconnectKey).toBe("string");
    expect(reconnectKey.length).toBeGreaterThanOrEqual(32); // 고엔트로피 랜덤
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThanOrEqual(32); // 고엔트로피 랜덤

    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    const rawPaired = await new Promise<string>((resolve, reject) => {
      phone.once("message", (d) => resolve(d.toString()));
      phone.once("error", reject);
    });
    const paired = JSON.parse(rawPaired);
    expect(paired.type).toBe("paired");
    expect(paired).not.toHaveProperty("reconnectKey");
    expect(rawPaired).not.toContain(reconnectKey);
    // paired는 host code 메시지와 동일한 세션 preview 토큰을 포함해야 한다
    expect(paired.token).toBe(token);

    host.close();
    phone.close();
  });

  it("올바른 reconnectKey로 재연결 시, 살아있는 기존 host 소켓은 통지 후 종료되고 새 소켓으로 교체된다(self-eviction)", async () => {
    handle = await startRelayServer(0);
    const host1 = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code, reconnectKey } = await nextMessage(host1);

    const evictedMsg = nextMessage(host1);
    const closed = new Promise((r) => host1.once("close", r));

    const host2 = new WebSocket(
      `ws://localhost:${handle.port}/host?code=${code}&reconnectKey=${reconnectKey}`,
    );
    const msg2 = await nextMessage(host2);
    expect(msg2.code).toBe(code);

    const evicted = await evictedMsg;
    expect(evicted.type).toBe("error");
    await closed;

    host2.close();
  });
});

describe("relay static serving", () => {
  it("index.html과 app.js를 올바른 Content-Type으로 서빙한다", async () => {
    handle = await startRelayServer(0, "src/web");
    const base = `http://localhost:${handle.port}`;

    const html = await fetch(`${base}/`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");

    const js = await fetch(`${base}/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
  });

  it("상위 경로 탈출(path traversal)을 403/거부한다", async () => {
    handle = await startRelayServer(0, "src/web");
    const res = await fetch(`http://localhost:${handle.port}/../../package.json`);
    // 브라우저 fetch는 ../를 정규화하므로, 서버에 직접 인코딩된 경로로도 확인
    const res2 = await fetch(`http://localhost:${handle.port}/%2e%2e/%2e%2e/package.json`);
    expect(res.status === 403 || res.status === 404).toBe(true);
    expect(res2.status === 403 || res2.status === 404).toBe(true);
  });

  it("/preview/<이름>/는 projects/<이름>/public을 서빙한다(유효 토큰 필요)", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);
    const res = await fetch(`http://localhost:${handle.port}/preview/demo/?t=${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("DEMO");
    host.close();
  });

  it("이름 없는 /preview/ 는 404(유효 토큰 있어도)", async () => {
    handle = await startRelayServer(0, "src/web", { previewDir: "projects" });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);
    const res = await fetch(`http://localhost:${handle.port}/preview/?t=${token}`);
    expect(res.status).toBe(404);
    host.close();
  });

  it("preview 경로 탈출은 거부된다(유효 토큰 있어도)", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);
    const res = await fetch(
      `http://localhost:${handle.port}/preview/demo/%2e%2e/%2e%2e/package.json?t=${token}`,
    );
    expect(res.status === 403 || res.status === 404).toBe(true);
    host.close();
  });
});

describe("preview HTTP 쿠키 인증(서명 토큰, 스펙 §4·§12.2)", () => {
  it("토큰·쿠키 없이 /preview/**에 접근하면 403(공개 예외 없음)", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    const res = await fetch(`http://localhost:${handle.port}/preview/demo/`);
    expect(res.status).toBe(403);
  });

  it("유효한 ?t=<token>으로 접근하면 200 + HttpOnly Set-Cookie(Path=/preview) 발급", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);

    const res = await fetch(`http://localhost:${handle.port}/preview/demo/?t=${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("DEMO");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/preview");
    expect(setCookie).toContain("SameSite=Lax");
    host.close();
  });

  it("쿠키만으로(쿼리 토큰 없이) 서브리소스에 200", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    writeFileSync(join(root, "demo", "public", "app.css"), "body{color:red}");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);

    const first = await fetch(`http://localhost:${handle.port}/preview/demo/?t=${token}`);
    const setCookie = first.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const cookie = setCookie!.split(";")[0];

    const second = await fetch(`http://localhost:${handle.port}/preview/demo/app.css`, {
      headers: { cookie },
    });
    expect(second.status).toBe(200);
    expect(await second.text()).toContain("color:red");
    host.close();
  });

  it("위조 토큰(어느 세션과도 불일치)은 403", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    // 세션을 하나 만들어 실제 유효 토큰이 존재하는 상태에서도 위조 토큰은 거부돼야 한다
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    await nextMessage(host);

    const res = await fetch(
      `http://localhost:${handle.port}/preview/demo/?t=totally-forged-not-a-real-token`,
    );
    expect(res.status).toBe(403);
    host.close();
  });

  it("위조 쿠키(어느 세션과도 불일치)는 403", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    await nextMessage(host);

    const res = await fetch(`http://localhost:${handle.port}/preview/demo/`, {
      headers: { cookie: "cpmc_pt=forged-cookie-value" },
    });
    expect(res.status).toBe(403);
    host.close();
  });

  it("유효한 토큰으로 /preview/**에 접근하면 Referrer-Policy: no-referrer 헤더가 포함된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);

    const res = await fetch(`http://localhost:${handle.port}/preview/demo/?t=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    host.close();
  });
});

describe("relay password auth", () => {
  it("비밀번호가 설정되면 secret 없는 host 연결은 거부된다", async () => {
    handle = await startRelayServer(0, undefined, { password: "pw123" });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    expect((await nextMessage(host)).type).toBe("error");
  });

  it("올바른 secret이면 host가 코드를 받는다", async () => {
    handle = await startRelayServer(0, undefined, { password: "pw123" });
    const host = new WebSocket(`ws://localhost:${handle.port}/host?secret=pw123`);
    expect((await nextMessage(host)).type).toBe("code");
    host.close();
  });

  it("틀린 secret의 폰은 거부된다", async () => {
    handle = await startRelayServer(0, undefined, { password: "pw123" });
    const host = new WebSocket(`ws://localhost:${handle.port}/host?secret=pw123`);
    const { code } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}&secret=wrong`);
    expect((await nextMessage(phone)).type).toBe("error");
    host.close();
  });

  it("올바른 secret의 폰은 paired 된다", async () => {
    handle = await startRelayServer(0, undefined, { password: "pw123" });
    const host = new WebSocket(`ws://localhost:${handle.port}/host?secret=pw123`);
    const { code } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}&secret=pw123`);
    expect((await nextMessage(phone)).type).toBe("paired");
    host.close();
    phone.close();
  });
});

describe("ID/비밀번호 로그인", () => {
  it("id+secret이 맞으면 host 살아있는 세션에 paired(phoneToken 포함)", async () => {
    handle = await startRelayServer(0, undefined, {
      getPhoneAuth: () => ({ id: "testuser", password: "pw1234" }),
    });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    await nextMessage(host); // code

    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?id=testuser&secret=pw1234`);
    const msg = await nextMessage(phone);
    expect(msg.type).toBe("paired");
    expect(typeof msg.phoneToken).toBe("string");
    expect(msg.phoneToken.length).toBe(64);

    host.close();
    phone.close();
  });

  it("비밀번호 불일치·미설정 각각 한국어 오류 후 종료", async () => {
    handle = await startRelayServer(0, undefined, {
      getPhoneAuth: () => ({ id: "testuser", password: "pw1234" }),
    });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    await nextMessage(host); // code

    const bad = new WebSocket(`ws://localhost:${handle.port}/phone?id=testuser&secret=wrong`);
    expect((await nextMessage(bad)).text).toContain("아이디 또는 비밀번호");
    host.close();

    // getPhoneAuth가 undefined를 반환하는 릴레이 인스턴스
    const unsetHandle = await startRelayServer(0, undefined, {
      getPhoneAuth: () => undefined,
    });
    const unset = new WebSocket(`ws://localhost:${unsetHandle.port}/phone?id=a&secret=b`);
    expect((await nextMessage(unset)).text).toContain("초기 설정");
    await unsetHandle.close();
  });

  it("host 없는 상태의 id 로그인은 'PC가 아직 준비되지 않았어요'", async () => {
    handle = await startRelayServer(0, undefined, {
      getPhoneAuth: () => ({ id: "testuser", password: "pw1234" }),
    });
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?id=testuser&secret=pw1234`);
    expect((await nextMessage(phone)).text).toContain("PC가 아직");
  });

  it("phoneToken 재접속: paired 후 끊고 토큰만으로 다시 paired", async () => {
    handle = await startRelayServer(0, undefined, {
      getPhoneAuth: () => ({ id: "testuser", password: "pw1234" }),
    });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    await nextMessage(host); // code

    const p1 = new WebSocket(`ws://localhost:${handle.port}/phone?id=testuser&secret=pw1234`);
    const t = (await nextMessage(p1)).phoneToken;
    const p1Closed = new Promise((r) => p1.once("close", r));
    p1.close();
    await p1Closed;

    const p2 = new WebSocket(`ws://localhost:${handle.port}/phone?phoneToken=${t}`);
    expect((await nextMessage(p2)).type).toBe("paired");

    const p3 = new WebSocket(`ws://localhost:${handle.port}/phone?phoneToken=deadbeef`);
    expect((await nextMessage(p3)).text).toContain("만료");

    host.close();
    p2.close();
  });
});

describe("파이프라인 서빙 확장", () => {
  it("/preview/<name>/mockup/home.html 은 mockup/ 디렉터리에서 서빙", async () => {
    const previewRoot = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(previewRoot, "habit", "mockup"), { recursive: true });
    writeFileSync(join(previewRoot, "habit", "mockup", "home.html"), "<h1>목업</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: previewRoot });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);
    const res = await fetch(`http://localhost:${handle.port}/preview/habit/mockup/home.html?t=${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("목업");
    host.close();
  });
  it("/preview/<name>/wireframe/index.html 은 wireframe/ 디렉터리에서 서빙", async () => {
    const previewRoot = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(previewRoot, "habit", "wireframe"), { recursive: true });
    writeFileSync(join(previewRoot, "habit", "wireframe", "index.html"), "<h1>구조</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: previewRoot });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);
    const res = await fetch(`http://localhost:${handle.port}/preview/habit/wireframe/index.html?t=${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("구조");
    host.close();
  });
  it("화이트리스트 밖 디렉터리는 public/ 기준으로 해석되어 404", async () => {
    const previewRoot = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(previewRoot, "habit", "secret"), { recursive: true });
    writeFileSync(join(previewRoot, "habit", "secret", "x.txt"), "비밀");
    handle = await startRelayServer(0, "src/web", { previewDir: previewRoot });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);
    const res = await fetch(`http://localhost:${handle.port}/preview/habit/secret/x.txt?t=${token}`);
    expect(res.status).toBe(404);
    host.close();
  });
  it(".wasm은 application/wasm으로 서빙", async () => {
    const previewRoot = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(previewRoot, "habit", "preview"), { recursive: true });
    writeFileSync(join(previewRoot, "habit", "preview", "a.wasm"), "AGFzbQ");
    handle = await startRelayServer(0, "src/web", { previewDir: previewRoot });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { token } = await nextMessage(host);
    const res = await fetch(`http://localhost:${handle.port}/preview/habit/preview/a.wasm?t=${token}`);
    expect(res.headers.get("content-type")).toBe("application/wasm");
    host.close();
  });
});
