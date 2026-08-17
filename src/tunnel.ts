// cloudflared 로그에서 공개 trycloudflare URL을 추출(없으면 null).
// ANSI 색코드가 끼어도 잡도록 정규화한다.
export function parseTunnelUrl(text: string): string | null {
  const cleaned = text.replace(/\u001b\[[0-9;]*m/g, "");
  const m = cleaned.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return m ? m[0].toLowerCase() : null;
}
