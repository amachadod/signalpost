// Checks every post against its network's rules (rules/networks.json) before it can be scheduled.
// "block" means it won't be scheduled until fixed. "warn" goes through but is shown to you.
import { readFileSync } from "node:fs";
import { length, hashtags, links } from "./text.js";
import { linkAllowed } from "./brand.js";

export const loadRules = (path = new URL("../rules/networks.json", import.meta.url)) => JSON.parse(readFileSync(path, "utf8"));

const issue = (level, msg, fixable = false) => ({ level, msg, fixable });
const n = (x) => x.toLocaleString("en-US");

// Does this network take this kind of post with this media?
export function checkFit(network, item, media, brand, rules) {
  const net = rules.networks[network], out = [];
  if (!net) return [issue("block", `Unknown network "${network}".`)];
  if (!brand.networks.includes(network)) out.push(issue("block", `${net.name} isn't in your brand.md networks list.`));
  if (!net.formats.includes(item.format)) out.push(issue("block", `${net.name} doesn't take ${item.format === "text" ? "text-only posts" : `${item.format}s`} through Upload-Post.`));
  if (net.paidPlanOnly && brand.plan === "free") out.push(issue("block", `${net.name} isn't available on Upload-Post's free plan. Change uploadpost_plan in brand.md if you upgrade.`));
  if (net.needs === "facebook_page_id" && !brand.facebookPageId) out.push(issue("block", "Add facebook_page_id to brand.md so the post goes to the right Page."));
  if (net.needs === "pinterest_board_id" && !brand.pinterestBoardId) out.push(issue("block", "Add pinterest_board_id to brand.md: Pinterest needs a board for every Pin."));

  const files = item.media.map((m) => media[m]).filter(Boolean);
  for (const m of item.media.filter((x) => !media[x])) out.push(issue("block", `${m} isn't in your media folder. Add it, or fix the name in the draft.`));
  const videos = files.filter((f) => f.kind === "video"), images = files.filter((f) => f.kind === "image");
  const v = videos[0];
  if (["reel", "video"].includes(item.format) && (files.length !== 1 || !v)) out.push(issue("block", `A ${item.format} needs exactly one video.`));
  if (item.format === "photo" && (files.length !== 1 || !images.length)) out.push(issue("block", "A photo post needs exactly one image."));
  if (item.format === "story" && files.length !== 1) out.push(issue("block", "A story needs exactly one photo or video."));
  if (item.format === "text" && files.length) out.push(issue("warn", "This is a text post, so its media is ignored."));
  if (item.format === "carousel" && net.carousel) {
    if (files.length < net.carousel.min) out.push(issue("block", `${net.name} carousels need at least ${net.carousel.min} items; this one has ${files.length}.`));
    if (files.length > net.carousel.max) out.push(issue("block", `${net.name} takes up to ${net.carousel.max} items in a carousel; this one has ${files.length}.`));
    if (videos.length && !net.carousel.videos) out.push(issue("block", `${net.name} carousels can only hold photos.`));
  }
  if (v && v.duration) {
    if (net.video?.minSeconds && v.duration < net.video.minSeconds) out.push(issue("block", `${net.name} videos must be at least ${net.video.minSeconds} seconds; this one is ${v.duration}s.`));
    if (net.video?.maxSeconds && v.duration > net.video.maxSeconds) out.push(issue("block", `${net.name} takes videos up to ${Math.round(net.video.maxSeconds / 60 * 10) / 10} minutes here; this one is ${Math.round(v.duration)}s.`));
    if (network === "youtube" && item.format === "reel" && v.duration > net.shorts.maxSeconds) out.push(issue("warn", `Longer than 3 minutes, so YouTube will treat it as a regular video, not a Short.`));
  }
  if (v && item.format === "reel" && net.reelAspect === "vertical" && v.shape !== "vertical" && v.shape !== "unknown") {
    out.push(issue("warn", `This video is ${v.ratio} (${v.shape}). ${network === "youtube" ? "Shorts need a vertical or square video, so this may become a regular video." : `${net.name} shows vertical 9:16 video best; it will have bars or be cropped.`}`));
  }
  return out;
}

