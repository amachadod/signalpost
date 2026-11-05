// npm run draft: reads plan.md, has Claude plan and write the posts, checks them and writes drafts/.
import { start, fail } from "./load.js";
import { runDraft } from "../src/pipeline.js";
import { planWithClaude, writeWithClaude } from "../src/claude.js";

try {
  const s = start();
  const r = await runDraft({ ...s, plan: planWithClaude(s.config), write: writeWithClaude(s.config) });
  if (s.config.dryRun) console.log(`\n${r.summary}`);
  else if (r.results.length) console.log(`Drafts are in drafts/. Summary for the pull request: ${s.config.summaryFile}`);
} catch (e) { fail(e); }
