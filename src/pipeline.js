// The three things Signalpost does:
//   draft     plan.md -> Claude plans and writes -> rules check -> drafts/ + a summary for the pull request
//   check     re-checks drafts after you edit them
//   schedule  approved drafts (merged to main) -> Upload-Post, plus the calendar
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { validatePlan } from "./plan.js";
import { composeItem, statusOf, checkAll } from "./compose.js";
import { checkFit, blocks } from "./rules.js";
import { renderDraft, fileName, loadDrafts } from "./drafts.js";
import { calendarEntries, renderCalendarMd, renderIcs, statusLabel } from "./calendar.js";
import { reconcile, emptyState, draftToItem } from "./schedule.js";
import { localParts, pretty } from "./time.js";
import { plural } from "./text.js";

export const readState = (root) => (existsSync(join(root, "scheduled.json")) ? JSON.parse(readFileSync(join(root, "scheduled.json"), "utf8")) : emptyState());
const put = (root, rel, text) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

export function writeCalendar({ root, drafts, state, brand, rules, media, now, mode }) {
  const rows = calendarEntries({ drafts, state, brand, rules, media, now, mode });
  put(root, "CALENDAR.md", renderCalendarMd(rows, { brand, rules, now }));
  put(root, "calendar.ics", renderIcs(rows, { brand, rules, now }));
  return rows;
}

export async function runDraft({ root, config, brand, rules, media, plan: planFn, write, now, log = console.log }) {
  const planPath = join(root, "plan.md");
  if (!existsSync(planPath)) throw new Error("plan.md is missing. Write your plan there in plain words.");
  const plan = readFileSync(planPath, "utf8");
  const today = localParts(now, brand.timezone);
  const raw = await planFn({ plan, brand, media, rules, now, today });
  const { items, dropped, suspicious } = validatePlan(raw, { plan, brand, media, rules, now, reviewMode: config.reviewMode });

  const drafts = loadDrafts(root, rules);
  const state = readState(root);
  const known = new Set([...drafts.map((d) => d.ref), ...Object.values(state.posts).map((s) => s.ref)]);
  const results = [], already = [], failed = [];
  for (const item of items) {
    if (known.has(item.ref)) { already.push(item); continue; }
    let posts, issues, fixes = [];
    const fit = Object.fromEntries(item.networks.map((n) => [n, checkFit(n, item, media, brand, rules)]));
    if (Object.values(fit).every((l) => blocks(l).length)) {
      posts = Object.fromEntries(item.networks.map((n) => [n, { caption: "", title: null, first_comment: null, link: null, alt_text: null, topic_tag: null }]));
      issues = checkAll(posts, item, media, brand, rules);
    } else {
      try { ({ posts, issues, fixes } = await composeItem(item, { write, brand, media, rules })); } catch (e) { failed.push({ item, error: e.message }); continue; }
    }
    item.status = statusOf(item, issues);
    const file = fileName(item);
    if (!config.dryRun) put(root, file, renderDraft(item, posts, issues, rules));
    results.push({ item, posts, issues, fixes, file });
  }

  const summary = renderSummary({ results, already, dropped, suspicious, failed, brand, rules });
  if (!config.dryRun) {
    put(root, config.summaryFile, summary);
    writeCalendar({ root, drafts: loadDrafts(root, rules), state, brand, rules, media, now, mode: "draft" });
  }
  const c = (s) => results.filter((r) => r.item.status === s).length;
  log(`Signalpost draft: ${results.length} new drafts (${c("ready")} ready, ${c("needs-answer")} need an answer, ${c("blocked")} blocked), ${already.length} already drafted, ${dropped.length} plan lines not used, ${suspicious.length} suspicious, ${failed.length} failed.${config.dryRun ? " Dry run: nothing written." : ""}`);
  return { results, already, dropped, suspicious, failed, summary };
}

