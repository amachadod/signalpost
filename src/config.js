// Reads settings from environment variables. See .env.example for what each one does.
import { readFileSync, existsSync } from "node:fs";

// Tiny .env loader so the project has zero dependencies.
export function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function getConfig(env = process.env) {
  return {
    root: env.SIGNALPOST_ROOT || process.cwd(),
    anthropicKey: env.ANTHROPIC_API_KEY || "",
    model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
    uploadPostKey: env.UPLOADPOST_API_KEY || "",
    uploadPostProfile: env.UPLOADPOST_PROFILE || "",
    dryRun: env.DRY_RUN === "true",
    reviewMode: env.REVIEW_MODE === "true",
    summaryFile: env.SIGNALPOST_SUMMARY || ".signalpost-summary.md",
  };
}
