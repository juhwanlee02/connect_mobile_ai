// Dependency-free markdown mini-renderer for the phone artifact viewer.
// No DOM APIs — pure string transforms so it runs in tests (Node) and browser alike.

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function isTableRow(line) {
  return /^\|.*\|$/.test(line.trim());
}

function isTableSeparator(line) {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function tableCells(line) {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

export function renderMarkdown(md) {
  const escaped = escapeHtml(md);
  const lines = escaped.split("\n");
  const out = [];
  let i = 0;
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (isTableRow(line)) {
      closeList();
      out.push("<table>");
      const header = tableCells(line);
      i++;
      if (i < lines.length && isTableSeparator(lines[i])) {
        i++;
      }
      out.push("<tr>" + header.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr>");
      while (i < lines.length && isTableRow(lines[i]) && !isTableSeparator(lines[i])) {
        const cells = tableCells(lines[i]);
        out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
        i++;
      }
      out.push("</table>");
      continue;
    }

    const item = line.match(/^-\s+(.*)$/);
    if (item) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(item[1])}</li>`);
      i++;
      continue;
    }

    closeList();

    if (line.trim() === "") {
      i++;
      continue;
    }

    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  closeList();
  return out.join("\n");
}
