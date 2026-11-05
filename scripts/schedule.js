// npm run schedule: schedules approved drafts through Upload-Post and updates the calendar.
// npm run sync: asks Upload-Post what has gone out and updates scheduled.json and the calendar.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { start, fail } from "./load.js";
import { runSchedule, readState, writeCalendar } from "../src/pipeline.js";
import { syncState } from "../src/schedule.js";
import { loadDrafts } from "../src/drafts.js";
import { uploadPostClient } from "../src/uploadpost.js";

try {
  const s = start();
  if (!s.config.dryRun && (!s.config.uploadPostKey || !s.config.uploadPostProfile)) throw new Error("Set UPLOADPOST_API_KEY and UPLOADPOST_PROFILE, or DRY_RUN=true to try it without them.");
  const client = uploadPostClient({ apiKey: s.config.uploadPostKey });
  if (process.argv.includes("--sync")) {
    const state = readState(s.root);
    if (!s.config.dryRun) {
      await syncState({ state, client, now: s.now });
      writeFileSync(join(s.root, "scheduled.json"), `${JSON.stringify(state, null, 1)}\n`);
    }
    writeCalendar({ ...s, drafts: loadDrafts(s.root, s.rules), state, mode: "main" });
  } else {
    const { report } = await runSchedule({ ...s, client });
    if (report.failed.length) process.exitCode = 1;
  }
} catch (e) { fail(e); }
