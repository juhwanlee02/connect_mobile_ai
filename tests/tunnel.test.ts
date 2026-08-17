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
  it("ANSI 색코드가 끼어도 뽑는다", () => {
    const line =
      "\u001b[36mINF\u001b[0m https://Random-Name-Here.trycloudflare.com";
    expect(parseTunnelUrl(line)).toBe("https://random-name-here.trycloudflare.com");
  });
  it("URL이 없으면 null", () => {
    expect(parseTunnelUrl("그냥 로그 줄")).toBeNull();
  });
});
