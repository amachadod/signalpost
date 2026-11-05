// Scheduling: compares the approved drafts in drafts/ with what's already scheduled (scheduled.json)
// and makes Upload-Post match. New or edited posts are scheduled, deleted ones are cancelled,
// unchanged ones are left alone. Nothing here runs until a pull request with drafts is merged.
import { checkPost, blocks } from "./rules.js";
import { sha } from "./text.js";
import { isDate, isTime, isTimeZone, zonedToUtc, localParts } from "./time.js";
import { buildRequest } from "./uploadpost.js";

export const emptyState = () => ({ version: 1, updated: null, posts: {} });

export function draftToItem(d, brand) {
  const timezone = isTimeZone(d.timezone) ? d.timezone : brand.timezone;
  const ok = isDate(d.date) && isTime(d.time);
  return { ref: d.ref, label: d.label, file: d.file, format: d.format, media: d.media, networks: d.networks, date: ok ? d.date : null, time: ok ? d.time : null, timezone, at: ok ? zonedToUtc(d.date, d.time, timezone).toISOString() : null, status: d.status };
}

export const postHash = (network, item, post) => sha(JSON.stringify([network, item.date, item.time, item.timezone, item.format, item.media, post]), 16);
const LIVE = new Set(["scheduled"]);

// What should be scheduled right now, and why the rest isn't.
export function desiredPosts({ drafts, brand, rules, media, state, now }) {
  const want = [], skipped = [];
  for (const d of drafts) {
    const item = draftToItem(d, brand);
    for (const h of d.unknown) skipped.push({ file: d.file, label: d.label, network: h, reason: `"## ${h}" isn't a network Signalpost knows, so it was skipped.` });
    if (!rules.formats[item.format]) { skipped.push({ file: d.file, label: d.label, reason: `Unknown format "${item.format}" in the header.` }); continue; }
    if (d.status === "needs-answer") { skipped.push({ file: d.file, label: d.label, reason: d.question || "Marked needs-answer. Set status: ready to approve it.", needsYou: true }); continue; }
    if (!item.at) { skipped.push({ file: d.file, label: d.label, reason: "No valid date and time in the header (date: YYYY-MM-DD, time: HH:MM).", needsYou: true }); continue; }
    if (new Date(item.at) <= now) { skipped.push({ file: d.file, label: d.label, reason: "Its time has already passed. Change the date or time to post it.", past: true }); continue; }
    if (new Date(item.at).getTime() > now.getTime() + rules.uploadPost.maxDaysAhead * 864e5) { skipped.push({ file: d.file, label: d.label, reason: "More than a year ahead. Upload-Post can't schedule that far out." }); continue; }
    for (const network of d.networks) {
      const post = d.posts[network];
      const issues = checkPost(network, post, item, media, brand, rules);
      if (blocks(issues).length) { skipped.push({ file: d.file, label: d.label, network, reason: blocks(issues).map((i) => i.msg).join(" ") }); continue; }
      want.push({ key: `${d.ref}:${network}`, network, item, post, hash: postHash(network, item, post), warnings: issues.filter((i) => i.level === "warn").map((i) => i.msg) });
    }
  }
  // Daily caps per network, and the free plan's monthly limit, counting what's already scheduled or sent.
  want.sort((a, b) => a.item.at.localeCompare(b.item.at) || a.network.localeCompare(b.network));
  const day = {}, month = {};
  const count = (network, at, tz) => { const p = localParts(new Date(at), tz); return [`${network}:${p.date}`, p.date.slice(0, 7)]; };
  for (const s of Object.values(state.posts)) {
    if (!(s.status === "sent" || (s.status === "scheduled" && new Date(s.at) <= now))) continue;
    const [dk, mk] = count(s.network, s.at, s.timezone);
    day[dk] = (day[dk] || 0) + 1; month[mk] = (month[mk] || 0) + 1;
  }
  const out = [];
  for (const w of want) {
    const [dk, mk] = count(w.network, w.item.at, w.item.timezone);
    const cap = rules.networks[w.network].dailyCap;
    if (cap && (day[dk] || 0) >= cap) { skipped.push({ file: w.item.file, label: w.item.label, network: w.network, reason: `${rules.networks[w.network].name} takes ${cap} posts a day through Upload-Post, and this day is full.` }); continue; }
    if (brand.plan === "free" && (month[mk] || 0) >= rules.uploadPost.freePlan.uploadsPerMonth) { skipped.push({ file: w.item.file, label: w.item.label, network: w.network, reason: `Upload-Post's free plan allows ${rules.uploadPost.freePlan.uploadsPerMonth} uploads a month, and this month is full.` }); continue; }
    day[dk] = (day[dk] || 0) + 1; month[mk] = (month[mk] || 0) + 1;
    out.push(w);
  }
  return { want: out, skipped, monthly: month };
}

