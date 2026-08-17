import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ImageAttachment } from "../shared/protocol.js";

export const MAX_IMAGE_COUNT = 3;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export class ImageAttachmentError extends Error {}

function decodeBase64(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new ImageAttachmentError("이미지 데이터 형식이 올바르지 않아요");
  }
  return Buffer.from(value, "base64");
}

export function saveImageAttachments(
  workdir: string,
  raw: unknown,
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ImageAttachmentError("이미지 첨부 형식이 올바르지 않아요");
  }
  if (raw.length > MAX_IMAGE_COUNT) {
    throw new ImageAttachmentError(`이미지는 한 번에 ${MAX_IMAGE_COUNT}개까지 첨부할 수 있어요`);
  }

  const decoded = raw.map((item: unknown) => {
    const attachment = item as Partial<ImageAttachment> | null;
    const ext = attachment && typeof attachment.mime === "string"
      ? EXTENSIONS[attachment.mime]
      : undefined;
    if (!ext) {
      throw new ImageAttachmentError("PNG, JPG, WebP, GIF 이미지만 첨부할 수 있어요");
    }
    const data = decodeBase64(attachment?.base64);
    if (data.byteLength > MAX_IMAGE_BYTES) {
      throw new ImageAttachmentError("이미지 한 장은 4MB 이하여야 해요");
    }
    return { data, ext };
  });

  if (decoded.length === 0) return [];
  const dir = join(workdir, ".attachments");
  mkdirSync(dir, { recursive: true });
  return decoded.map(({ data, ext }, index) => {
    const file = `${Date.now()}-${index}-${randomBytes(6).toString("hex")}${ext}`;
    writeFileSync(join(dir, file), data, { mode: 0o600 });
    return `.attachments/${file}`;
  });
}

export function addImagesToPrompt(text: string, paths: string[]): string {
  if (paths.length === 0) return text;
  const request = text.trim() || "첨부한 이미지를 분석해서 현재 작업에 반영해줘.";
  return [
    request,
    "",
    "첨부 이미지 파일:",
    ...paths.map((path) => `- ${path}`),
    "위 이미지 파일을 직접 열어 내용을 확인한 뒤 요청에 반영하세요.",
  ].join("\n");
}