export function renderSummary({ results, already = [], dropped = [], suspicious = [], failed = [], brand, rules }) {
  const name = (n) => rules.networks[n].name;
  const posts = results.reduce((s, r) => s + r.item.networks.length, 0);
  const out = [`## Signalpost: ${plural(results.length, "post")} for approval`, ""];
  out.push(`${plural(posts, "network post")} written for ${brand.name}. **Merging this pull request approves every draft marked ready.** Nothing is scheduled before you merge.`, "");
  out.push("To change a post, edit its file under **Files changed** (or in `drafts/` on this branch). Delete a network's section to skip it, or the whole file to skip the post. The calendar is in `CALENDAR.md`.", "");
  if (results.length) {
    out.push(`| When (${brand.timezone}) | Post | Networks | Status |`, "|---|---|---|---|");
    for (const r of [...results].sort((a, b) => (a.item.at || "9").localeCompare(b.item.at || "9"))) {
      const nets = r.item.networks.map((n) => (blocks(r.issues[n]).length ? `~~${name(n)}~~` : name(n))).join(", ");
      out.push(`| ${pretty(r.item.date, r.item.time)} | [${r.item.label}](${r.file}) · ${r.item.format} | ${nets} | ${statusLabel(r.item.status)} |`);
    }
    out.push("");
  }
  const questions = results.filter((r) => r.item.question);
  if (questions.length) {
    out.push("### Needs your answer", "", "These won't be scheduled until you answer in the draft and set `status: ready`.", "");
    for (const r of questions) out.push(`- [${r.item.label}](${r.file}): ${r.item.question}`);
    out.push("");
  }
  const blocked = results.flatMap((r) => r.item.networks.filter((n) => blocks(r.issues[n]).length).map((n) => `- **${r.item.label}** on ${name(n)}: ${blocks(r.issues[n]).map((i) => i.msg).join(" ")}`));
  if (blocked.length) out.push("### Blocked (crossed out above, won't be scheduled)", "", ...blocked, "");
  const warnings = results.flatMap((r) => r.item.networks.flatMap((n) => r.issues[n].filter((i) => i.level === "warn").map((i) => `- **${r.item.label}** on ${name(n)}: ${i.msg}`)));
  if (warnings.length) out.push("### Warnings (will be scheduled, worth a look)", "", ...warnings, "");
  const fixes = results.flatMap((r) => r.fixes.map((f) => `- **${r.item.label}** on ${name(f.network)}: ${f.was.join(" ")} ${f.fixed ? "Claude rewrote it and it now passes." : "Claude's rewrite didn't fix it, so it stays blocked."}`));
  if (fixes.length) out.push("### Fixed on the second try", "", ...fixes, "");
  if (suspicious.length) {
    out.push("### Ignored: looked like instructions to the AI", "", "Nothing was made from these. If they really are yours, write them as your own plan lines (not quoted).", "");
    for (const s of suspicious) out.push(`- "${s.quote.slice(0, 160)}${s.quote.length > 160 ? "…" : ""}": ${s.reason}`);
    out.push("");
  }
  if (dropped.length) { out.push("### Plan lines not used", ""); for (const d of dropped) out.push(`- "${d.quote.slice(0, 120)}": ${d.reason}`); out.push(""); }
  if (already.length) out.push(`_${plural(already.length, "post")} from your plan ${already.length === 1 ? "was" : "were"} already drafted earlier, so ${already.length === 1 ? "it was" : "they were"} left alone. To change ${already.length === 1 ? "it" : "them"}, edit the draft file._`, "");
  if (failed.length) out.push(`_${plural(failed.length, "post")} couldn't be written this time (${failed.map((f) => f.error).join("; ").slice(0, 200)}). ${failed.length === 1 ? "It" : "They"} will be tried again on the next run._`, "");
  return `${out.join("\n").trimEnd()}\n`;
}

// Re-checks drafts (after you edit them) and rewrites their "Checks" section.
export function runCheck({ root, brand, rules, media, write = true, log = console.log }) {
  const drafts = loadDrafts(root, rules);
  const problems = [];
  for (const d of drafts) {
    const item = { ...draftToItem(d, brand), source: d.source, question: d.status === "needs-answer" ? d.question : null };
    if (!d.networks.length) problems.push(`${d.file}: no network sections left. Delete the file to skip the post.`);
    for (const h of d.unknown) problems.push(`${d.file}: "## ${h}" isn't a network Signalpost knows.`);
    if (!item.at && d.status !== "needs-answer") problems.push(`${d.file}: date or time is missing or not in the form YYYY-MM-DD and HH:MM.`);
    const issues = checkAll(d.posts, item, media, brand, rules);
    if (d.status === "ready" && d.networks.length && Object.values(issues).every((l) => blocks(l).length)) problems.push(`${d.file}: every network is blocked, so nothing would be scheduled.`);
    if (write && !d.unknown.length) {
      item.status = d.status === "needs-answer" ? "needs-answer" : statusOf(item, issues);
      put(root, d.file, renderDraft(item, d.posts, issues, rules));
    }
  }
  log(`Signalpost check: ${plural(drafts.length, "draft")}, ${plural(problems.length, "problem")}.`);
  for (const p of problems) log(`- ${p}`);
  return { drafts: drafts.length, problems };
}

export async function runSchedule({ root, config, brand, rules, media, client, now, log = console.log }) {
  runCheck({ root, brand, rules, media, write: !config.dryRun, log: () => {} });
  const drafts = loadDrafts(root, rules);
  const state = readState(root);
  const report = await reconcile({ drafts, brand, rules, media, state, client, profile: config.uploadPostProfile, now, dryRun: config.dryRun, log });
  if (!config.dryRun) {
    put(root, "scheduled.json", `${JSON.stringify(state, null, 1)}\n`);
    writeCalendar({ root, drafts, state, brand, rules, media, now, mode: "main" });
  }
  return { report, state, drafts };
}
