// 재연결 지수 백오프(ms). attempt 0,1,2... → 500,1000,2000,... (상한 10초)
export function nextBackoff(attempt: number, baseMs = 500, maxMs = 10000): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}
