// npm run demo: runs both example campaigns through the real pipeline with example Claude output
// and a pretend Upload-Post. No accounts or keys needed. Nothing is posted anywhere.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../src/config.js";
import { runDraft, runSchedule } from "../src/pipeline.js";
import { EXAMPLES, DEMO_NOW, setupExample, fakeUploadPost } from "./examples.js";

for (const name of EXAMPLES) {
  const ex = setupExample(name);
  const config = { ...getConfig({}), root: ex.root };
  console.log(`\n=== ${ex.brand.name} (${name}) ===\n`);
  const draft = await runDraft({ ...ex, config, now: DEMO_NOW });
  console.log(`\n${draft.summary}`);
  console.log("--- You merge the pull request. Signalpost schedules what's approved: ---\n");
  const client = fakeUploadPost();
  const { report } = await runSchedule({ ...ex, config: { ...config, uploadPostProfile: "demo" }, client, now: DEMO_NOW });
  for (const s of report.scheduled) console.log(`  scheduled  ${s.label} on ${s.network} (${s.jobId})`);
  for (const s of report.skipped) console.log(`  skipped    ${s.label}${s.network ? ` on ${s.network}` : ""}: ${s.reason}`);
  console.log(`\nFiles written to ${ex.root}: drafts/, scheduled.json, CALENDAR.md, calendar.ics`);
  console.log(`\n${readFileSync(join(ex.root, "CALENDAR.md"), "utf8").split("\n").slice(0, 16).join("\n")}\n…`);
}
