// npm run check: re-checks every draft after you edit it. Exits with an error if a draft can't be scheduled at all.
import { start, fail } from "./load.js";
import { runCheck } from "../src/pipeline.js";

try {
  const s = start();
  const r = runCheck({ ...s, write: process.argv.includes("--write") });
  if (r.problems.length) process.exit(1);
} catch (e) { fail(e); }
