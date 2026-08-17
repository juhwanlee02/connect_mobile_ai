import { describe, it, expect } from "vitest";
import { nextBackoff } from "../../src/cli/backoff.js";

describe("nextBackoff", () => {
  it("시도 횟수에 따라 지수적으로 증가한다", () => {
    expect(nextBackoff(0)).toBe(500);
    expect(nextBackoff(1)).toBe(1000);
    expect(nextBackoff(2)).toBe(2000);
  });

  it("최대값(10초)을 넘지 않는다", () => {
    expect(nextBackoff(10)).toBe(10000);
  });
});
