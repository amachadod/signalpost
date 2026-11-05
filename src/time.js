// Dates and time zones without dependencies. Posts are planned in local time ("Thursday 19:00 in Lisbon")
// and Signalpost works out the real moment, so checks like "is this in the future?" are right everywhere.

export function isTimeZone(tz) {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return Boolean(tz); } catch { return false; }
}

function parts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return p;
}

const offset = (date, tz) => {
  const p = parts(date, tz);
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
};

// "2026-11-12", "19:00", "Europe/Lisbon" -> the Date that is 19:00 in Lisbon that day.
export function zonedToUtc(date, time, tz) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offset(new Date(guess), tz);
  const second = offset(new Date(t), tz);
  if (guess - second !== t) t = guess - second;
  return new Date(t);
}

// The local date and time somewhere, as { date: "2026-11-09", time: "09:00", weekday: "Mon" }.
export function localParts(when, tz) {
  const p = parts(when, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, "0")}:${p.minute}`, weekday: p.weekday };
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || "");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const weekday = (date) => DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
export const pretty = (date, time) => {
  if (!isDate(date)) return "No date yet";
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${time ? ` ${time}` : ""}`;
};
export const monthName = (ym) => { const [y, m] = ym.split("-"); return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`; };

// For calendar files: 20261112T180000Z
export const icsStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
