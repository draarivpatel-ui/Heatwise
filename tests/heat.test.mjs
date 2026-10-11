// Run with: node tests/heat.test.mjs   (Node 18+; no dependencies)
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  heatIndexF, wbgtApprox, vaporPressure, limitFor, riskLevel, scoreHours, bestWindow, hourAllowed,
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
  const app = compareWbgt(NWS, OM, { mode: "app" });
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

console.log(`\n${passed} tests passed${process.exitCode ? " (with failures above)" : ""}.`);
