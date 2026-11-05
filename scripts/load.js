// Shared start-up for the scripts: settings, rules, brand and media.
import { loadDotEnv, getConfig } from "../src/config.js";
import { loadRules } from "../src/rules.js";
import { loadBrand } from "../src/brand.js";
import { loadMedia } from "../src/media.js";

export function start() {
  loadDotEnv();
  const config = getConfig();
  const rules = loadRules();
  const brand = loadBrand(config.root, rules);
  for (const p of brand.problems) console.log(`brand.md: ${p}`);
  const media = loadMedia(config.root);
  return { config, rules, brand, media, root: config.root, now: new Date() };
}

export const fail = (e) => { console.error(`Signalpost stopped: ${e.message}`); process.exit(1); };