// Is the text right for the network?
export function checkText(network, post, item, brand, rules) {
  const net = rules.networks[network], out = [];
  if (!net) return out;
  const caption = post.caption || "";
  const isStory = item.format === "story";
  const tiktokPhotos = network === "tiktok" && ["photo", "carousel"].includes(item.format);

  if (!caption.trim() && !isStory) out.push(issue("block", "No text was written for this post.", true));
  if (isStory && caption.trim() && net.storyCaption === false) out.push(issue("warn", `${net.name} stories don't show a caption. Put the words on the image itself; the caption is skipped.`));

  const max = tiktokPhotos ? net.photoDescription.max : net.caption.max;
  const len = length(caption);
  if (len > max) {
    if (net.caption.overflow === "thread") out.push(issue("warn", `${n(len)} characters, over ${net.name}'s ${n(max)}. Upload-Post will post it as a thread of ${Math.ceil(len / max)}.`));
    else out.push(issue("block", `${n(len)} characters; ${net.name} allows ${n(max)}.`, true));
  } else if (net.caption.soft && len > net.caption.soft) out.push(issue("warn", `${n(len)} characters. It's allowed, but posts over ${n(net.caption.soft)} usually get cut off with "see more".`));

  const tags = hashtags(caption);
  if (net.hashtags && tags.length > net.hashtags.max) {
    out.push(issue("block", net.hashtags.max === 0 ? `${net.hashtags.why} This post has ${tags.length} hashtags.` : `${tags.length} hashtags; ${net.name} allows ${net.hashtags.max}.`, true));
  }

  const titleRule = tiktokPhotos ? { ...net.photoTitle, required: true } : net.title;
  if (titleRule) {
    const t = post.title || "";
    if (titleRule.required && !t.trim()) out.push(issue("block", `${net.name} needs a title${tiktokPhotos ? " for photo posts" : ""}.`, true));
    if (length(t) > titleRule.max) out.push(issue("block", `Title is ${length(t)} characters; ${net.name} allows ${titleRule.max}.`, true));
  }
  if (net.noAngleBrackets && /[<>]/.test(`${caption}${post.title || ""}`)) out.push(issue("block", "YouTube doesn't allow < or > in titles or descriptions.", true));

  const allText = [caption, post.title, post.first_comment].filter(Boolean).join(" ");
  for (const url of new Set([...links(allText), ...(post.link ? [post.link] : [])])) {
    if (!linkAllowed(url, brand)) out.push(issue("block", `The link ${url} isn't one of the links in brand.md, so it can't be posted.`, true));
  }
  if (net.links === "stripped" && links(allText).length) out.push(issue("block", `Upload-Post removes links from ${net.name} posts, so the text would read wrong. Take the link out.`, true));
  else if (net.links === "not-clickable" && links(caption).length) out.push(issue("warn", `Links in ${net.name} captions aren't clickable. Point people to your bio instead.`));
  if (post.link && !net.linkField) out.push(issue("warn", `${net.name} has no separate link field, so the link is skipped.`));
  if (post.first_comment && !net.firstComment) out.push(issue("warn", `${net.name} doesn't support a first comment here, so it's skipped.`));
  if (post.topic_tag) {
    if (!net.topicTag) out.push(issue("warn", `${net.name} doesn't use topic tags, so it's skipped.`));
    else if (length(post.topic_tag) > net.topicTag.max || /[.&]/.test(post.topic_tag)) out.push(issue("block", "Threads topic tags are 1 to 50 characters with no periods or ampersands.", true));
  }
  return out;
}

export const checkPost = (network, post, item, media, brand, rules) => [...checkFit(network, item, media, brand, rules), ...checkText(network, post, item, brand, rules)];
export const blocks = (issues) => issues.filter((i) => i.level === "block");
export const textFixable = (issues) => issues.some((i) => i.level === "block" && i.fixable);
// What the post looks like in numbers, for the checks list.
export function stats(network, post, item, rules) {
  const net = rules.networks[network];
  const tiktokPhotos = network === "tiktok" && ["photo", "carousel"].includes(item.format);
  const max = tiktokPhotos ? net.photoDescription.max : net.caption.max;
  const bits = [`${n(length(post.caption))} / ${n(max)} characters`];
  if (net.hashtags) bits.push(`${hashtags(post.caption).length} / ${net.hashtags.max} hashtags`);
  const tr = tiktokPhotos ? net.photoTitle : net.title;
  if (tr && post.title) bits.push(`title ${length(post.title)} / ${tr.max}`);
  return bits.join(", ");
}
