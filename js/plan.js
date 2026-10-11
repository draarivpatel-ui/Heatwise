// HeatWise coach plan + historical replay helpers. Pure functions (no DOM), shared by the app and the tests.
//  - replayHours(): turns the archived Houston IAH record day (Aug 24, 2023) into the same hourly
//    weather objects the forecast path produces, so the normal plan view can show it.
//  - coachPlan(): the one-page practice plan for one local calendar day (flag timeline, safest window).
//  - coachPlanText(): the same plan as plain text for sharing (text message, email, team chat).
import { bestWindow, hourAllowed, localHour, cToF, SEVERITY } from "./heat.js";

/** Where and what the replay is (data: data/validation/replay-iah-2023-08-24.json). */
export const REPLAY = {
  id: "iah-2023-08-24",
  file: "replay-iah-2023-08-24.json",
  place: { name: "Houston Intercontinental Airport (IAH)", lat: 29.9844, lon: -95.3414, tz: "America/Chicago" },
  day: "2023-08-24",
};

/**
 * Archived rows [epochMs, tempF, dewF, rh, windKt, radiation W/m², pressure hPa] -> hourly weather
 * in the app's format. Same conversion as validation.js replayDay(), so both give identical WBGT.
 */
export function replayHours(day) {
  return day.rows.map(([t, tF, , rh, kt, rad, p]) => ({
    t, tempC: ((tF - 32) * 5) / 9, rh, radiation: rad, wind10: kt * 0.514444, pressure: p, src: "replay",
  }));
}

const keyFmt = new Map();
/** Local calendar day ("YYYY-MM-DD") of an instant in a time zone. */
export function dayKey(t, tz) {
  const k = tz || "UTC";
  if (!keyFmt.has(k)) keyFmt.set(k, new Intl.DateTimeFormat("en-CA", { timeZone: k, year: "numeric", month: "2-digit", day: "2-digit" }));
  return keyFmt.get(k).format(new Date(t));
}

/** The local days covered by a list of hours, in order, with how many hours each has. */
export function planDays(hours, tz) {
  const out = [];
  for (const h of hours) {
    const k = dayKey(h.t, tz);
    if (!out.length || out[out.length - 1].key !== k) out.push({ key: k, first: h.t, n: 0 });
    out[out.length - 1].n++;
  }
  return out;
}

/**
 * One-page plan for one local day.
 * @param scored  hours from scoreHours()
 * @param opts    { tz, day: "YYYY-MM-DD", duration, earliest, latest }
 * @returns { day, rows, dayRows, best:{startT,endT}|null, window:[], worst, peak, levels, flagHours }
 *   rows = the day's hours inside the practice hours (all of the day's hours if none are);
 *   levels = the levels that occur in rows, least to most severe.
 */
export function coachPlan(scored, { tz, day, duration = 2, earliest = 6, latest = 21 }) {
  const dayRows = scored.filter((h) => dayKey(h.t, tz) === day);
  const allowed = (h) => hourAllowed(localHour(h.t, tz), earliest, latest);
  const inHours = dayRows.filter(allowed);
  const rows = inHours.length ? inHours : dayRows;
  const b = bestWindow(dayRows, duration, allowed);
  const window = b ? dayRows.slice(b.start, b.end + 1) : [];
  const maxBy = (arr) => arr.reduce((a, h) => (h.margin > a.margin ? h : a));
  const worst = window.length ? maxBy(window) : null;
  const peak = rows.length ? maxBy(rows) : null;
  const levels = [...new Set(rows.map((h) => h.level))].sort((a, c) => SEVERITY[a] - SEVERITY[c]);
  const flagHours = {};
  for (const h of rows) flagHours[h.level] = (flagHours[h.level] || 0) + 1;
  return {
    day, rows, dayRows, window, worst, peak, levels, flagHours,
    best: b ? { startT: dayRows[b.start].t, endT: dayRows[b.end].t + 3600e3 } : null,
    partial: dayRows.length < 24,
  };
}

/**
 * Plain-text version of the plan (for the Share button). `S` = STRINGS[lang]; `f` supplies
 * locale-specific formatting: { date(ms), time(ms), place, activity, guideline, uil:boolean, url, replay:boolean, duration }.
 */
export function coachPlanText(plan, S, f) {
  const L = [];
  L.push(`${S.sheetTitle} – ${f.date(plan.rows[0]?.t ?? Date.now())}`);
  if (f.replay) L.push(S.sheetReplayNote);
  L.push(`${S.sheetPlace}: ${f.place}`);
  L.push(`${S.sheetActivity}: ${f.activity} · ${f.guideline} · ${f.duration} h`);
  if (plan.best) {
    L.push(`${S.sheetWindow}: ${f.time(plan.best.startT)} – ${f.time(plan.best.endT)} (${S.worstHour}: ${S["level_" + plan.worst.level]}, WBGT ${cToF(f.uil ? plan.worst.wbgt : plan.worst.effWbgt).toFixed(1)}°F)`);
    const rule = f.uil ? S["uil_" + plan.worst.level] : S["adv_" + plan.worst.level];
    L.push(`→ ${rule}`);
    if (f.uil && f.duration > plan.worst.maxHours) L.push(`⚠ ${S.windowTooLong(plan.worst.maxHours)}`);
  } else {
    L.push(`${S.sheetWindow}: ${S.sheetNoWindow}`);
  }
  L.push(`${S.sheetTimeline}:`);
  for (const h of plan.rows) L.push(`  ${f.time(h.t)}  ${S["level_" + h.level]}  ${cToF(f.uil ? h.wbgt : h.effWbgt).toFixed(1)}°F`);
  L.push(`${S.sheetWater}: ${S.waterLine(f.water)}`);
  L.push(`${S.sheetChecklist}: ${S.sheetCheck1} ${S.sheetCheck2} ${S.sheetCheck3}`);
  L.push(S.signsRule);
  L.push(S.sheetMeasure);
  if (f.url) L.push(f.url);
  return L.join("\n");
}
