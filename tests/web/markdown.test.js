import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/web/markdown.js";

describe("renderMarkdown", () => {
  it("헤딩/굵게/코드", () => {
    const h = renderMarkdown("## 제목\n**강조**와 `코드`");
    expect(h).toContain("<h2>제목</h2>");
    expect(h).toContain("<strong>강조</strong>");
    expect(h).toContain("<code>코드</code>");
  });
  it("목록과 표", () => {
    const h = renderMarkdown("- 하나\n- 둘\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(h).toContain("<li>하나</li>");
    expect(h).toContain("<table>");
    expect(h).toContain("<td>1</td>");
    expect(h).not.toContain("---");
  });
  it("HTML은 이스케이프된다(XSS)", () => {
    const h = renderMarkdown('<script>alert(1)</script>');
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });
});
