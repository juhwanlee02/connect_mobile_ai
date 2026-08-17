import { randomBytes } from "node:crypto";

// 주의: 오프라인 검증이라 "기본 잠금"용이다. 결정적 복제 방지는
// 서버 검증(모델 B)이 필요. 판매자 가이드에 명시.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32
const SECRET = "cpmc-v1-7nQ2"; // 난독화용 솔트

function checksum(payload: string): string {
  let h = 0;
  const s = SECRET + payload;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ALPHABET[(h >>> 5) % 32] + ALPHABET[h % 32];
}

// 6자 base32 payload → 전체 키. payload는 호출자가 base32로 보장.
export function makeLicenseKey(payload: string): string {
  const p = payload.toUpperCase().slice(0, 6).padEnd(6, "2");
  return `CPMC-${p}-${checksum(p)}`;
}

export function randomLicenseKey(): string {
  const bytes = randomBytes(6);
  let p = "";
  for (let i = 0; i < 6; i++) p += ALPHABET[bytes[i] % 32];
  return makeLicenseKey(p);
}

export function isValidLicenseKey(key: string | undefined): boolean {
  if (!key) return false;
  const m = key.match(/^CPMC-([A-Z2-7]{6})-([A-Z2-7]{2})$/);
  if (!m) return false;
  return checksum(m[1]) === m[2];
}
