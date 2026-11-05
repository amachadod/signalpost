// Checks Claude's reading of your plan before anything is written.
// Every post must quote a real line of your plan, use media that exists and a network you use,
// and land on a real future date. Anything doubtful is kept but marked "needs-answer".
import { normalize, sha } from "./text.js";
import { isDate, isTime, isTimeZone, zonedToUtc, pretty } from "./time.js";

const ALIASES = { insta: "instagram", ig: "instagram", reels: "instagram", tt: "tiktok", yt: "youtube", shorts: "youtube", "youtube shorts": "youtube", twitter: "x", fb: "facebook", li: "linkedin", pin: "pinterest" };
const FORMATS = ["reel", "video", "carousel", "photo", "story", "text"];
export const network = (s) => { const k = String(s || "").toLowerCase().trim(); return ALIASES[k] || k; };

// Lines starting with ">" are pasted text from someone else. Posts never come from them.
export function quoteSource(plan, quote) {
  const q = normalize(quote);
  if (!q) return "missing";
  const own = normalize(plan.split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join("\n"));
  if (own.includes(q)) return "plan";
  const pasted = normalize(plan.split(/\r?\n/).filter((l) => /^\s*>/.test(l)).map((l) => l.replace(/^\s*>\s?/, "")).join("\n"));
  if (pasted.includes(q.replace(/^>\s*/, ""))) return "pasted";
  return "missing";
}

export function validatePlan(raw, { plan, brand, media, rules, now, reviewMode = false }) {
  const items = [], dropped = [], refs = new Set();
  const suspicious = (Array.isArray(raw?.suspicious) ? raw.suspicious : [])
    .filter((s) => s && typeof s.quote === "string" && s.quote.trim())
    .map((s) => ({ quote: s.quote.trim().slice(0, 300), reason: String(s.reason || "Looked like an instruction, not part of your plan.").slice(0, 300) }));
  const flagged = (q) => suspicious.some((s) => normalize(s.quote).includes(normalize(q)) || (normalize(s.quote).length >= 12 && normalize(q).includes(normalize(s.quote))));
  const maxAhead = now.getTime() + rules.uploadPost.maxDaysAhead * 864e5;

  for (const r of Array.isArray(raw?.items) ? raw.items : []) {
    const quote = String(r?.source_quote || "").trim();
    const where = quoteSource(plan, quote);
    if (where === "missing") { dropped.push({ quote: quote.slice(0, 200), reason: "Claude quoted a line that isn't in your plan, so nothing was made from it." }); continue; }
    if (where === "pasted") { dropped.push({ quote: quote.slice(0, 200), reason: "This comes from pasted text (a line starting with >), not your own plan." }); continue; }
    if (flagged(quote)) { dropped.push({ quote: quote.slice(0, 200), reason: "This line was flagged as suspicious, so nothing was made from it." }); continue; }
    if (!FORMATS.includes(r.format)) { dropped.push({ quote: quote.slice(0, 200), reason: `Unknown post type "${r.format}".` }); continue; }

    const notes = [];
    const nets = [];
    for (const n of (Array.isArray(r.networks) ? r.networks : []).map(network)) {
      if (!rules.networks[n]) notes.push(`"${n}" isn't a network Signalpost knows, so it was left out.`);
      else if (!brand.networks.includes(n)) notes.push(`${rules.networks[n].name} isn't in your brand.md networks, so it was left out.`);
      else if (!nets.includes(n)) nets.push(n);
    }
    if (!nets.length) { dropped.push({ quote: quote.slice(0, 200), reason: "No network you use was named for this post." }); continue; }

    const files = [...new Set((Array.isArray(r.media) ? r.media : []).map(String))];
    const missing = files.filter((f) => !media[f]);

    const timezone = r.timezone && isTimeZone(r.timezone) ? r.timezone : brand.timezone;
    const date = isDate(r.date) ? r.date : null;
    const time = isTime(r.time) ? r.time : null;
    let confidence = Number(r.confidence);
    confidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5;
    let question = typeof r.question === "string" && r.question.trim() ? r.question.trim().slice(0, 300) : null;

    let at = null;
    if (date && time) {
      at = zonedToUtc(date, time, timezone);
      if (at.getTime() <= now.getTime() + 5 * 60e3) { question = `${pretty(date, time)} has already passed. When should this go out?`; at = null; }
      else if (at.getTime() > maxAhead) { question = `Upload-Post schedules up to a year ahead, and ${pretty(date, time)} is further. Pick an earlier date?`; at = null; }
    } else if (!question) question = "Which day and time should this go out?";

    let ref = `sp-${sha(normalize(quote), 8)}`;
    for (let i = 2; refs.has(ref); i++) ref = `sp-${sha(`${normalize(quote)}#${i}`, 8)}`;
    refs.add(ref);

    const needsAnswer = !at || confidence < 0.6 || reviewMode;
    items.push({
      ref, label: String(r.label || r.about || "Post").trim().slice(0, 60), source: quote.slice(0, 600), format: r.format, networks: nets, media: files, missing,
      date, time, timezone, at: at ? at.toISOString() : null,
      about: String(r.about || "").trim().slice(0, 600), instructions: String(r.instructions || "").trim().slice(0, 600),
      confidence, question: needsAnswer ? (question || (reviewMode ? "Review mode is on: check this post and mark it ready." : "Is this what you meant?")) : null,
      status: needsAnswer ? "needs-answer" : "ready", notes,
    });
  }
  return { items, dropped, suspicious };
}
