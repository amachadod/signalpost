// Finds your media and measures it (size, length, shape) without any tools installed,
// so the rules check knows a Reel is vertical or a Short is under 3 minutes.
import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";

const VIDEO = new Set([".mp4", ".mov", ".m4v"]);
const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp"]);
export const kindOf = (name) => (VIDEO.has(extname(name).toLowerCase()) ? "video" : IMAGE.has(extname(name).toLowerCase()) ? "image" : null);

export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

// Walks the boxes of an MP4/MOV file: "mvhd" has the length, "tkhd" the picture size.
export function videoInfoFromMoov(moov) {
  const out = { duration: null, width: null, height: null };
  const walk = (buf, start, end) => {
    let i = start;
    while (i + 8 <= end) {
      let size = buf.readUInt32BE(i);
      const type = buf.toString("ascii", i + 4, i + 8);
      let head = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(i + 8)); head = 16; }
      if (size === 0) size = end - i;
      if (size < head || i + size > end) break;
      const body = i + head;
      if (type === "moov" || type === "trak") walk(buf, body, i + size);
      else if (type === "mvhd") {
        const v = buf[body];
        const scale = v === 1 ? buf.readUInt32BE(body + 20) : buf.readUInt32BE(body + 12);
        const dur = v === 1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);
        if (scale) out.duration = Math.round((dur / scale) * 10) / 10;
      } else if (type === "tkhd") {
        const w = buf.readUInt32BE(i + size - 8) / 65536, h = buf.readUInt32BE(i + size - 4) / 65536;
        if (w && h && !out.width) { out.width = Math.round(w); out.height = Math.round(h); }
      }
      i += size;
    }
  };
  walk(moov, 0, moov.length);
  return out;
}

function videoInfo(path) {
  const fd = openSync(path, "r");
  try {
    const total = statSync(path).size, head = Buffer.alloc(16);
    let pos = 0;
    while (pos + 8 <= total) {
      readSync(fd, head, 0, 16, pos);
      let size = head.readUInt32BE(0);
      if (size === 1) size = Number(head.readBigUInt64BE(8));
      if (size === 0) size = total - pos;
      if (size < 8) break;
      if (head.toString("ascii", 4, 8) === "moov") {
        const moov = Buffer.alloc(size);
        readSync(fd, moov, 0, size, pos);
        return videoInfoFromMoov(moov);
      }
      pos += size;
    }
    return { duration: null, width: null, height: null };
  } finally { closeSync(fd); }
}

export function shape(width, height) {
  if (!width || !height) return "unknown";
  const r = width / height;
  if (r < 0.9) return "vertical";
  if (r > 1.1) return "horizontal";
  return "square";
}

export function ratio(width, height) {
  if (!width || !height) return "?";
  const known = [["9:16", 9 / 16], ["4:5", 4 / 5], ["1:1", 1], ["16:9", 16 / 9], ["2:3", 2 / 3], ["3:4", 3 / 4], ["4:3", 4 / 3], ["3:2", 3 / 2]];
  const hit = known.find(([, r]) => Math.abs(width / height - r) < 0.02);
  const g = (a, b) => (b ? g(b, a % b) : a), d = g(width, height);
  return hit ? hit[0] : `${width / d}:${height / d}`;
}

export function measure(path) {
  const kind = kindOf(path);
  const bytes = statSync(path).size;
  const info = kind === "video" ? videoInfo(path) : { duration: null, ...(imageSize(readFileSync(path).subarray(0, 65536)) || { width: null, height: null }) };
  return { kind, bytes, ...info };
}

// media/ files plus anything described in media/_info.json (public links, or details you want to set by hand).
export function loadMedia(root, manifest = null) {
  const dir = join(root, "media");
  const media = {};
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".") || name.startsWith("_") || !kindOf(name)) continue;
      try { media[`media/${name}`] = { name: `media/${name}`, path: join(dir, name), ...measure(join(dir, name)) }; } catch { /* unreadable file: left out, and the plan check will say it's missing */ }
    }
  }
  const extra = manifest || (existsSync(join(dir, "_info.json")) ? JSON.parse(readFileSync(join(dir, "_info.json"), "utf8")) : {});
  for (const [name, info] of Object.entries(extra)) {
    const kind = info.kind || kindOf(name.split("?")[0]);
    if (!kind) continue;
    media[name] = { name, path: /^https:\/\//.test(name) ? null : media[name]?.path || null, url: /^https:\/\//.test(name) ? name : info.url || null, bytes: null, duration: null, width: null, height: null, ...media[name], ...info, kind };
  }
  for (const m of Object.values(media)) { m.shape = shape(m.width, m.height); m.ratio = ratio(m.width, m.height); }
  return media;
}

export const describe = (m) => `${m.name}: ${m.kind}${m.width ? `, ${m.width}×${m.height} (${m.ratio}, ${m.shape})` : ""}${m.duration ? `, ${m.duration}s` : ""}`;
