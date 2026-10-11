// Run with: node tests/heat.test.mjs   (Node 18+; no dependencies)
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  heatIndexF, wbgtApprox, vaporPressure, limitFor, riskLevel, scoreHours, bestWindow, hourAllowed, allClear,
  hydrationPlan, acclimatizationSchedule, sampleHours, cToF, fToC, uilFlag, UIL_MAX_HOURS,
  globeTemp, wetBulbTemp, wbgtLiljegren, solarPosition, solarParams, estimateWbgt, localHour, SAMPLE_PLACE,
  UIL_CLASSES, WORKLOADS,
} from "../js/heat.js";
import { STRINGS, PRESETS } from "../js/i18n.js";
import {
  durationHours, expandSeries, isValidC, errorStats, correlation, compareHeatIndex, compareWbgt, forecastRows,
  replayDay, histogram, NWS_COLS,
} from "../js/validation.js";
import { computeAll } from "../js/validation-ui.js";
import {
  inNwsArea, nwsHourly, mergeInputs, nwsOnlyHours, rhFromDewpoint, getForecast, fetchNwsGrid, NWS_USER_AGENT, NWS_MAX_AGE_MS,
} from "../js/forecast.js";
import { REPLAY, replayHours, dayKey, planDays, coachPlan, coachPlanText } from "../js/plan.js";
import { getForecastCached, CACHE_TTL_MS } from "../js/forecast.js";
import { parseQuery, rankPlaces, autoPick, searchPlaces, US_STATES } from "../js/places.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.error("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${Number(a).toFixed(3)}, expected ${b} ±${tol}`);
const REF = JSON.parse(fs.readFileSync(new URL("./fixtures/liljegren_reference.json", import.meta.url)));

console.log("HeatWise tests");

// ---------- basic conversions and simple formulas ----------
test("unit conversion round-trips", () => {
  near(cToF(30), 86, 1e-9, "30C");
  near(fToC(cToF(17.3)), 17.3, 1e-9, "round trip");
});

// NWS heat index chart: 90°F at 50% RH ≈ 95°F; 100°F at 40% ≈ 109°F; 80°F at 40% ≈ 80°F.
test("NWS heat index matches published chart values", () => {
  near(heatIndexF(90, 50), 95, 1.5, "90F/50%");
  near(heatIndexF(100, 40), 109, 1.5, "100F/40%");
  near(heatIndexF(80, 40), 80, 1.5, "80F/40%");
});

// BoM worked example: Brisbane January, 29.4°C and 59% RH -> WBGT about 30°C.
test("simple (BoM) WBGT matches BoM worked example", () => {
  near(wbgtApprox(29.4, 59), 30, 0.5, "Brisbane example");
});

test("vapour pressure is sane (saturation ~42 hPa at 30°C)", () => {
  near(vaporPressure(30, 100), 42.4, 0.5, "e_sat(30C)");
});

// ---------- Liljegren physics model vs. the open-source reference (pywbgt) ----------
test(`Liljegren globe + natural wet-bulb match pywbgt on ${REF.components.length} random cases (±0.05 °C)`, () => {
  for (const c of REF.components) {
    const tk = c.tempC + 273.15;
    near(globeTemp(tk, c.rh / 100, c.pressure, c.speed, c.solar, c.fdir, c.cza), c.tg, 0.05, "Tg");
    near(wetBulbTemp(tk, c.rh / 100, c.pressure, c.speed, c.solar, c.fdir, c.cza, true), c.tnwb, 0.05, "Tnwb");
  }
});

test(`Liljegren end-to-end WBGT (sun position, solar adjustment, 10→2 m wind) matches pywbgt on ${REF.full.length} cases (±0.05 °C)`, () => {
  for (const c of REF.full) {
    const sun = solarPosition(c.utcMs - 30e3, c.lat, c.lon); // pywbgt centres 1-min averages: t − 30 s
    const r = wbgtLiljegren({ tempC: c.tempC, rh: c.rh, pressure: c.pressure, wind10: c.wind10, solar: c.solar, cza: sun.cza, distFactor: sun.distFactor });
    near(r.wbgt, c.wbgt, 0.05, `WBGT at ${new Date(c.utcMs).toISOString()}`);
    near(r.speed, c.speed2m, 0.02, "2 m wind");
  }
});

test(`sun position agrees with NREL SPA (pvlib) on ${REF.sun.length} random times/places (cos zenith ±0.01)`, () => {
  for (const c of REF.sun) near(solarPosition(c.utcMs, c.lat, c.lon).cza, c.cza, 0.01, `cza ${c.lat.toFixed(1)},${c.lon.toFixed(1)}`);
});

test("Liljegren behaves physically: sun raises WBGT, wind lowers it in sun, night has no solar load", () => {
  const base = { tempC: 33, rh: 50, pressure: 1010, cza: 0.85, distFactor: 1 };
  const shade = wbgtLiljegren({ ...base, solar: 0, wind10: 2 }).wbgt;
  const sun = wbgtLiljegren({ ...base, solar: 900, wind10: 2 }).wbgt;
  const windy = wbgtLiljegren({ ...base, solar: 900, wind10: 8 }).wbgt;
  assert.ok(sun > shade + 2, `sun ${sun.toFixed(2)} should exceed no-sun ${shade.toFixed(2)} by >2 °C`);
  assert.ok(windy < sun, "wind should cool the globe in full sun");
  assert.deepEqual(solarParams(500, -0.2), { solar: 0, fdir: 0 });
});

test("estimateWbgt falls back to the simple formula when radiation is missing", () => {
  const h = { t: Date.UTC(2026, 6, 15, 20), tempC: 30, rh: 60 };
  assert.equal(estimateWbgt(h, { lat: 29.6, lon: -95.6 }).model, "bom");
  assert.equal(estimateWbgt({ ...h, radiation: 700, wind10: 3 }, { lat: 29.6, lon: -95.6 }).model, "liljegren");
  assert.equal(estimateWbgt({ ...h, radiation: 700 }, null).model, "bom");
});

// ---------- guidelines ----------
test("OSHA/NIOSH limits by workload and acclimatization (OSHA Table 2)", () => {
  assert.equal(limitFor("light", false), 28);
  assert.equal(limitFor("light", true), 30);
  assert.equal(limitFor("moderate", true), 28);
  assert.equal(limitFor("heavy", false), 23);
  assert.equal(limitFor("veryHeavy", false), 21);
  assert.equal(limitFor("veryHeavy", true), 25);
  assert.throws(() => limitFor("nap", true));
});

test("risk bands around the limit", () => {
  assert.equal(riskLevel(-5), "low");
  assert.equal(riskLevel(-1), "caution");
  assert.equal(riskLevel(1.5), "high");
  assert.equal(riskLevel(4), "extreme");
});

test("UIL Class 3 flags at the published °F edges", () => {
  const f = (F) => uilFlag(fToC(F), 3);
  assert.equal(f(81.9), "green");
  assert.equal(f(82.0), "yellow");
  assert.equal(f(86.9), "yellow");
  assert.equal(f(87.0), "orange");
  assert.equal(f(90.0), "orange");
  assert.equal(f(90.1), "red");
  assert.equal(f(92.0), "red");
  assert.equal(f(92.1), "black");
});

test("UIL Class 2 flags at the published °F edges", () => {
  const f = (F) => uilFlag(fToC(F), 2);
  assert.equal(f(79.6), "green");
  assert.equal(f(79.7), "yellow");
  assert.equal(f(84.6), "yellow");
  assert.equal(f(84.7), "orange");
  assert.equal(f(87.7), "red");
  assert.equal(f(89.8), "black");
  assert.throws(() => uilFlag(30, 1));
});

test("UIL practice caps: orange 2 h, red 1 h, black none", () => {
  assert.equal(UIL_MAX_HOURS.orange, 2);
  assert.equal(UIL_MAX_HOURS.red, 1);
  assert.equal(UIL_MAX_HOURS.black, 0);
  assert.equal(UIL_MAX_HOURS.green, Infinity);
});

test("clothing factor raises effective WBGT (OSHA: vapor barrier +11 °C)", () => {
  const h = [{ tempC: 30, rh: 50 }];
  const base = scoreHours(h, { guideline: "osha", workload: "moderate", acclimatized: true, clothing: "work" })[0];
  const vapor = scoreHours(h, { guideline: "osha", workload: "moderate", acclimatized: true, clothing: "vapor" })[0];
  near(vapor.effWbgt - base.effWbgt, 11, 1e-9, "vapor barrier");
});

test("UIL scoring ignores clothing and uses raw WBGT vs the green-flag edge", () => {
  const h = [{ tempC: 30, rh: 50 }];
  const a = scoreHours(h, { guideline: "uil", uilClass: 3, workload: "moderate", clothing: "vapor" })[0];
  near(a.effWbgt, a.wbgt, 1e-9, "no clothing adj");
  near(a.limit, fToC(82), 1e-9, "green edge");
  assert.ok(["green", "yellow", "orange", "red", "black"].includes(a.level));
});

// ---------- safest window ----------
test("best window picks the coolest contiguous stretch (minimax)", () => {
  const scored = [5, 4, -3, -2, -1, 3, -4, 6].map((margin) => ({ margin }));
  assert.deepEqual(bestWindow(scored, 3), { start: 2, end: 4, worstMargin: -1 });
  assert.deepEqual(bestWindow(scored, 1), { start: 6, end: 6, worstMargin: -4 });
});

test("best window respects disallowed hours; ties go earliest; too-long returns null", () => {
  const scored = [0, 0, 0, 0].map((margin) => ({ margin }));
  assert.deepEqual(bestWindow(scored, 2), { start: 0, end: 1, worstMargin: 0 });
  assert.deepEqual(bestWindow(scored, 2, (_, i) => i !== 1), { start: 2, end: 3, worstMargin: 0 });
  assert.equal(bestWindow(scored, 5), null);
  assert.equal(bestWindow([], 1), null);
});

test("best window agrees with brute force on 500 random cases", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let trial = 0; trial < 500; trial++) {
    const n = 1 + Math.floor(rand() * 48);
    const d = 1 + Math.floor(rand() * 6);
    const scored = Array.from({ length: n }, () => ({ margin: Math.round((rand() * 20 - 10) * 10) / 10 }));
    const okMask = scored.map(() => rand() > 0.15);
    let brute = null;
    for (let s = 0; s + d <= n; s++) {
      let ok = true, worst = -Infinity;
      for (let k = s; k < s + d; k++) { if (!okMask[k]) { ok = false; break; } worst = Math.max(worst, scored[k].margin); }
      if (ok && (brute === null || worst < brute.worstMargin)) brute = { start: s, end: s + d - 1, worstMargin: worst };
    }
    assert.deepEqual(bestWindow(scored, d, (_, i) => okMask[i]), brute, `trial ${trial}`);
  }
});

test("allowed hours: normal, overnight, and whole-day windows", () => {
  assert.equal(hourAllowed(6, 6, 21), true);
  assert.equal(hourAllowed(20, 6, 21), true);
  assert.equal(hourAllowed(21, 6, 21), false); // must FINISH by 9 pm, so the 9 pm hour is out
  assert.equal(hourAllowed(5, 6, 21), false);
  assert.equal(hourAllowed(23, 20, 6), true);  // overnight shift 8 pm – 6 am
  assert.equal(hourAllowed(3, 20, 6), true);
  assert.equal(hourAllowed(12, 20, 6), false);
  assert.equal(hourAllowed(12, 0, 24), true);
  assert.equal(hourAllowed(12, 7, 7), true);
  assert.equal(hourAllowed(23, 6, 24), true);
});

// ---------- hydration, acclimatization ----------
test("hydration plan follows NIOSH (1 cup every 15–20 min, ≤48 oz/h, electrolytes for longer sweating)", () => {
  const p = hydrationPlan(1);
  assert.equal(p.cupsLow, 3);
  assert.equal(p.cupsHigh, 4);
  assert.equal(p.maxOzPerHour, 48);
  assert.ok(p.ozHigh <= 48, "never exceeds 48 oz per hour");
  assert.equal(p.electrolytes, false);
  assert.equal(hydrationPlan(2).electrolytes, true);
});

test("acclimatization schedules follow NIOSH percentages", () => {
  assert.deepEqual(acclimatizationSchedule(100, true).map((d) => d.pct), [20, 40, 60, 80, 100]);
  assert.deepEqual(acclimatizationSchedule(120, false).map((d) => d.minutes), [60, 72, 96, 120]);
});

// ---------- time zones, sample data ----------
test("local hour is DST-aware (Chicago: CDT before Nov 1 2026, CST after)", () => {
  assert.equal(localHour(Date.UTC(2026, 9, 31, 17), "America/Chicago"), 12); // CDT = UTC−5
  assert.equal(localHour(Date.UTC(2026, 10, 2, 18), "America/Chicago"), 12); // CST = UTC−6
});

test("sample data: 48 contiguous hourly points, sun only in daytime, valid humidity", () => {
  const s = sampleHours(Date.UTC(2026, 6, 15, 17, 25));
  assert.equal(s.length, 48);
  assert.equal(s[0].t, Date.UTC(2026, 6, 15, 17));
  assert.ok(s.every((h, i) => i === 0 || h.t - s[i - 1].t === 3600e3));
  assert.ok(s.every((h) => h.rh > 0 && h.rh <= 100));
  const night = s.find((h) => localHour(h.t, SAMPLE_PLACE.tz) === 2);
  const noon = s.find((h) => localHour(h.t, SAMPLE_PLACE.tz) === 13);
  assert.equal(night.radiation, 0);
  assert.ok(noon.radiation > 600);
});

test("sample afternoon is hot enough to show a non-green UIL flag, and dawn is cooler", () => {
  const s = scoreHours(sampleHours(Date.UTC(2026, 6, 15, 5)), { guideline: "uil", uilClass: 3 }, SAMPLE_PLACE);
  const byHour = (hr) => s.find((h) => localHour(h.t, SAMPLE_PLACE.tz) === hr);
  assert.ok(byHour(15).wbgt > byHour(6).wbgt + 3, "afternoon much hotter than dawn");
  assert.notEqual(byHour(15).level, "green");
});

// ---------- i18n completeness ----------
test("every English string has a Spanish translation (and vice versa)", () => {
  const en = Object.keys(STRINGS.en).sort(), es = Object.keys(STRINGS.es).sort();
  assert.deepEqual(es, en);
  assert.deepEqual(Object.keys(STRINGS.es.presets).sort(), Object.keys(STRINGS.en.presets).sort());
  assert.deepEqual(Object.keys(PRESETS).sort(), Object.keys(STRINGS.en.presets).sort());
  for (const k of en) if (typeof STRINGS.en[k] === "string") assert.ok(STRINGS.es[k].trim().length > 0, k);
});

test("index.html only references i18n keys that exist", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 30);
  for (const k of keys) assert.ok(k in STRINGS.en && k in STRINGS.es, `missing key ${k}`);
});

test("the plan defines WBGT in plain words, in both languages, right under the source line", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="forecastSource"') < html.indexOf('id="wbgtHelp"'));
  assert.match(html, /id="wbgtHelp"[^>]*data-i18n="wbgtHelp"/);
  assert.match(STRINGS.en.wbgtHelp, /wet-bulb globe temperature/);
  assert.match(STRINGS.es.wbgtHelp, /globo y bulbo húmedo/);
  assert.match(STRINGS.es.wbgtHelp, /UIL/);
});

// ---------- the words on screen agree with the numbers in the code ----------
test("'How the math works' (EN and ES) quotes the same UIL edges and OSHA/NIOSH limits as heat.js", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const lang of ["en", "es"]) {
    const block = html.split(`data-show-lang="${lang}"`)[1].split("</div>")[0];
    for (const f of [...UIL_CLASSES[3], ...UIL_CLASSES[2]]) assert.ok(block.includes(f.toFixed(1)), `${lang}: UIL edge ${f}`);
    for (const [k, v] of Object.entries(WORKLOADS)) assert.ok(block.includes(`${v.unacclimatized}/${v.acclimatized}`), `${lang}: ${k} limit`);
  }
});

test("guidance strings match the sources' numbers in both languages", () => {
  for (const lang of ["en", "es"]) {
    const S = STRINGS[lang];
    assert.ok(S.waterMax.includes(String(hydrationPlan(1).maxOzPerHour)), `${lang}: 48 oz/h (NIOSH)`);
    assert.ok(S.waterCool.includes("59") && S.waterCool.includes("15"), `${lang}: water < 15 °C / 59 °F (NIOSH)`);
    assert.ok(S.uilPlanningNote.includes("82.0") && S.uilPlanningNote.includes("79.7") && S.uilPlanningNote.includes("15") && S.uilPlanningNote.includes("30"), `${lang}: UIL monitoring rule`);
    assert.ok(S.signsStroke.includes("911") && S.signsRule.includes("911"), `${lang}: call 911 (OSHA)`);
    assert.ok(S.signsStroke.includes("103"), `${lang}: heat stroke > 103 °F (NWS)`);
    assert.ok(S.acclIntro.includes("7") && S.acclIntro.includes("14"), `${lang}: 7–14 days (NIOSH)`);
    assert.ok(/SYNTHETIC|SINTÉTICO/.test(S.errApi) && /SYNTHETIC|SINTÉTICO/.test(S.sampleBanner), `${lang}: fallback is labelled as not real`);
    assert.ok(S.windowTooLong(2).includes("2") && S.windowTooLong(1).includes("1"), `${lang}: UIL practice caps`);
  }
});

// ---------- validation study (NWS agreement + 2023 replay) ----------
const VDATA = (f) => JSON.parse(fs.readFileSync(new URL(`../data/validation/${f}`, import.meta.url)));
const NWS = VDATA("nws-hgx.json"), OM = VDATA("openmeteo.json"), DAY = VDATA("replay-iah-2023-08-24.json");

test("ISO durations and NWS series expansion", () => {
  assert.equal(durationHours("PT1H"), 1);
  assert.equal(durationHours("PT6H"), 6);
  assert.equal(durationHours("P1D"), 24);
  assert.equal(durationHours("P1DT3H"), 27);
  assert.throws(() => durationHours("6 hours"));
  const m = expandSeries([
    { validTime: "2026-10-10T15:00:00+00:00/PT1H", value: 25 },
    { validTime: "2026-10-10T16:00:00+00:00/PT3H", value: 26 },
  ]);
  assert.equal(m.size, 4);
  assert.equal(m.get(Date.parse("2026-10-10T18:00:00Z")), 26);
  assert.equal(m.get(Date.parse("2026-10-10T19:00:00Z")), undefined);
});

test("NWS missing values (null, -120 °F = -84.4 °C) are rejected", () => {
  assert.ok(isValidC(30) && isValidC(-10));
  assert.ok(!isValidC(null) && !isValidC(-84.44) && !isValidC(NaN) && !isValidC(undefined));
});

test("error statistics: bias, MAE, RMSE, within-1/2 and correlation", () => {
  const s = errorStats([1, -1, 2, 0]);
  near(s.bias, 0.5, 1e-12, "bias"); near(s.mae, 1, 1e-12, "mae"); near(s.rmse, Math.sqrt(1.5), 1e-12, "rmse");
  near(s.within1, 0.75, 1e-12, "within1"); near(s.within2, 1, 1e-12, "within2"); assert.equal(s.maxAbs, 2);
  near(correlation([1, 2, 3], [2, 4, 6]), 1, 1e-12, "r");
  const h = histogram([-0.2, 0.1, 0.3, 5], 0.5, 1);
  assert.equal(h.over, 1); assert.equal(h.bins.reduce((a, b) => a + b.n, 0), 3);
});

test("heat index comparison: exact copies agree, <80 °F, missing and pre-issue hours are excluded", () => {
  const row = (iso, tF, rh, hiF) => [iso, fToC(tF), null, rh, hiF == null ? -84.44 : fToC(hiF), null, 10];
  const ds = { points: [{ id: "x", updateTime: "2026-07-01T12:00:00+00:00", rows: [
    row("2026-07-01T11:00Z", 95, 50, 200),            // before issue time: excluded
    row("2026-07-01T12:00Z", 95, 50, heatIndexF(95, 50)),
    row("2026-07-01T13:00Z", 100, 40, heatIndexF(100, 40)),
    row("2026-07-01T14:00Z", 75, 60, 75),             // below 80 °F: excluded
    row("2026-07-01T15:00Z", 92, 55, null),           // missing heat index: excluded
  ] }] };
  assert.deepEqual(NWS_COLS, ["t", "tC", "tdC", "rh", "hiC", "wbgtC", "windKmh"]);
  assert.equal(forecastRows(ds.points[0]).length, 4);
  const { stats } = compareHeatIndex(ds);
  assert.equal(stats.n, 2);
  near(stats.mae, 0, 1e-9, "exact copy");
});

test("real NWS snapshot: HeatWise heat index agrees with the NWS forecast (8 Houston-area points)", () => {
  const { stats } = compareHeatIndex(NWS);
  assert.equal(stats.points, 8);
  assert.ok(stats.n >= 500, `n = ${stats.n}`);
  assert.ok(Math.abs(stats.bias) < 0.2, `bias ${stats.bias}`);
  assert.ok(stats.mae < 0.5, `MAE ${stats.mae}`);   // NWS rounds to whole °F, so ~0.25 is the floor
  assert.equal(stats.within2, 1);
  assert.ok(stats.roundedExact > 0.8, `rounded exact ${stats.roundedExact}`);
});

test("real NWS snapshot: WBGT agreement with the same weather inputs", () => {
  const w = compareWbgt(NWS, OM, { mode: "same" });
  assert.ok(w.stats.n >= 500, `n = ${w.stats.n}`);
  assert.ok(w.night.mae < 1, `night MAE ${w.night.mae}`);      // no sun: both models reduce to near the wet bulb
  assert.ok(w.stats.flagAgree > 0.85, `flag agreement ${w.stats.flagAgree}`);
  assert.ok(w.stats.flagWithinOne > 0.98, `within one flag ${w.stats.flagWithinOne}`);
  assert.ok(w.day.bias > 0, "HeatWise's in-sun WBGT runs warmer (more cautious) than the NWS by day");
  const app = compareWbgt(NWS, OM, { mode: "fallback" });
  assert.equal(app.stats.n, w.stats.n, "both WBGT comparisons use the same hours");
});

test("2023 replay: IAH Aug 24 hits 109 °F, heat index matches IEM, safest window is early morning", () => {
  const rp = replayDay(DAY);
  assert.equal(rp.rows.length, 24);
  assert.equal(Math.max(...DAY.rows.map((r) => r[1])), 109, "record 109 °F (NWS climate summary)");
  for (let i = 0; i < 24; i++) near(rp.rows[i].hiF, DAY.iemHeatIndexF[i], 0.1, `HI vs IEM, row ${i}`);
  assert.ok(rp.rows.every((r) => r.model === "liljegren"));
  assert.ok(rp.flagHours.black >= 1, "reaches the UIL black flag");
  assert.ok(rp.rows.filter((r) => r.flag === "black").every((r) => r.hour >= 12 && r.hour <= 18), "black only in the afternoon");
  assert.ok(rp.best && rp.rows[rp.best.start].hour >= 6 && rp.rows[rp.best.end].hour < 10, "window in the morning");
  assert.ok(rp.bestRows.every((r) => r.flag === "green"));
});

test("validation section: numbers computed once, consistent, and the section sits after 'How the math works'", () => {
  const R = computeAll(NWS, OM, DAY);
  assert.ok(R.cautious.higher <= R.cautious.total && R.cautious.total > 0);
  assert.ok(R.inputs.n > 0 && Number.isFinite(R.inputs.dT));
  assert.ok(R.iemDiff < 0.1);
  assert.equal(R.perPoint.length, 8);
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="validation"') > html.indexOf('id="mathTitle"'));
  assert.ok(html.includes('href="#validation"'));
  for (const f of ["nws-hgx.json", "openmeteo.json", "replay-iah-2023-08-24.json"]) {
    assert.ok(fs.statSync(new URL(`../data/validation/${f}`, import.meta.url)).size < 90_000, `${f} must stay under the 90 KB push limit`);
  }
});

// ---------- forecast inputs: NWS grid for U.S. places, Open-Meteo for sunshine and as the fallback ----------
const atests = [];
const atest = (name, fn) => atests.push([name, fn]);
const GRID = JSON.parse(fs.readFileSync(new URL("./fixtures/nws-grid-sugarland.json", import.meta.url)));
const POINTS_FX = JSON.parse(fs.readFileSync(new URL("./fixtures/nws-points-sugarland.json", import.meta.url)));
const H = 3600e3, T21 = Date.parse("2026-10-10T21:00:00Z");

test("NWS area check: U.S. states and territories in, other countries out (the /points 404 decides near borders)", () => {
  for (const [lat, lon, name] of [[29.62, -95.63, "Sugar Land"], [61.22, -149.9, "Anchorage"], [21.31, -157.86, "Honolulu"], [18.47, -66.11, "San Juan"], [13.44, 144.79, "Guam"], [47.61, -122.33, "Seattle"], [25.76, -80.19, "Miami"]])
    assert.ok(inNwsArea(lat, lon), name);
  for (const [lat, lon, name] of [[51.5, -0.12, "London"], [19.43, -99.13, "Mexico City"], [-33.87, 151.21, "Sydney"], [28.61, 77.21, "Delhi"], [20.68, -103.35, "Guadalajara"]])
    assert.ok(!inNwsArea(lat, lon), name);
});

test("NWS grid parser on a real api.weather.gov response (Sugar Land): units, multi-hour values, pre-issue hours", () => {
  const m = nwsHourly(GRID.properties);
  assert.ok(!m.has(T21 - H), "hours before the issue hour (21Z) are skipped");
  near(m.get(T21).tempC, 30.5556, 1e-3, "21Z temperature (from a PT3H value starting 20Z)");
  near(m.get(T21 + H).tempC, 30.5556, 1e-3, "22Z repeats the PT3H value");
  assert.equal(m.get(T21).rh, 51);
  near(m.get(Date.parse("2026-10-11T03:00:00Z")).windKmh, 9.26, 1e-9, "03Z wind from a PT2H value starting 02Z");
  assert.ok(m.size >= 48, `at least 48 hours, got ${m.size}`);
  for (const v of m.values()) assert.ok(v.tempC > 0 && v.tempC < 45 && v.rh >= 0 && v.rh <= 100);
});

test("NWS grid parser: °F and m/s units, -120 °F missing values, RH from dewpoint when RH is missing", () => {
  near(rhFromDewpoint(25, 25), 100, 1e-9, "T = Td");
  near(rhFromDewpoint(30, 20), 55, 1, "30/20 °C ≈ 55%");
  const v = (t, value, d = "PT1H") => ({ validTime: `${new Date(t).toISOString().replace(".000Z", "+00:00")}/${d}`, value });
  const props = {
    updateTime: new Date(T21 + 5 * 60e3).toISOString(),
    temperature: { uom: "wmoUnit:degF", values: [v(T21 - H, 99), v(T21, 95), v(T21 + H, -120), v(T21 + 2 * H, 90)] },
    dewpoint: { uom: "wmoUnit:degF", values: [v(T21, 75, "PT3H")] },
    relativeHumidity: { uom: "wmoUnit:percent", values: [v(T21, 52)] },
    windSpeed: { uom: "wmoUnit:m_s-1", values: [v(T21, 2, "PT3H")] },
  };
  const m = nwsHourly(props);
  assert.deepEqual([...m.keys()], [T21, T21 + 2 * H], "pre-issue hour and the -120 °F hour are dropped");
  near(m.get(T21).tempC, 35, 1e-9, "95 °F");
  near(m.get(T21).windKmh, 7.2, 1e-9, "2 m/s");
  near(m.get(T21 + 2 * H).rh, rhFromDewpoint(fToC(90), fToC(75)), 1e-9, "RH from dewpoint");
});

test("merge: NWS temperature/humidity/wind replace Open-Meteo's; sunshine, pressure, day/night stay; gaps keep Open-Meteo", () => {
  const om = [0, 1, 2].map((i) => ({ t: T21 + i * H, tempC: 20, rh: 40, radiation: 500 - i, wind10: 3, pressure: 1010, isDay: 1 }));
  const nws = new Map([[T21, { tempC: 25, rh: 70, windKmh: 18 }], [T21 + H, { tempC: 26, rh: 65, windKmh: NaN }]]);
  const out = mergeInputs(om, nws);
  assert.deepEqual(out[0], { t: T21, tempC: 25, rh: 70, radiation: 500, wind10: 5, pressure: 1010, isDay: 1, src: "nws" });
  assert.equal(out[1].wind10, 3, "no NWS wind -> Open-Meteo wind");
  assert.equal(out[1].src, "nws");
  assert.deepEqual(out[2], { ...om[2], src: "open-meteo" });
  assert.equal(om[0].tempC, 20, "input not mutated");
  const only = nwsOnlyHours(nws);
  assert.equal(only.length, 2);
  assert.ok(only.every((h) => h.radiation === undefined && h.src === "nws"), "NWS-only hours have no sunshine (heat.js uses the simple formula)");
  assert.equal(estimateWbgt(only[0], SAMPLE_PLACE).model, "bom");
});

// A fake fetch that answers api.weather.gov and Open-Meteo from the fixtures (or fails on demand).
function fakeFetch({ points = "ok", grid = "ok", om = "ok", updateTime } = {}) {
  const calls = [];
  const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
  const omBody = () => {
    const time = [], t = [], rh = [], rad = [], w = [], p = [], d = [];
    for (let i = -2; i < 70; i++) { time.push((T21 + i * H) / 1000); t.push(22); rh.push(45); rad.push(i % 24 < 3 ? 600 : 0); w.push(2.5); p.push(1012); d.push(1); }
    return { timezone: "America/Chicago", timezone_abbreviation: "CDT", hourly: { time, temperature_2m: t, relative_humidity_2m: rh, shortwave_radiation: rad, wind_speed_10m: w, surface_pressure: p, is_day: d } };
  };
  const plan = { points: [].concat(points), grid: [].concat(grid) };
  const next = (k) => (plan[k].length > 1 ? plan[k].shift() : plan[k][0]);
  const f = (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    if (url.startsWith("https://api.open-meteo.com/")) return om === "ok" ? reply(200, omBody()) : reply(om, { error: true, reason: "Daily API request limit exceeded" });
    if (url.startsWith("https://api.weather.gov/points/")) {
      const r = next("points");
      if (r === "hang") return new Promise((_, rej) => opts.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
      return r === "ok" ? reply(200, POINTS_FX) : reply(r, { title: "Data Unavailable For Requested Point", status: r });
    }
    if (url.startsWith("https://api.weather.gov/gridpoints/")) {
      const r = next("grid");
      const body = updateTime ? { properties: { ...GRID.properties, updateTime } } : GRID;
      return r === "ok" ? reply(200, body) : reply(r, { title: "Unexpected Problem", status: r });
    }
    return reply(404, {});
  };
  f.calls = calls;
  return f;
}
const NOW = T21 + 30 * 60e3; // 21:30Z, half an hour after the fixture grid was issued

atest("forecast, U.S. place: NWS temperature/humidity/wind + Open-Meteo sunshine, labelled 'nws'", async () => {
  const f = fakeFetch();
  const r = await getForecast(29.619712, -95.634911, { fetchImpl: f, now: NOW });
  assert.equal(r.source.inputs, "nws");
  assert.equal(r.source.office, "HGX");
  assert.ok(f.calls.some((c) => c.url === "https://api.weather.gov/points/29.6197,-95.6349"), "coordinates rounded to 4 decimals (no 301 redirect)");
  const nwsCall = f.calls.find((c) => c.url.includes("api.weather.gov"));
  assert.equal(nwsCall.headers.Accept, "application/geo+json");
  assert.equal(nwsCall.headers["User-Agent"], NWS_USER_AGENT, "Node sends an identifying User-Agent (NWS API rule)");
  const h = r.hours.find((x) => x.t === T21);
  near(h.tempC, 30.5556, 1e-3, "temperature from NWS");
  assert.equal(h.rh, 51, "RH from NWS");
  assert.equal(h.pressure, 1012, "pressure from Open-Meteo");
  assert.equal(h.radiation, 600, "sunshine from Open-Meteo");
  assert.equal(r.hours.find((x) => x.t === T21 - H).src, "open-meteo", "hour before the NWS issue time keeps Open-Meteo");
  assert.ok(r.source.nwsHours >= 48 && r.source.nwsHours <= r.source.totalHours);
  assert.equal(r.tz, "America/Chicago");
});

atest("forecast fallback: NWS error (500 on /points) -> every input from Open-Meteo, labelled 'error'", async () => {
  const r = await getForecast(29.62, -95.63, { fetchImpl: fakeFetch({ points: 500 }), now: NOW });
  assert.equal(r.source.inputs, "open-meteo");
  assert.equal(r.source.reason, "error");
  assert.ok(r.hours.every((h) => h.tempC === 22 && h.rh === 45 && h.src === "open-meteo"));
});

atest("forecast fallback: NWS grid 503 once is retried; twice falls back", async () => {
  const once = fakeFetch({ grid: [503, "ok"] });
  const r1 = await getForecast(29.62, -95.63, { fetchImpl: once, now: NOW, retryDelayMs: 1 });
  assert.equal(r1.source.inputs, "nws");
  assert.equal(once.calls.filter((c) => c.url.includes("/gridpoints/")).length, 2);
  const r2 = await getForecast(29.62, -95.63, { fetchImpl: fakeFetch({ grid: [503, 503] }), now: NOW, retryDelayMs: 1 });
  assert.deepEqual([r2.source.inputs, r2.source.reason], ["open-meteo", "error"]);
});

atest("forecast fallback: outside the U.S. no NWS request is made; a /points 404 near the border also means 'outside'", async () => {
  const f = fakeFetch();
  const r = await getForecast(51.5, -0.12, { fetchImpl: f, now: NOW });
  assert.deepEqual([r.source.inputs, r.source.reason], ["open-meteo", "outside"]);
  assert.ok(!f.calls.some((c) => c.url.includes("weather.gov")), "London: api.weather.gov not called");
  const r2 = await getForecast(43.65, -79.38, { fetchImpl: fakeFetch({ points: 404 }), now: NOW });
  assert.deepEqual([r2.source.inputs, r2.source.reason], ["open-meteo", "outside"], "Toronto: inside the rough box, NWS says 404");
});

atest("forecast fallback: stale NWS grid and NWS timeout -> Open-Meteo", async () => {
  const stale = await getForecast(29.62, -95.63, { fetchImpl: fakeFetch(), now: T21 + NWS_MAX_AGE_MS + 2 * H });
  assert.deepEqual([stale.source.inputs, stale.source.reason], ["open-meteo", "stale"]);
  const t0 = Date.now();
  const slow = await getForecast(29.62, -95.63, { fetchImpl: fakeFetch({ points: "hang" }), now: NOW, timeoutMs: 50 });
  assert.deepEqual([slow.source.inputs, slow.source.reason], ["open-meteo", "error"]);
  assert.ok(Date.now() - t0 < 2000, "gives up on the NWS quickly");
});

atest("forecast: Open-Meteo down but NWS up -> NWS-only plan (simple WBGT); both down -> error for the sample fallback", async () => {
  const r = await getForecast(29.62, -95.63, { fetchImpl: fakeFetch({ om: 429 }), now: NOW });
  assert.equal(r.source.inputs, "nws-only");
  assert.equal(r.tz, "America/Chicago", "time zone from the NWS /points answer");
  assert.ok(r.tzAbbr === "CDT" || r.tzAbbr === "CST", r.tzAbbr);
  assert.ok(r.hours.length >= 48 && r.hours.every((h) => h.radiation === undefined));
  await assert.rejects(getForecast(29.62, -95.63, { fetchImpl: fakeFetch({ om: 500, points: 500 }), now: NOW }));
  await assert.rejects(getForecast(51.5, -0.12, { fetchImpl: fakeFetch({ om: 500 }), now: NOW }), "outside the U.S. with Open-Meteo down");
});

test("validation: the app's U.S. path (forecast.js) reproduces the NWS-weather result and removes the cold bias", () => {
  const same = compareWbgt(NWS, OM, { mode: "same" });
  const app = compareWbgt(NWS, OM, { mode: "app" });
  const fb = compareWbgt(NWS, OM, { mode: "fallback" });
  assert.equal(app.stats.n, same.stats.n);
  assert.equal(fb.stats.n, same.stats.n, "all three use the same hours");
  near(app.stats.bias, same.stats.bias, 1e-9, "merged path = NWS weather straight from the snapshot");
  near(app.stats.mae, same.stats.mae, 1e-9, "MAE");
  assert.ok(app.pairs.every((p) => p.src === "nws"), "every compared hour used NWS inputs");
  assert.ok(Math.abs(app.stats.bias) < 1, `U.S. path bias ${app.stats.bias}`);
  assert.ok(app.stats.bias > 0, "U.S. path errs warm (cautious), not cold");
  assert.ok(fb.stats.bias < -3, `Open-Meteo-only bias ${fb.stats.bias}`);
  assert.ok(app.stats.mae < fb.stats.mae / 2 && app.stats.flagAgree > fb.stats.flagAgree);
  const R = computeAll(NWS, OM, DAY);
  near(R.app.stats.bias, app.stats.bias, 1e-12, "section shows the U.S. path");
  near(R.fallback.stats.bias, fb.stats.bias, 1e-12, "and the fallback");
});

test("source labels: in both languages, and the backup warning quotes the measured fallback bias", () => {
  for (const k of ["sourceNws", "sourceOm", "sourceOmOutside", "sourceOmError", "sourceNwsOnly", "sourceSample", "nwsLink"])
    for (const lang of ["en", "es"]) assert.ok(typeof STRINGS[lang][k] === "string" && STRINGS[lang][k].length > 5, `${lang}.${k}`);
  assert.match(STRINGS.en.sourceNws, /National Weather Service/);
  assert.match(STRINGS.es.sourceNws, /Servicio Meteorológico Nacional/);
  assert.match(STRINGS.en.sourceNwsPartial(40, 48), /40 of 48/);
  assert.match(STRINGS.es.sourceNwsPartial(40, 48), /40 de 48/);
  const fbBias = Math.round(Math.abs(compareWbgt(NWS, OM, { mode: "fallback" }).stats.bias));
  assert.ok(STRINGS.en.sourceOmError.includes(`about ${fbBias}°F low`), "EN warning matches the study");
  assert.ok(STRINGS.es.sourceOmError.includes(`unos ${fbBias}°F más bajo`), "ES warning matches the study");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="forecastSource"'));
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.ok(app.includes('from "./forecast.js"') && !app.includes("api.open-meteo.com/v1/forecast"), "the app fetches the forecast only through forecast.js");
});

// ---------- one-click replay of Houston's record day + one-page coach plan ----------
const UIL3 = { guideline: "uil", uilClass: 3, workload: "veryHeavy", acclimatized: false, clothing: "work" };
const fmtFor = (lang, tz) => {
  const loc = lang === "es" ? "es-US" : "en-US";
  return {
    date: (ms) => new Intl.DateTimeFormat(loc, { timeZone: tz, dateStyle: "full" }).format(new Date(ms)),
    time: (ms) => new Intl.DateTimeFormat(loc, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ms)),
  };
};

test("replay: the plan view's hours reproduce the validation replay exactly (same WBGT, flags, 24 h)", () => {
  const hours = replayHours(DAY);
  assert.equal(hours.length, 24);
  const scored = scoreHours(hours, UIL3, REPLAY.place);
  const rp = replayDay(DAY);
  scored.forEach((h, i) => {
    near(cToF(h.wbgt), rp.rows[i].wbgtF, 1e-9, `WBGT row ${i}`);
    assert.equal(h.level, rp.rows[i].flag, `flag row ${i}`);
  });
  assert.equal(dayKey(hours[0].t, DAY.tz), REPLAY.day, "first hour is midnight Aug 24 in Houston");
  assert.equal(dayKey(hours[23].t, DAY.tz), REPLAY.day, "last hour is 11 PM Aug 24");
  assert.deepEqual(planDays(hours, DAY.tz).map((d) => [d.key, d.n]), [[REPLAY.day, 24]]);
  assert.equal(REPLAY.place.lat, DAY.lat); assert.equal(REPLAY.place.lon, DAY.lon); assert.equal(REPLAY.place.tz, DAY.tz);
});

test("coach plan on the record day: 6 AM–8 AM green window, black flag hours inside practice hours, same as the replay", () => {
  const scored = scoreHours(replayHours(DAY), UIL3, REPLAY.place);
  const plan = coachPlan(scored, { tz: DAY.tz, day: REPLAY.day, duration: 2, earliest: 6, latest: 21 });
  const rp = replayDay(DAY);
  assert.equal(plan.rows.length, 15, "6 AM through 8 PM");
  assert.equal(localHour(plan.rows[0].t, DAY.tz), 6);
  assert.equal(plan.best.startT, rp.rows[rp.best.start].t, "same window as the validation replay");
  assert.equal(localHour(plan.best.startT, DAY.tz), 6);
  assert.equal(plan.best.endT - plan.best.startT, 2 * 3600e3);
  assert.equal(plan.worst.level, "green");
  assert.equal(plan.peak.level, "black");
  assert.equal(plan.flagHours.black, rp.flagHours.black, "every black hour falls inside practice hours");
  assert.deepEqual(plan.levels, [...plan.levels].sort((a, b) => ["green", "yellow", "orange", "red", "black"].indexOf(a) - ["green", "yellow", "orange", "red", "black"].indexOf(b)));
  assert.ok(plan.levels.includes("green") && plan.levels.includes("black"));
  assert.equal(plan.partial, false);
});

test("coach plan edge cases: no window, whole-day hours, a forecast that spans two days (DST-aware day keys)", () => {
  const scored = scoreHours(replayHours(DAY), UIL3, REPLAY.place);
  assert.equal(coachPlan(scored, { tz: DAY.tz, day: REPLAY.day, duration: 5, earliest: 6, latest: 9 }).best, null, "5 h can't fit in 6–9 AM");
  const whole = coachPlan(scored, { tz: DAY.tz, day: REPLAY.day, duration: 2, earliest: 7, latest: 7 });
  assert.equal(whole.rows.length, 24, "same start and finish = whole day");
  const outside = coachPlan(scored, { tz: DAY.tz, day: "2023-08-25", duration: 2, earliest: 6, latest: 21 });
  assert.equal(outside.rows.length, 0); assert.equal(outside.best, null);
  // 48 sample hours starting 2 PM CST on the day DST ends: three local days, keyed in Chicago time.
  const from = Date.UTC(2026, 10, 1, 20); // Nov 1 2026, 2 PM CST
  const days = planDays(sampleHours(from), SAMPLE_PLACE.tz);
  assert.deepEqual(days.map((d) => d.key), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  assert.equal(days.reduce((a, d) => a + d.n, 0), 48);
  assert.equal(days[1].n, 24);
  const p = coachPlan(scoreHours(sampleHours(from), UIL3, SAMPLE_PLACE), { tz: SAMPLE_PLACE.tz, day: "2026-11-02", duration: 2, earliest: 6, latest: 21 });
  assert.equal(p.rows.length, 15); assert.ok(p.best); assert.equal(p.partial, false);
  assert.equal(dayKey(Date.UTC(2026, 10, 2, 5, 30), "America/Chicago"), "2026-11-01", "11:30 PM CST is still Nov 1");
});

test("coach plan text: English and Spanish, every hour, the window, 911 and the replay label", () => {
  const scored = scoreHours(replayHours(DAY), UIL3, REPLAY.place);
  const plan = coachPlan(scored, { tz: DAY.tz, day: REPLAY.day, duration: 2, earliest: 6, latest: 21 });
  for (const lang of ["en", "es"]) {
    const S = STRINGS[lang], f = fmtFor(lang, DAY.tz);
    const txt = coachPlanText(plan, S, { ...f, place: DAY.name, activity: S.presets.football, guideline: S.gl_uil, uil: true, replay: true, duration: 2, water: hydrationPlan(2), url: "https://aariv.me/Heatwise/?replay=iah2023" });
    assert.ok(txt.startsWith(S.sheetTitle), lang);
    assert.ok(txt.includes(S.sheetReplayNote), `${lang}: labelled as a historical replay`);
    assert.ok(txt.includes(`${f.time(plan.best.startT)} – ${f.time(plan.best.endT)}`), `${lang}: window`);
    assert.ok(txt.includes("911"), `${lang}: 911`);
    assert.ok(txt.includes(S.uil_green), `${lang}: the window's UIL rule`);
    for (const h of plan.rows) assert.ok(txt.includes(f.time(h.t)), `${lang}: hour ${f.time(h.t)}`);
    assert.ok(txt.includes(S.level_black), `${lang}: black flag listed`);
    assert.ok(txt.includes("?replay=iah2023"));
  }
  const es = coachPlanText(plan, STRINGS.es, { ...fmtFor("es", DAY.tz), place: DAY.name, activity: "x", guideline: "y", uil: true, replay: true, duration: 2, water: hydrationPlan(2) });
  for (const w of ["Green", "Black", "Safest", "Water", "Before practice"]) assert.ok(!es.includes(w), `Spanish text has no English "${w}"`);
  assert.match(es, /a\.\s?m\./, "Spanish times use a. m.");
  // A too-long practice on a hot window gets the UIL cap warning.
  const late = coachPlan(scored, { tz: DAY.tz, day: REPLAY.day, duration: 2, earliest: 13, latest: 17 });
  const warn = coachPlanText(late, STRINGS.en, { ...fmtFor("en", DAY.tz), place: "", activity: "", guideline: "", uil: true, replay: true, duration: 2, water: hydrationPlan(2) });
  assert.ok(warn.includes("Black flag") || warn.includes("caps practice"), "cap warning when the window is red/black");
});

