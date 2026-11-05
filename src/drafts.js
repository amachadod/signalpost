// Drafts are plain Markdown files in drafts/, one per post. You edit them in the pull request like any
// text; Signalpost reads your edits back. A network's section is the post for that network: delete the
// section to skip the network, delete the file to skip the post.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, writeFrontmatter, slug } from "./text.js";
import { pretty } from "./time.js";
import { stats } from "./rules.js";

const FIELDS = { title: "Title", first_comment: "First comment", link: "Link", alt_text: "Alt text", topic_tag: "Topic" };
const BY_LABEL = Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [v.toLowerCase(), k]));
export const fileName = (item) => `drafts/${item.date ? `${item.date}-${(item.time || "0000").replace(":", "")}` : "undated"}-${slug(item.label, 32)}.md`;

const levelWord = (list) => (list.some((i) => i.level === "block") ? "blocked" : list.length ? "warning" : "ok");

export function renderDraft(item, posts, issues, rules) {
  const head = writeFrontmatter({
    signalpost: item.ref, status: item.status, date: item.date || "", time: item.time || "", timezone: item.timezone, format: item.format, media: item.media,
  });
  const out = [head, `# ${item.label}: ${pretty(item.date, item.time)} (${item.timezone})`, ""];
  out.push(`> From your plan: "${item.source.replace(/\s*\n\s*/g, " ")}"`, "");
  out.push("<!-- Edit the text under each network, then merge the pull request to approve.", "     Delete a network's section to skip that network. Delete this file to skip the post.", "     Change date, time or status in the header at the top. -->", "");
  if (item.question) out.push(`**Question for you:** ${item.question} Change the date or time above if needed, then set \`status: ready\`.`, "");
  for (const net of Object.keys(posts)) {
    const p = posts[net];
    out.push(`## ${rules.networks[net].name}`, "");
    if (p.title) out.push(`**Title:** ${p.title}`, "");
    if (p.caption) out.push(p.caption.trim(), "");
    for (const k of ["first_comment", "link", "alt_text", "topic_tag"]) if (p[k]) out.push(`**${FIELDS[k]}:** ${p[k]}`, "");
  }
  out.push("## Checks", "", "_Signalpost writes this part every time it checks. Edits here are ignored._", "");
  for (const net of Object.keys(posts)) {
    const list = issues[net] || [];
    out.push(`- **${rules.networks[net].name}: ${levelWord(list)}** · ${stats(net, posts[net], item, rules)}`);
    for (const i of list) out.push(`  - ${i.level === "block" ? "Blocked" : "Warning"}: ${i.msg}`);
  }
  return `${out.join("\n").trimEnd()}\n`;
}

export function parseDraft(text, file, rules) {
  const { data, body } = parseFrontmatter(text);
  const byName = Object.fromEntries(Object.entries(rules.networks).map(([id, n]) => [n.name.toLowerCase(), id]));
  const posts = {}, unknown = [];
  const sections = body.split(/^## +/m).slice(1);
  for (const s of sections) {
    const nl = s.indexOf("\n");
    const heading = (nl < 0 ? s : s.slice(0, nl)).trim();
    if (heading.toLowerCase() === "checks") continue;
    const net = byName[heading.toLowerCase()] || (rules.networks[heading.toLowerCase()] ? heading.toLowerCase() : null);
    if (!net) { unknown.push(heading); continue; }
    const post = { caption: "", title: null, first_comment: null, link: null, alt_text: null, topic_tag: null };
    const caption = [];
    for (const para of (nl < 0 ? "" : s.slice(nl + 1)).replace(/<!--[\s\S]*?-->/g, "").split(/\n\s*\n/)) {
      const t = para.trim();
      if (!t) continue;
      const f = t.match(/^\*\*([A-Za-z ]+):\*\*\s*([\s\S]*)$/);
      if (f && BY_LABEL[f[1].toLowerCase()]) post[BY_LABEL[f[1].toLowerCase()]] = f[2].trim() || null;
      else caption.push(t);
    }
    post.caption = caption.join("\n\n");
    if (!posts[net]) posts[net] = post;
  }
  const label = (body.match(/^# (.+): (?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d|No date yet)/m) || [])[1] || file;
  const q = body.match(/\*\*Question for you:\*\* (.+?) Change the date/);
  const src = body.match(/^> From your plan: "(.*)"\s*$/m);
  return {
    file, ref: data.signalpost || null, status: ["ready", "needs-answer", "blocked"].includes(data.status) ? data.status : "needs-answer",
    date: data.date || null, time: data.time || null, timezone: data.timezone || null, format: data.format || null,
    media: Array.isArray(data.media) ? data.media : data.media ? [data.media] : [],
    label, source: src ? src[1] : "", question: q ? q[1] : null, posts, networks: Object.keys(posts), unknown,
  };
}

export function loadDrafts(root, rules) {
  const dir = join(root, "drafts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_") && !f.startsWith("."))
    .sort().map((f) => parseDraft(readFileSync(join(dir, f), "utf8"), `drafts/${f}`, rules))
    .filter((d) => d.ref);
}
