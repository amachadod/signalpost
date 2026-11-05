// Claude writes each post for each network. Signalpost checks them against the rules, and if a rule
// is broken in a way words can fix (too long, too many hashtags, a link that isn't allowed),
// Claude gets one more try with the exact problems. Whatever still breaks a rule is blocked.
import { checkPost, blocks, textFixable } from "./rules.js";

const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function validateWrite(raw, item) {
  const posts = {};
  for (const p of Array.isArray(raw?.posts) ? raw.posts : []) {
    const net = String(p?.network || "").toLowerCase();
    if (!item.networks.includes(net) || posts[net]) continue;
    posts[net] = {
      caption: str(p.caption, 70000) || "",
      title: str(p.title, 300),
      first_comment: str(p.first_comment, 2200),
      link: str(p.link, 500),
      alt_text: str(p.alt_text, 1000),
      topic_tag: str(p.topic_tag, 100)?.replace(/^#/, "") || null,
    };
  }
  for (const net of item.networks) if (!posts[net]) posts[net] = { caption: "", title: null, first_comment: null, link: null, alt_text: null, topic_tag: null };
  return posts;
}

export const checkAll = (posts, item, media, brand, rules) =>
  Object.fromEntries(Object.entries(posts).map(([net, p]) => [net, checkPost(net, p, item, media, brand, rules)]));

export async function composeItem(item, { write, brand, media, rules }) {
  let posts = validateWrite(await write({ item, brand, media, rules }), item);
  let issues = checkAll(posts, item, media, brand, rules);
  const fixes = [];
  const broken = Object.entries(issues).filter(([, list]) => textFixable(list));
  if (broken.length) {
    const problems = broken.flatMap(([network, list]) => list.filter((i) => i.level === "block" && i.fixable).map((i) => ({ network, msg: i.msg })));
    const second = validateWrite(await write({ item, brand, media, rules, problems, previous: posts }), item);
    for (const [network] of broken) {
      const before = problems.filter((p) => p.network === network).map((p) => p.msg);
      const after = checkPost(network, second[network], item, media, brand, rules);
      // Keep the rewrite only if it fixed something and broke nothing new.
      if (blocks(after).length < blocks(issues[network]).length) {
        posts[network] = second[network];
        issues[network] = after;
        fixes.push({ network, was: before, fixed: !blocks(after).some((i) => i.fixable) });
      } else fixes.push({ network, was: before, fixed: false });
    }
  }
  return { posts, issues, fixes };
}

export const statusOf = (item, issues) => {
  // A post is blocked only if no network can take it. Blocked networks are skipped on their own.
  if (Object.values(issues).every((l) => blocks(l).length)) return "blocked";
  return item.status === "needs-answer" ? "needs-answer" : "ready";
};
