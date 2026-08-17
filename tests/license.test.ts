import { describe, it, expect } from "vitest";
import {
  makeLicenseKey,
  isValidLicenseKey,
  randomLicenseKey,
} from "../src/license.js";

describe("license keys", () => {
  it("발급한 키는 유효하다", () => {
    expect(isValidLicenseKey(makeLicenseKey("ABC234"))).toBe(true);
  });
  it("랜덤 발급 키도 유효하다", () => {
    expect(isValidLicenseKey(randomLicenseKey())).toBe(true);
  });
  it("체크섬이 틀리면 무효", () => {
    expect(isValidLicenseKey("CPMC-ABC234-ZZ")).toBe(false);
  });
  it("형식이 틀리면 무효", () => {
    expect(isValidLicenseKey("hello")).toBe(false);
    expect(isValidLicenseKey(undefined)).toBe(false);
  });
});
