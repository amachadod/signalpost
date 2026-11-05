// The content calendar: CALENDAR.md to read on GitHub, calendar.ics to import into Google Calendar,
// Outlook or Apple Calendar. Built from the drafts and what's actually scheduled.
import { draftToItem } from "./schedule.js";
import { checkPost, blocks } from "./rules.js";
import { pretty, monthName, icsStamp, weekday } from "./time.js";

const STATUS = { ready: "Ready", scheduled: "Scheduled", sent: "Sent", failed: "Failed, will retry", cancelled: "Cancelled", missing: "Cancelled at Upload-Post", "dry-run": "Dry run", waiting: "Waiting for approval", "needs-answer": "Needs your answer", blocked: "Blocked", past: "Time passed", skipped: "Not scheduled" };
export const statusLabel = (s) => STATUS[s] || s;

// One row per post per network, with where it stands.
export function calendarEntries({ drafts, state, brand, rules, media, now, mode = "main" }) {
  const rows = [];
  const seen = new Set();
  for (const d of drafts) {
    const item = draftToItem(d, brand);
    for (const network of d.networks) {
      const key = `${d.ref}:${network}`;
      seen.add(key);
      const s = state.posts[key];
      const issues = checkPost(network, d.posts[network], item, media, brand, rules);
      let status;
      if (s && ["scheduled", "sent", "failed", "dry-run", "missing"].includes(s.status)) status = s.status;
      else if (d.status === "needs-answer" || !item.at) status = "needs-answer";
      else if (blocks(issues).length) status = "blocked";
      else if (new Date(item.at) <= now) status = "past";
      else status = mode === "draft" ? "waiting" : "skipped";
      rows.push({ key, ref: d.ref, file: d.file, label: d.label, network, format: item.format, date: item.date, time: item.time, timezone: item.timezone, at: item.at, status, jobId: s?.jobId || null, question: d.question, reason: blocks(issues).map((i) => i.msg).join(" "), caption: d.posts[network]?.caption || "" });
    }
  }
  // Posts whose draft was deleted still show while they're live or already sent.
  for (const [key, s] of Object.entries(state.posts)) {
    if (seen.has(key) || !["sent", "scheduled", "failed"].includes(s.status)) continue;
    rows.push({ key, ref: s.ref, file: null, label: s.label, network: s.network, format: s.format, date: s.date, time: s.time, timezone: s.timezone, at: s.at, status: s.status, jobId: s.jobId, caption: "" });
  }
  return rows.sort((a, b) => (a.at || "9").localeCompare(b.at || "9") || a.label.localeCompare(b.label) || a.network.localeCompare(b.network));
}

const SHORT = { instagram: "IG", tiktok: "TT", youtube: "YT", facebook: "FB", linkedin: "LI", x: "X", threads: "TH", pinterest: "PIN" };

function monthGrid(ym, rows) {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = Array(lead).fill("");
  for (let d = 1; d <= days; d++) {
    const date = `${ym}-${String(d).padStart(2, "0")}`;
    const nets = [...new Set(rows.filter((r) => r.date === date && !["cancelled", "missing", "blocked", "skipped", "past"].includes(r.status)).map((r) => SHORT[r.network]))];
    cells.push(nets.length ? `**${d}**<br>${nets.join(" ")}` : `${d}`);
  }
  while (cells.length % 7) cells.push("");
  const lines = ["| Mon | Tue | Wed | Thu | Fri | Sat | Sun |", "|---|---|---|---|---|---|---|"];
  for (let i = 0; i < cells.length; i += 7) lines.push(`| ${cells.slice(i, i + 7).join(" | ")} |`);
  return lines.join("\n");
}

