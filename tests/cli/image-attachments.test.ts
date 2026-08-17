import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addImagesToPrompt,
  ImageAttachmentError,
  saveImageAttachments,
} from "../../src/cli/image-attachments.js";

function root(): string {
  return mkdtempSync(join(tmpdir(), "cpmc-images-"));
}

describe("image attachments", () => {
  it("검증한 이미지를 생성 이름으로 프로젝트 내부에 저장한다", () => {
    const workdir = root();
    const bytes = Buffer.from("fake png bytes");
    const paths = saveImageAttachments(workdir, [{
      name: "../../escape.png",
      mime: "image/png",
      base64: bytes.toString("base64"),
    }]);

    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^\.attachments\/[a-zA-Z0-9-]+\.png$/);
    expect(existsSync(join(workdir, paths[0]))).toBe(true);
    expect(readFileSync(join(workdir, paths[0]))).toEqual(bytes);
  });

  it("지원하지 않는 형식과 3개 초과 첨부를 거부한다", () => {
    const workdir = root();
    const bad = [{ name: "x.svg", mime: "image/svg+xml", base64: "eA==" }];
    expect(() => saveImageAttachments(workdir, bad)).toThrow(ImageAttachmentError);
    expect(() => saveImageAttachments(workdir, Array(4).fill({
      name: "x.png", mime: "image/png", base64: "eA==",
    }))).toThrow("3개");
  });

  it("이미지 경로와 확인 지시를 프롬프트에 추가한다", () => {
    const prompt = addImagesToPrompt("이 화면처럼 만들어줘", [".attachments/a.png"]);
    expect(prompt).toContain("이 화면처럼 만들어줘");
    expect(prompt).toContain(".attachments/a.png");
    expect(prompt).toContain("직접 열어");
  });
});
