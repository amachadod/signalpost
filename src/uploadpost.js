// Upload-Post API (https://docs.upload-post.com): one scheduled request per post per network,
// so each network gets its own job you can see, change or cancel.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const BASE = "https://api.upload-post.com";

// Builds the request without sending it, so it can be tested and shown in dry runs.
export function buildRequest({ network, post, item, media, brand, profile, idempotencyKey }) {
  const files = item.media.map((m) => media[m]).filter(Boolean);
  const isVideo = ["reel", "video"].includes(item.format) || (item.format === "story" && files[0]?.kind === "video");
  const endpoint = item.format === "text" ? "/api/upload_text" : isVideo ? "/api/upload" : "/api/upload_photos";
  const f = [];
  const add = (k, v) => { if (v !== null && v !== undefined && v !== "") f.push([k, String(v)]); };
  add("user", profile);
  add("platform[]", network);
  add("scheduled_date", `${item.date}T${item.time}:00`);
  add("timezone", item.timezone);
  add("external_id", `signalpost-ref:${item.ref}:${network}`);
  const caption = post.caption;

  switch (network) {
    case "instagram":
      add("title", caption); add("instagram_title", caption);
      if (item.format === "story") add("media_type", "STORIES");
      else if (item.format === "reel") add("media_type", "REELS");
      add("instagram_first_comment", post.first_comment);
      if (!isVideo) add("instagram_alt_text", post.alt_text);
      break;
    case "tiktok":
      if (isVideo) { add("title", caption); add("tiktok_title", caption); }
      else { add("title", post.title); add("tiktok_title", post.title); add("tiktok_description", caption); }
      add("privacy_level", brand.tiktokPrivacy); add("post_mode", "DIRECT_POST");
      add("tiktok_first_comment", post.first_comment);
      break;
    case "youtube":
      add("title", post.title); add("youtube_title", post.title); add("youtube_description", caption);
      add("privacyStatus", brand.youtubePrivacy);
      add("youtube_first_comment", post.first_comment);
      break;
    case "facebook":
      add("title", caption); add("facebook_title", caption); add("description", caption);
      add("facebook_page_id", brand.facebookPageId);
      if (item.format === "story") add("facebook_media_type", "STORIES");
      add("facebook_first_comment", post.first_comment);
      if (!isVideo) add("facebook_alt_text", post.alt_text);
      break;
    case "linkedin":
      add("title", caption); add("linkedin_description", caption);
      add(item.format === "text" ? "linkedin_visibility" : "visibility", "PUBLIC");
      add("target_linkedin_page_id", brand.linkedinPageId);
      add("linkedin_first_comment", post.first_comment);
      if (!isVideo) add("linkedin_alt_text", post.alt_text);
      break;
    case "x":
      add("title", caption); add("x_title", caption);
      add("x_first_comment", post.first_comment);
      if (!isVideo) add("x_alt_text", post.alt_text);
      break;
    case "threads":
      add("title", caption); add("threads_title", caption);
      add("threads_topic_tag", post.topic_tag);
      add("threads_first_comment", post.first_comment);
      if (!isVideo) add("threads_alt_text", post.alt_text);
      break;
    case "pinterest":
      add("title", post.title || caption.slice(0, 100)); add("pinterest_title", post.title);
      add("pinterest_description", caption); add("pinterest_board_id", brand.pinterestBoardId);
      add("pinterest_link", post.link); add("pinterest_alt_text", post.alt_text);
      break;
    default:
      throw new Error(`Unknown network ${network}`);
  }
  const fileField = isVideo ? "video" : "photos[]";
  const attachments = item.format === "text" ? [] : files.map((m) => ({ field: fileField, url: m.url || null, path: m.path || null, name: basename(m.name) }));
  return { endpoint, fields: f, attachments, headers: { "Idempotency-Key": idempotencyKey } };
}

export function uploadPostClient({ apiKey, fetchImpl = fetch, readFile = readFileSync }) {
  const auth = { Authorization: `Apikey ${apiKey}` };
  const call = async (path, init = {}) => {
    if (!apiKey) throw new Error("UPLOADPOST_API_KEY is not set.");
    const res = await fetchImpl(`${BASE}${path}`, { ...init, headers: { ...auth, ...(init.headers || {}) } });
    let body = null;
    try { body = await res.json(); } catch { /* empty or not JSON */ }
    if (!res.ok || body?.success === false) {
      const why = typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : "";
      const err = new Error(`Upload-Post error ${res.status}${why ? `: ${why.slice(0, 160)}` : ""}`);
      err.status = res.status;
      throw err;
    }
    return body || {};
  };
  return {
    async schedule(req) {
      const form = new FormData();
      for (const [k, v] of req.fields) form.append(k, v);
      for (const a of req.attachments) {
        if (a.url) form.append(a.field, a.url);
        else form.append(a.field, new Blob([readFile(a.path)]), a.name);
      }
      const body = await call(req.endpoint, { method: "POST", body: form, headers: req.headers });
      if (!body.job_id) throw new Error("Upload-Post accepted the post but returned no job id.");
      return { jobId: body.job_id, scheduledFor: body.scheduled_date || null };
    },
    cancel: (jobId) => call(`/api/uploadposts/schedule/${encodeURIComponent(jobId)}`, { method: "DELETE" }),
    async list() {
      const body = await call("/api/uploadposts/schedule");
      const list = Array.isArray(body) ? body : body.scheduled_posts || body.jobs || body.data || [];
      return list.map((j) => j.job_id || j.id).filter(Boolean);
    },
  };
}
