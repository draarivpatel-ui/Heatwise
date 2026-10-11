// HeatWise validation study: pure functions (no DOM), shared by the app, the data script and the tests.
//
// 1. Heat index agreement: HeatWise's heatIndexF() run on the National Weather Service's own forecast
//    temperature and humidity, compared with the heat index the NWS publishes for the same grid cell
//    and hour (api.weather.gov gridpoints, NDFD).
// 2. WBGT agreement: HeatWise's Liljegren WBGT compared with the NWS operational WBGT forecast,
//    (a) with the same temperature, humidity and wind as the NWS ("same inputs"; only sunshine comes
//    from Open-Meteo, because the NWS grid has no solar radiation), and (b) end to end, exactly as the
//    app runs it on Open-Meteo's forecast.
// 3. Replay of a documented extreme day (Houston IAH, Aug 24 2023) from archived observations.
//
// Everything is framed as AGREEMENT with the NWS, not accuracy: the NWS numbers are forecasts too.
import { heatIndexF, cToF, estimateWbgt, uilFlag, UIL_FLAGS, scoreHours, bestWindow, hourAllowed, localHour } from "./heat.js";

/** Hours in an ISO-8601 duration such as "PT1H", "PT6H", "P1D", "P1DT3H". */
export function durationHours(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso || "");
  if (!m) throw new Error(`Bad ISO duration: ${iso}`);
  return Number(m[1] || 0) * 24 + Number(m[2] || 0);
}

/**
 * Expand an NWS gridpoint series ([{validTime:"2026-10-10T15:00:00+00:00/PT3H", value}]) into one
 * value per UTC hour: Map(epochMs -> value). A value valid for 3 hours appears 3 times.
 */
export function expandSeries(values) {
  const out = new Map();
  for (const v of values || []) {
    const [start, dur] = v.validTime.split("/");
    const t0 = Date.parse(start);
    const n = durationHours(dur);
    for (let i = 0; i < n; i++) out.set(t0 + i * 3600e3, v.value);
  }
  return out;
}

/** NWS grids use -120 °F (-84.4 °C) and null as "missing". Anything below -50 °C is treated as missing. */
export const isValidC = (v) => typeof v === "number" && Number.isFinite(v) && v > -50;

/** Summary statistics of a list of differences (HeatWise minus NWS), in °F. */
export function errorStats(diffs) {
  const n = diffs.length;
  if (!n) return { n: 0, bias: NaN, mae: NaN, rmse: NaN, within1: NaN, within2: NaN, maxAbs: NaN };
  let s = 0, a = 0, q = 0, mx = 0, w1 = 0, w2 = 0;
  for (const d of diffs) {
    s += d; a += Math.abs(d); q += d * d; mx = Math.max(mx, Math.abs(d));
    if (Math.abs(d) <= 1 + 1e-9) w1++;
    if (Math.abs(d) <= 2 + 1e-9) w2++;
  }
  return { n, bias: s / n, mae: a / n, rmse: Math.sqrt(q / n), within1: w1 / n, within2: w2 / n, maxAbs: mx };
}

/** Pearson correlation of two equal-length arrays. */
export function correlation(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}

/** Row layout of data/validation/nws-hgx.json. */
export const NWS_COLS = ["t", "tC", "tdC", "rh", "hiC", "wbgtC", "windKmh"];
const col = (name) => NWS_COLS.indexOf(name);

/**
 * Rows that are true forecasts: valid at or after the hour the NWS issued the grid (`updateTime`).
 * The grid also carries a few already-past hours that are not refreshed with the rest (their heat
 * index and WBGT can disagree with their own temperature), so the study leaves them out.
 */
export function forecastRows(point, forecastOnly = true) {
  if (!forecastOnly || !point.updateTime) return point.rows;
  const from = Math.floor(Date.parse(point.updateTime) / 3600e3) * 3600e3;
  return point.rows.filter((r) => Date.parse(r[0]) >= from);
}

/** The NWS heat index is defined for air temperatures of 80 °F and up; below that NWS reports HI = T. */
export const HI_MIN_F = 80;

/**
 * Heat index agreement. For every point and hour where the NWS published a valid temperature, RH and
 * heat index and the temperature is >= 80 °F, compare heatIndexF(T, RH) with the NWS heat index.
 * The NWS grid stores whole degrees Fahrenheit, so even a perfect copy of the formula disagrees by up
 * to ±0.5 °F from rounding; `roundedExact` is the share of hours where HeatWise, rounded the same way,
 * gives exactly the NWS number.
 */
export function compareHeatIndex(dataset, { minF = HI_MIN_F, forecastOnly = true } = {}) {
  const pairs = [];
  for (const p of dataset.points) {
    for (const r of forecastRows(p, forecastOnly)) {
      const tC = r[col("tC")], rh = r[col("rh")], hiC = r[col("hiC")];
      if (!isValidC(tC) || !isValidC(hiC) || !(rh >= 0 && rh <= 100)) continue;
      const T = cToF(tC);
      if (T < minF - 0.5) continue;
      const nws = cToF(hiC), hw = heatIndexF(T, rh);
      pairs.push({ point: p.id, t: r[col("t")], T, rh, nws, hw, diff: hw - nws });
    }
  }
  const stats = errorStats(pairs.map((p) => p.diff));
  stats.roundedExact = pairs.length ? pairs.filter((p) => Math.round(p.hw) === Math.round(p.nws)).length / pairs.length : NaN;
  stats.r = pairs.length > 2 ? correlation(pairs.map((p) => p.hw), pairs.map((p) => p.nws)) : NaN;
  stats.points = new Set(pairs.map((p) => p.point)).size;
  return { pairs, stats };
}

