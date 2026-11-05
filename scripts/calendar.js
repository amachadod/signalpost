// npm run calendar: rebuilds CALENDAR.md and calendar.ics from drafts/ and scheduled.json.
import { start, fail } from "./load.js";
import { readState, writeCalendar } from "../src/pipeline.js";
import { loadDrafts } from "../src/drafts.js";

try {
  const s = start();
  const rows = writeCalendar({ ...s, drafts: loadDrafts(s.root, s.rules), state: readState(s.root), mode: "main" });
  console.log(`Wrote CALENDAR.md and calendar.ics (${rows.length} network posts).`);
} catch (e) { fail(e); }
