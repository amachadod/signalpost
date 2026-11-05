// Fakes for the demo and the tests: example Claude output and a pretend Upload-Post,
// so the real pipeline runs end to end with no accounts and no keys.
import { readFileSync, mkdtempSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRules } from "../src/rules.js";
import { parseBrand } from "../src/brand.js";
import { loadMedia } from "../src/media.js";

export const EXAMPLES = ["brightline", "casaverde"];
export const DEMO_NOW = new Date("2026-11-09T09:00:00Z"); // Monday 9 November, 09:00 in Lisbon
const dir = (name) => new URL(`../examples/${name}/`, import.meta.url).pathname;
const json = (name, file) => JSON.parse(readFileSync(join(dir(name), file), "utf8"));

// A fresh copy of an example in a temporary folder, so runs never touch the repository.
export function setupExample(name) {
  const root = mkdtempSync(join(tmpdir(), `signalpost-${name}-`));
  for (const f of ["brand.md", "plan.md"]) copyFileSync(join(dir(name), f), join(root, f));
  mkdirSync(join(root, "drafts"), { recursive: true });
  const rules = loadRules();
  const brand = parseBrand(readFileSync(join(root, "brand.md"), "utf8"), Object.keys(rules.networks));
  const media = loadMedia(root, json(name, "media.json"));
  return { root, rules, brand, media, plan: fakePlan(json(name, "claude-plan.json")), write: fakeWrite(json(name, "claude-posts.json")) };
}

export const fakePlan = (out) => async () => structuredClone(out);

// First call for an item returns "posts"; a second call (the repair, with problems listed) returns "repair".
export const fakeWrite = (out) => async ({ item, problems }) => {
  const entry = out[item.label];
  if (!entry) throw new Error(`No example output for "${item.label}".`);
  return { posts: structuredClone(problems && entry.repair ? entry.repair : entry.posts) };
};

// Pretend Upload-Post: records every request and hands back job ids.
export function fakeUploadPost({ failFor = [] } = {}) {
  const requests = [], cancelled = [];
  let n = 0;
  return {
    requests, cancelled,
    async schedule(req) {
      const network = req.fields.find(([k]) => k === "platform[]")[1];
      if (failFor.includes(network)) throw new Error("Upload-Post error 500");
      requests.push(req);
      return { jobId: `demo_job_${String(++n).padStart(3, "0")}` };
    },
    async cancel(jobId) { cancelled.push(jobId); return { success: true }; },
    async list() { return requests.map((_, i) => `demo_job_${String(i + 1).padStart(3, "0")}`).filter((j) => !cancelled.includes(j)); },
  };
}
