// Small text helpers: headers in Markdown files, counting, links, hashtags, ids.
import { createHash } from "node:crypto";

export const sha = (s, n = 12) => createHash("sha256").update(String(s)).digest("hex").slice(0, n);

// Characters as people count them (an emoji is one), close to how most networks count.
export const length = (s) => [...new Intl.Segmenter().segment(String(s || ""))].length;

export const hashtags = (s) => String(s || "").match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.map((h) => h.trim()) || [];
export const links = (s) => String(s || "").match(/\bhttps?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/gi) || [];

export function slug(s, max = 40) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "") || "post";
}

export const normalize = (s) => String(s || "").normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

// A "---" header with simple "key: value" lines. Lists are written [a, b].
export function parseFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: String(text) };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((x) => unquote(x.trim())).filter(Boolean);
    else v = unquote(v);
    data[kv[1]] = v;
  }
  return { data, body: String(text).slice(m[0].length) };
}
const unquote = (v) => (/^".*"$/.test(v) ? v.slice(1, -1).replace(/\\"/g, '"') : v);

export function writeFrontmatter(data) {
  const fmt = (v) => (Array.isArray(v) ? `[${v.join(", ")}]` : v == null ? "" : String(v));
  return `---\n${Object.entries(data).map(([k, v]) => `${k}: ${fmt(v)}`.trimEnd()).join("\n")}\n---\n`;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
