export function renderMarkdownPreview(
  markdown: string,
  opts?: { resolveSrc?: (src: string) => string },
): string {
  const inner = renderBlocks(normalizeNewlines(markdown), opts);
  return `<div class="md-preview">${inner}</div>`;
}

type PreviewOpts = { resolveSrc?: (src: string) => string };

function normalizeNewlines(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function renderBlocks(markdown: string, opts?: PreviewOpts): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        body.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line.trim())) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(heading[2]!, opts)}</h${level}>`);
      i += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) {
        quote.push(lines[i]!.replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderInline(quote.join("\n"), opts)}</blockquote>`);
      continue;
    }

    if (isListItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i]!)) {
        items.push(`<li>${renderInline(lines[i]!.replace(/^[-*+]\s+/, ""), opts)}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (isOrderedItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isOrderedItem(lines[i]!)) {
        items.push(`<li>${renderInline(lines[i]!.replace(/^\d+\.\s+/, ""), opts)}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (isTableRow(line)) {
      const rows: string[] = [];
      while (i < lines.length && isTableRow(lines[i]!)) {
        rows.push(lines[i]!);
        i += 1;
      }
      out.push(renderTable(rows, opts));
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !isBlockStart(lines[i]!)) {
      para.push(lines[i]!);
      i += 1;
    }
    out.push(`<p>${renderInline(para.join("\n"), opts)}</p>`);
  }
  return out.join("");
}

function isListItem(line: string): boolean {
  return /^[-*+]\s+/.test(line);
}

function isOrderedItem(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  return trimmed.split("|").length >= 2;
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith("```") ||
    /^(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line.trim()) ||
    /^(#{1,3})\s+/.test(line) ||
    line.startsWith(">") ||
    isListItem(line) ||
    isOrderedItem(line) ||
    isTableRow(line)
  );
}

function renderTable(rows: string[], opts?: PreviewOpts): string {
  if (rows.length === 0) return "";
  let header: string[] | undefined;
  let body = rows;
  if (rows.length >= 2 && isSeparatorRow(rows[1]!)) {
    header = splitCells(rows[0]!);
    body = rows.slice(2);
  }
  const parts: string[] = ["<table>"];
  if (header) {
    parts.push(
      `<thead><tr>${header.map((cell) => `<th>${renderInline(cell, opts)}</th>`).join("")}</tr></thead>`,
    );
  }
  parts.push("<tbody>");
  for (const row of body) {
    if (isSeparatorRow(row)) continue;
    parts.push(
      `<tr>${splitCells(row).map((cell) => `<td>${renderInline(cell, opts)}</td>`).join("")}</tr>`,
    );
  }
  parts.push("</tbody></table>");
  return parts.join("");
}

function isSeparatorRow(line: string): boolean {
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.replace(/\s/g, "")));
}

function splitCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEnd = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return withoutEnd.split("|").map((cell) => cell.trim());
}

function renderInline(text: string, opts?: PreviewOpts): string {
  let result = "";
  let last = 0;
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]*)\]\(([^)]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    result += renderTextDecorations(text.slice(last, index));
    if (match[0].startsWith("![")) {
      result += renderImage(match[1] ?? "", match[2] ?? "", opts);
    } else {
      result += renderLink(match[3] ?? "", match[4] ?? "");
    }
    last = index + match[0].length;
  }
  result += renderTextDecorations(text.slice(last));
  return result;
}

function renderTextDecorations(text: string): string {
  let result = "";
  let last = 0;
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  for (const match of text.matchAll(pattern)) {
    result += escapeHtml(text.slice(last, match.index ?? 0));
    if (match[1] != null) result += `<code>${escapeHtml(match[1])}</code>`;
    else if (match[2] != null) result += `<strong>${escapeHtml(match[2])}</strong>`;
    else result += `<em>${escapeHtml(match[3]!)}</em>`;
    last = (match.index ?? 0) + match[0].length;
  }
  result += escapeHtml(text.slice(last));
  return result;
}

function renderImage(alt: string, rawSrc: string, opts?: PreviewOpts): string {
  const src = opts?.resolveSrc ? opts.resolveSrc(rawSrc) : rawSrc;
  if (!isAllowedUrl(src)) return escapeHtml(alt);
  return `<img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}">`;
}

function renderLink(label: string, href: string): string {
  if (!isAllowedUrl(href)) return escapeHtml(label);
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function isAllowedUrl(url: string): boolean {
  const trimmed = url.trim();
  const compact = trimmed.replace(/[\s\0]/g, "").toLowerCase();
  if (
    compact.startsWith("javascript:") ||
    compact.startsWith("data:") ||
    compact.startsWith("vbscript:")
  ) {
    return false;
  }
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("artifacts/")) return true;
  return false;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