export function renderCalendarMd(rows, { brand, rules, now }) {
  const name = (n) => rules.networks[n]?.name || n;
  const count = (st) => rows.filter((r) => st.includes(r.status)).length;
  const out = [`# Content calendar: ${brand.name}`, "", `_Written by Signalpost on ${now.toISOString().slice(0, 16).replace("T", " ")} UTC. Times are local (${brand.timezone} unless a post says otherwise). Import \`calendar.ics\` into any calendar app to see it there._`, ""];
  out.push(`**${count(["scheduled"])} scheduled · ${count(["sent"])} sent · ${count(["waiting"])} waiting for approval · ${count(["needs-answer"])} ${count(["needs-answer"]) === 1 ? "needs" : "need"} your answer · ${count(["blocked", "skipped", "failed", "past"])} not scheduled**`, "");
  out.push(`Network codes: ${Object.entries(SHORT).filter(([n]) => brand.networks.includes(n)).map(([n, s]) => `${s} = ${name(n)}`).join(", ")}.`, "");
  const dated = rows.filter((r) => r.date);
  for (const ym of [...new Set(dated.map((r) => r.date.slice(0, 7)))]) {
    out.push(`## ${monthName(ym)}`, "", monthGrid(ym, dated), "");
    const inMonth = dated.filter((r) => r.date.startsWith(ym));
    for (const date of [...new Set(inMonth.map((r) => r.date))]) {
      out.push(`### ${pretty(date)}`, "");
      const groups = new Map();
      for (const r of inMonth.filter((x) => x.date === date)) {
        const g = `${r.ref}|${r.status}`;
        if (!groups.has(g)) groups.set(g, { ...r, networks: [] });
        groups.get(g).networks.push(name(r.network));
      }
      for (const g of groups.values()) out.push(`- ${g.time} · **${g.label}** (${g.format}) · ${g.networks.join(", ")} · ${statusLabel(g.status)}${g.file ? ` · [draft](${g.file})` : ""}`);
      out.push("");
    }
  }
  const needs = rows.filter((r) => r.status === "needs-answer");
  if (needs.length) {
    out.push("## Needs your answer", "");
    for (const f of [...new Set(needs.map((r) => r.file))]) { const r = needs.find((x) => x.file === f); out.push(`- [${r.label}](${f}): ${r.question || "Set a date and time, then status: ready."}`); }
    out.push("");
  }
  const not = rows.filter((r) => ["blocked", "skipped", "failed", "past"].includes(r.status));
  if (not.length) {
    out.push("## Not scheduled", "");
    for (const r of not) out.push(`- **${r.label}** on ${name(r.network)}: ${statusLabel(r.status)}${r.reason ? `. ${r.reason}` : ""}`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line) => { const ch = Array.from(line), parts = []; for (let i = 0; i < ch.length; i += 60) parts.push((i ? " " : "") + ch.slice(i, i + 60).join("")); return parts.join("\r\n"); };

export function renderIcs(rows, { brand, rules, now }) {
  const name = (n) => rules.networks[n]?.name || n;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Signalpost//Content calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(`${brand.name} content`)}`];
  const groups = new Map();
  for (const r of rows.filter((x) => x.at && !["cancelled", "missing"].includes(x.status))) {
    if (!groups.has(r.ref)) groups.set(r.ref, { ...r, nets: [], statuses: new Set() });
    groups.get(r.ref).nets.push(name(r.network));
    groups.get(r.ref).statuses.add(statusLabel(r.status));
  }
  for (const g of groups.values()) {
    const start = new Date(g.at);
    const firm = [...g.statuses].every((s) => s === "Scheduled" || s === "Sent");
    lines.push("BEGIN:VEVENT", `UID:${g.ref}@signalpost`, `DTSTAMP:${icsStamp(now)}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(new Date(start.getTime() + 15 * 60e3))}`,
      fold(`SUMMARY:${esc(`${g.label} · ${g.nets.join(", ")}`)}`),
      fold(`DESCRIPTION:${esc(`${[...g.statuses].join(", ")}. ${weekday(g.date)} ${g.time} ${g.timezone}.${g.caption ? `\n\n${g.caption.slice(0, 300)}` : ""}${g.file ? `\n\nDraft: ${g.file}` : ""}`)}`),
      `STATUS:${firm ? "CONFIRMED" : "TENTATIVE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
