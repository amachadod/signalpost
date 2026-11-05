// brand.md: who you are, how you sound, which networks you use, and which links may appear in posts.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./text.js";
import { isTimeZone } from "./time.js";

export function parseBrand(text, knownNetworks) {
  const { data, body } = parseFrontmatter(text);
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const problems = [];
  const networks = list(data.networks).map((n) => n.toLowerCase());
  for (const n of networks) if (!knownNetworks.includes(n)) problems.push(`brand.md lists an unknown network "${n}".`);
  const timezone = data.timezone || "UTC";
  if (!isTimeZone(timezone)) problems.push(`brand.md has an unknown time zone "${timezone}". Use a name like Europe/Lisbon.`);
  return {
    name: data.brand || "Your brand",
    timezone: isTimeZone(timezone) ? timezone : "UTC",
    networks: networks.filter((n) => knownNetworks.includes(n)),
    links: list(data.links),
    defaultTime: data.default_time || "19:00",
    morningTime: data.morning_time || "10:00",
    plan: (data.uploadpost_plan || "free").toLowerCase(),
    facebookPageId: data.facebook_page_id || "",
    pinterestBoardId: data.pinterest_board_id || "",
    linkedinPageId: data.linkedin_page_id || "",
    tiktokPrivacy: data.tiktok_privacy || "PUBLIC_TO_EVERYONE",
    youtubePrivacy: data.youtube_privacy || "public",
    voice: body.replace(/<!--[\s\S]*?-->/g, "").trim(),
    problems,
  };
}

export function loadBrand(root, rules) {
  const path = join(root, "brand.md");
  if (!existsSync(path)) throw new Error("brand.md is missing. Copy the one from the README and fill it in.");
  return parseBrand(readFileSync(path, "utf8"), Object.keys(rules.networks));
}

// A link is allowed only if it starts with one of the links in brand.md.
export const linkAllowed = (url, brand) => brand.links.some((l) => url === l || url.startsWith(l.endsWith("/") ? l : `${l}/`) || url.startsWith(`${l}?`));
