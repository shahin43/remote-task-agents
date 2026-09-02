import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdownPreview } from "./markdown-preview.js";

test("escapes html and renders a heading", () => {
  const html = renderMarkdownPreview("# Hi\n\n<script>x</script>");
  assert.match(html, /<h1>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("rejects javascript: links", () => {
  const html = renderMarkdownPreview("[x](javascript:alert(1))");
  assert.doesNotMatch(html, /javascript:/);
});

test("rewrites relative image src via callback", () => {
  const html = renderMarkdownPreview("![c](chart.svg)", {
    resolveSrc: (src) =>
      src === "chart.svg" ? "/api/snapshots/x/file?path=artifacts%2Fchart.svg" : src,
  });
  assert.match(html, /artifacts%2Fchart\.svg/);
});

test("renders emphasis, inline code, fences, numbered lists, and hr", () => {
  const html = renderMarkdownPreview(
    [
      "Use **bold** and *italic* and `code`.",
      "",
      "```",
      "<raw>",
      "```",
      "",
      "1. First",
      "2. Second",
      "",
      "---",
      "",
      "> quoted",
    ].join("\n"),
  );
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<pre><code>&lt;raw&gt;<\/code><\/pre>/);
  assert.match(html, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<blockquote>/);
});

test("renders pipe tables without a leading pipe", () => {
  const html = renderMarkdownPreview("Benefit | Score\n--- | ---\nSecurity | 9");
  assert.match(html, /<th>Benefit<\/th>/);
  assert.match(html, /<td>Security<\/td>/);
});