export async function reconcile({ drafts, brand, rules, media, state, client, profile, now, dryRun = false, log = console.log }) {
  const { want, skipped, monthly } = desiredPosts({ drafts, brand, rules, media, state, now });
  const report = { scheduled: [], kept: [], cancelled: [], failed: [], skipped, monthly, dryRun };
  const byKey = new Map(want.map((w) => [w.key, w]));

  // Cancel what's no longer wanted or has changed, as long as it hasn't gone out yet.
  for (const [key, s] of Object.entries(state.posts)) {
    if (!LIVE.has(s.status) && s.status !== "dry-run") continue;
    const w = byKey.get(key);
    if (w && w.hash === s.hash) continue;
    if (new Date(s.at) <= now) continue;
    if (s.status === "scheduled" && !dryRun) {
      try { await client.cancel(s.jobId); } catch (e) { report.failed.push({ key, label: s.label, network: s.network, action: "cancel", error: e.message }); continue; }
    }
    if (w) delete state.posts[key];
    else { s.status = dryRun ? s.status : "cancelled"; s.cancelledAt = now.toISOString(); }
    report.cancelled.push({ key, label: s.label, network: s.network, replaced: Boolean(w) });
  }

  for (const w of want) {
    const s = state.posts[w.key];
    if (s && s.hash === w.hash && (s.status === "scheduled" || (dryRun && s.status === "dry-run"))) { report.kept.push({ key: w.key, label: w.item.label, network: w.network }); continue; }
    if (s && s.hash === w.hash && s.status === "missing") { skipped.push({ file: w.item.file, label: w.item.label, network: w.network, reason: "It was cancelled at Upload-Post. Edit the draft if you want it scheduled again." }); continue; }
    const entry = { ref: w.item.ref, network: w.network, label: w.item.label, file: w.item.file, format: w.item.format, date: w.item.date, time: w.item.time, timezone: w.item.timezone, at: w.item.at, hash: w.hash, jobId: null, status: "dry-run", warnings: w.warnings };
    const req = buildRequest({ network: w.network, post: w.post, item: w.item, media, brand, profile, idempotencyKey: `signalpost-${w.item.ref}-${w.network}-${w.hash}` });
    if (!dryRun) {
      try {
        const r = await client.schedule(req);
        Object.assign(entry, { jobId: r.jobId, status: "scheduled", scheduledAt: now.toISOString() });
      } catch (e) {
        Object.assign(entry, { status: "failed", error: e.message.slice(0, 200) });
        report.failed.push({ key: w.key, label: w.item.label, network: w.network, action: "schedule", error: entry.error });
        state.posts[w.key] = entry;
        continue;
      }
    }
    state.posts[w.key] = entry;
    report.scheduled.push({ key: w.key, label: w.item.label, network: w.network, jobId: entry.jobId, endpoint: req.endpoint });
  }
  state.updated = now.toISOString();
  log(`Signalpost: ${report.scheduled.length} scheduled${dryRun ? " (dry run)" : ""}, ${report.kept.length} unchanged, ${report.cancelled.length} cancelled, ${report.skipped.length} skipped, ${report.failed.length} failed.`);
  return report;
}

// Marks posts as sent once their time has passed and Upload-Post no longer lists them as waiting.
export async function syncState({ state, client, now, log = console.log }) {
  const waiting = new Set(await client.list());
  let sent = 0, missing = 0;
  for (const s of Object.values(state.posts)) {
    if (s.status !== "scheduled" || waiting.has(s.jobId)) continue;
    if (new Date(s.at) <= now) { s.status = "sent"; sent++; } else { s.status = "missing"; missing++; }
  }
  state.updated = now.toISOString();
  log(`Signalpost sync: ${sent} sent, ${missing} no longer scheduled at Upload-Post.`);
  return { sent, missing };
}