test("page wiring: replay button sits above the form, coach plan card + print-only sheet CSS, zip removed", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="replayBtn"') > 0 && html.indexOf('id="replayBtn"') < html.indexOf('id="planForm"'), "replay button before the form");
  for (const id of ["replayBanner", "coachCard", "planDay", "sheetLang", "coachPrintBtn", "coachShareBtn", "coachSheet"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(css, /body\.print-coach #results > \*:not\(#coachCard\)/);
  assert.match(css, /\.sheet \+ \.sheet \{ break-before: page; \}/, "each language prints on its own page");
  assert.ok(app.includes('from "./plan.js"') && app.includes("isReplay"));
  assert.ok(STRINGS.en.replayBtn.includes("Aug 24, 2023") && STRINGS.es.replayBtn.includes("24 ago 2023"));
  assert.match(STRINGS.en.replayBanner, /HISTORICAL REPLAY, not a forecast/);
  assert.match(STRINGS.es.replayBanner, /REPETICIÓN HISTÓRICA, no es un pronóstico/);
  for (const lang of ["en", "es"]) {
    assert.ok(STRINGS[lang].sheetCheck3.includes("911") && STRINGS[lang].sheetMeasure.includes("15") && STRINGS[lang].sheetMeasure.includes("30"), lang);
    assert.match(STRINGS[lang].chartAriaReplay("78°F", "94°F", "6 AM – 8 AM"), /2023/);
  }
  assert.ok(!fs.existsSync(new URL("../heatwise.zip", import.meta.url)), "stale heatwise.zip removed");
});

// ---------- place search (js/places.js): real Open-Meteo geocoding answers, trimmed (Oct 11, 2026) ----------
const G = (name, admin1, cc, population, lat = 29.7, lon = -95.4) => ({ name, admin1, country_code: cc, population, latitude: lat, longitude: lon });
const GEO_FX = {
  Houston: [G("Houston", "Texas", "US", 2314157), G("Houston", "Missouri", "US", 2082), G("Houston", "Mississippi", "US", 3544), G("Houston", "Alaska", "US", 2206), G("Houston", "Pennsylvania", "US", 1266)],
  Katy: [G("Katy", "Texas", "US", 16158), G("Kąty", "Podlasie", "PL"), G("Kąty", "Podlasie", "PL"), G("Kąty", "Mazovia", "PL"), G("Kąty", "Podlasie", "PL")],
  Pasadena: [G("Pasadena", "Texas", "US", 153784), G("Pasadena", "California", "US", 142250), G("Pasadena", "Maryland", "US", 24287), G("Pasadena", "Newfoundland and Labrador", "CA", 3620), G("Pasadena", "Mimaropa", "PH")],
  Spring: [G("Spring", "Texas", "US", 54298), G("Şpring", "Alba County", "RO", 2492), G("Spring", "Brandenburg", "DE")],
  Cypress: [G("Cypress", "Texas", "US", 200839), G("Cypress", "California", "US", 49290), G("Cypress", "Illinois", "US", 236)],
};

test("place search: parseQuery splits the state/country hint off the name", () => {
  assert.deepEqual(parseQuery("Sugar Land, TX"), { main: "Sugar Land", hint: "tx" });
  assert.deepEqual(parseQuery("  77479 "), { main: "77479", hint: "" });
  assert.deepEqual(parseQuery("Pasadena, California, US"), { main: "Pasadena", hint: "california us" });
  assert.equal(Object.keys(US_STATES).length, 52, "50 states + DC + Puerto Rico");
});

test("place search: Houston-area towns open straight away; truly ambiguous names still ask", () => {
  // Before: every one of these showed a 'pick a place' list (Katy listed Polish villages), one extra tap on a phone.
  for (const q of ["Houston", "Katy", "Spring"]) {
    const pick = autoPick(rankPlaces(GEO_FX[q]));
    assert.ok(pick, q + " auto-picks");
    assert.equal(pick.name, `${q}, Texas, US`);
  }
  // Pasadena TX vs CA are about the same size: show the list, Texas first (bigger).
  const pas = rankPlaces(GEO_FX.Pasadena);
  assert.equal(autoPick(pas), null);
  assert.equal(pas[0].name, "Pasadena, Texas, US");
  assert.equal(autoPick(rankPlaces(GEO_FX.Cypress)), null, "Cypress TX is only 4x Cypress CA: ask");
  // A state hint decides it, whole-word only.
  assert.equal(autoPick(rankPlaces(GEO_FX.Pasadena, "california")).name, "Pasadena, California, US");
  assert.equal(autoPick(rankPlaces(GEO_FX.Pasadena, "md")).name, "Pasadena, Maryland, US");
  assert.equal(autoPick(rankPlaces(GEO_FX.Houston, "ms")).name, "Houston, Mississippi, US");
  assert.equal(rankPlaces(GEO_FX.Houston, "texas")[0].score, 1);
  assert.equal(rankPlaces(GEO_FX.Houston, "atx").every((r) => r.score === 0), true, "'tx' inside another word is not a hint");
  // Edge cases: nothing, one result, tiny places with no population never auto-pick on size alone.
  assert.equal(autoPick(rankPlaces([])), null);
  assert.equal(autoPick(rankPlaces([G("Sugar Land", "Texas", "US", 88156)])).name, "Sugar Land, Texas, US");
  assert.equal(autoPick(rankPlaces([G("A", "Texas", "US", 500), G("A", "Ohio", "US")])), null);
  assert.ok(rankPlaces(GEO_FX.Houston.concat(GEO_FX.Katy)).length <= 5);
});

atest("place search: a stalled connection times out instead of leaving 'Searching…' up forever", async () => {
  const hang = (url, { signal } = {}) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const t0 = Date.now();
  await assert.rejects(searchPlaces("Katy", "en", { fetchImpl: hang, timeoutMs: 40 }));
  assert.ok(Date.now() - t0 < 1000, "gave up quickly");
  let seen = "";
  const ok = async (url) => { seen = url; return { ok: true, status: 200, json: async () => ({ results: GEO_FX.Katy }) }; };
  const r = await searchPlaces("Katy, TX", "es", { fetchImpl: ok });
  assert.match(seen, /name=Katy&count=8&language=es/);
  assert.equal(r.pick.name, "Katy, Texas, US");
  const bad = async () => ({ ok: false, status: 429, json: async () => ({ error: true, reason: "limit" }) });
  await assert.rejects(searchPlaces("Katy", "en", { fetchImpl: bad }), /limit/);
  const empty = async () => ({ ok: true, status: 200, json: async () => ({ generationtime_ms: 0.1 }) });
  assert.deepEqual(await searchPlaces("zzzz", "en", { fetchImpl: empty }), { ranked: [], pick: null });
});

test("page wiring: on a phone the plan's answer (this hour + safest window) comes before the source and WBGT notes", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.ok(at("replayBanner") < at("nowCard") && at("sampleBanner") < at("nowCard"), "replay/sample labels stay above the answer");
  assert.ok(at("bestCard") < at("forecastSource") && at("bestCard") < at("wbgtHelp"), "answer first");
  assert.ok(app.includes('from "./places.js"') && !app.includes("async function geocode"), "search goes through places.js");
});

test("all-clear: only when every allowed hour is green/lower risk (EN/ES strings exist)", () => {
  const mk = (levels) => levels.map((level, i) => ({ t: i * 3600e3, level }));
  assert.equal(allClear(mk(["green", "green", "low"])), true);
  assert.equal(allClear(mk(["green", "yellow", "green"])), false);
  assert.equal(allClear(mk(["green", "red", "green"]), (h, i) => i !== 1), true, "disallowed red hour is ignored");
  assert.equal(allClear(mk(["green"]), () => false), false, "no allowed hours is not all clear");
  assert.equal(allClear(mk(["caution"])), false);
  for (const lang of ["en", "es"]) for (const k of ["allClearUil", "allClearOsha"]) assert.ok(STRINGS[lang][k] && STRINGS[lang][k].length > 20, `${lang}.${k}`);
  assert.ok(fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8").includes("allClear(scored, allowed)"), "wired into the safest-window card");
});

{
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const om = { latitude: 29.7, longitude: -95.3, utc_offset_seconds: -18000, timezone: "America/Chicago", timezone_abbreviation: "CDT",
    hourly: { time: ["2026-10-11T12:00"], temperature_2m: [30], relative_humidity_2m: [50], wind_speed_10m: [10], shortwave_radiation: [500], direct_radiation: [400], diffuse_radiation: [100], surface_pressure: [1010], cloud_cover: [10] } };
  let calls = 0, mode = "ok";
  const f = async () => { calls++; if (mode === "429") return { ok: false, status: 429, json: async () => ({ reason: "rate" }) }; return { ok: true, status: 200, json: async () => om }; };
  atest("forecast cache: repeat lookup within 30 min makes no new requests", async () => {
    const st = mem(); const t0 = 1e12;
    const a = await getForecastCached(29.7, -95.3, { storage: st, now: t0, fetchImpl: f, useNws: false });
    assert.equal(a.cachedAt, null); const n = calls;
    const b = await getForecastCached(29.7, -95.3, { storage: st, now: t0 + 10 * 60e3, fetchImpl: f, useNws: false });
    assert.equal(calls, n); assert.equal(b.cachedAt, t0);
  });
  atest("forecast cache: 429 after expiry falls back to the saved answer up to 3 h, then throws", async () => {
    const st = mem(); const t0 = 1e12; mode = "ok";
    await getForecastCached(29.7, -95.3, { storage: st, now: t0, fetchImpl: f, useNws: false });
    mode = "429";
    const b = await getForecastCached(29.7, -95.3, { storage: st, now: t0 + CACHE_TTL_MS + 60e3, fetchImpl: f, useNws: false });
    assert.equal(b.cachedAt, t0);
    await assert.rejects(getForecastCached(29.7, -95.3, { storage: st, now: t0 + 4 * 3600e3, fetchImpl: f, useNws: false }));
    mode = "ok";
  });
  atest("forecast cache: no storage still works; EN/ES label has {n}", async () => {
    const r = await getForecastCached(29.7, -95.3, { fetchImpl: f, useNws: false, now: 2e12 });
    assert.equal(r.cachedAt, null);
    assert.ok(STRINGS.en.cachedAgo.includes("{n}") && STRINGS.es.cachedAgo.includes("{n}"));
  });
}

for (const [name, fn] of atests) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.error("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}


console.log(`\n${passed} tests passed${process.exitCode ? " (with failures above)" : ""}.`);