/**
 * WBGT agreement. `om` is data/validation/openmeteo.json: per point, rows aligned to the same UTC
 * hours: [t, tC, rh, radiation W/m², wind10 m/s, pressure hPa].
 * mode "same": NWS temperature, RH and wind (km/h -> m/s), Open-Meteo sunshine and pressure.
 * mode "app":  everything from Open-Meteo, exactly as the app runs.
 * Returns pairs plus error stats and how often the Texas UIL flag (Class 3) agrees.
 */
export function compareWbgt(dataset, om, { mode = "same", uilClass = 3, forecastOnly = true } = {}) {
  const pairs = [];
  for (const p of dataset.points) {
    const o = om.points.find((q) => q.id === p.id);
    if (!o) continue;
    const byT = new Map(o.rows.map((r) => [r[0], r]));
    for (const r of forecastRows(p, forecastOnly)) {
      const wb = r[col("wbgtC")];
      const q = byT.get(r[col("t")]);
      if (!isValidC(wb) || !q || !Number.isFinite(q[3])) continue;
      const tMs = Date.parse(r[col("t")]);
      const h = mode === "same"
        ? { t: tMs, tempC: r[col("tC")], rh: r[col("rh")], radiation: q[3], wind10: r[col("windKmh")] / 3.6, pressure: q[5] }
        : { t: tMs, tempC: q[1], rh: q[2], radiation: q[3], wind10: q[4], pressure: q[5] };
      if (!isValidC(h.tempC) || !(h.rh >= 0) || !Number.isFinite(h.wind10)) continue;
      const hwC = estimateWbgt(h, p).wbgt;
      if (!Number.isFinite(hwC)) continue;
      const fHw = uilFlag(hwC, uilClass), fNws = uilFlag(wb, uilClass);
      pairs.push({ point: p.id, t: r[col("t")], day: q[3] > 0, nws: cToF(wb), hw: cToF(hwC), diff: cToF(hwC) - cToF(wb), fHw, fNws });
    }
  }
  const sub = (f) => {
    const ps = pairs.filter(f);
    const s = errorStats(ps.map((p) => p.diff));
    s.flagAgree = ps.length ? ps.filter((p) => p.fHw === p.fNws).length / ps.length : NaN;
    s.flagWithinOne = ps.length ? ps.filter((p) => Math.abs(UIL_FLAGS.indexOf(p.fHw) - UIL_FLAGS.indexOf(p.fNws)) <= 1).length / ps.length : NaN;
    s.r = ps.length > 2 ? correlation(ps.map((p) => p.hw), ps.map((p) => p.nws)) : NaN;
    return s;
  };
  return { pairs, stats: sub(() => true), day: sub((p) => p.day), night: sub((p) => !p.day) };
}

/** Per-point summary (for the table under the chart). */
export function byPoint(pairs) {
  const m = new Map();
  for (const p of pairs) { if (!m.has(p.point)) m.set(p.point, []); m.get(p.point).push(p.diff); }
  return [...m].map(([point, d]) => ({ point, ...errorStats(d) }));
}

/** Histogram of differences in fixed-width bins centred on 0. */
export function histogram(diffs, width = 0.5, limit = 3) {
  const bins = [];
  for (let lo = -limit; lo < limit - 1e-9; lo += width) bins.push({ lo, hi: lo + width, n: 0 });
  let under = 0, over = 0;
  for (const d of diffs) {
    if (d < -limit) under++;
    else if (d >= limit) over++;
    else bins[Math.min(bins.length - 1, Math.floor((d + limit) / width + 1e-9))].n++;
  }
  return { bins, under, over };
}

/**
 * Replay a documented day from archived hourly observations.
 * `day.rows`: [epochMs, tempF, dewF, rh, windKt, radiation W/m², pressure hPa] (ASOS obs + reanalysis sun).
 * Returns each hour with heat index, Liljegren WBGT and Texas UIL flag, plus the safest 2-hour window
 * between `earliest` and `latest` (local time) that the planner would have picked.
 */
export function replayDay(day, { uilClass = 3, duration = 2, earliest = 6, latest = 21 } = {}) {
  const place = { lat: day.lat, lon: day.lon, tz: day.tz };
  const hours = day.rows.map(([t, tF, , rh, kt, rad, p]) => ({
    t, tempC: ((tF - 32) * 5) / 9, rh, radiation: rad, wind10: kt * 0.514444, pressure: p,
  }));
  const scored = scoreHours(hours, { guideline: "uil", uilClass, workload: "veryHeavy", acclimatized: false, clothing: "work" }, place);
  const rows = scored.map((h, i) => ({
    t: h.t, hour: localHour(h.t, day.tz), tempF: day.rows[i][1], dewF: day.rows[i][2], rh: h.rh,
    hiF: heatIndexF(day.rows[i][1], h.rh), wbgtF: cToF(h.wbgt), flag: uilFlag(h.wbgt, uilClass), model: h.model,
  }));
  const allowed = (h) => hourAllowed(localHour(h.t, day.tz), earliest, latest);
  const best = bestWindow(scored, duration, allowed);
  const peakHi = rows.reduce((a, b) => (b.hiF > a.hiF ? b : a));
  const peakWbgt = rows.reduce((a, b) => (b.wbgtF > a.wbgtF ? b : a));
  const flagHours = Object.fromEntries(UIL_FLAGS.map((f) => [f, rows.filter((r) => r.flag === f).length]));
  return { rows, best, peakHi, peakWbgt, flagHours, bestRows: best ? rows.slice(best.start, best.end + 1) : [] };
}
