// HeatWise core math. Pure functions, no DOM, so they run in the browser and in Node tests.
// Every constant below comes from a public source; see README "How it works" and "Sources".

/* ------------------------------------------------------------------------------------------
 * 1. Guideline tables
 * ---------------------------------------------------------------------------------------- */

/**
 * Heat-stress limits by workload, in °C of effective WBGT.
 * Source: OSHA "Heat Hazard Recognition", Table 2 "Heat stress recommendations, adapted from
 * NIOSH guidelines (2016)": unacclimatized = Action Limit, acclimatized = Threshold Limit Value.
 * https://www.osha.gov/heat-exposure/hazards
 */
export const WORKLOADS = {
  light:     { unacclimatized: 28, acclimatized: 30 },
  moderate:  { unacclimatized: 25, acclimatized: 28 },
  heavy:     { unacclimatized: 23, acclimatized: 26 },
  veryHeavy: { unacclimatized: 21, acclimatized: 25 },
};

/** Clothing adjustment factors (°C added to WBGT). Same OSHA page, adapted from NIOSH 2016. */
export const CLOTHING = {
  work: 0,         // work clothing (baseline)
  cloth: 0,        // cloth coveralls
  sms: 0.5,        // spunbond melt-blown synthetic (SMS) coveralls
  polyolefin: 1,   // polyolefin coveralls
  double: 3,       // double-layer cloth clothing
  vapor: 11,       // limited-use vapor-barrier coveralls
};

/**
 * Texas UIL WBGT activity guidelines for outdoor athletics and marching band (°F of WBGT).
 * Each number is the lower edge of the next flag: below the 1st = green, below the 2nd = yellow,
 * below the 3rd = orange, below the 4th = red, otherwise black.
 * Class 3: <82.0 | 82.0–86.9 | 87.0–90.0 | 90.1–92.0 | ≥92.1
 * Class 2: <79.7 | 79.7–84.6 | 84.7–87.6 | 87.7–89.7 | ≥89.8
 * Source: UIL, 2025-26 Heat Plan Recommendations (WBGT Activity Guidelines table) and the
 * 2026-27 "Heat Stress & Athletic Participation REQUIRED Plan" page (same chart; required from
 * Aug 1, 2026). Thresholds are UIL's modification of ACSM guidance.
 */
export const UIL_CLASSES = {
  3: [82.0, 87.0, 90.1, 92.1],
  2: [79.7, 84.7, 87.7, 89.8],
};
export const UIL_FLAGS = ["green", "yellow", "orange", "red", "black"];
/** Maximum practice length (hours) per UIL flag. Infinity = no cap stated; 0 = no outdoor workouts. */
export const UIL_MAX_HOURS = { green: Infinity, yellow: Infinity, orange: 2, red: 1, black: 0 };

export const cToF = (c) => (c * 9) / 5 + 32;
export const fToC = (f) => ((f - 32) * 5) / 9;

/* ------------------------------------------------------------------------------------------
 * 2. Simple WBGT (temperature + humidity only): Australian Bureau of Meteorology / ACSM
 * ---------------------------------------------------------------------------------------- */

/**
 * Water vapour pressure in hPa from air temp (°C) and relative humidity (%).
 * Source: Australian Bureau of Meteorology, Thermal Comfort observations.
 * http://www.bom.gov.au/info/thermal_stress/
 */
export function vaporPressure(tC, rh) {
  return (rh / 100) * 6.105 * Math.exp((17.27 * tC) / (237.7 + tC));
}

/**
 * Approximate WBGT (°C) from temperature and humidity only: WBGT = 0.567*Ta + 0.393*e + 3.94.
 * BoM: assumes "moderately sunny, light wind"; overestimates in cloud, wind, at night or low sun,
 * and slightly underestimates in clear full sun with low humidity. Used only as a fallback when
 * radiation/wind data are missing.
 */
export function wbgtApprox(tC, rh) {
  return 0.567 * tC + 0.393 * vaporPressure(tC, rh) + 3.94;
}

/* ------------------------------------------------------------------------------------------
 * 3. Physics WBGT: Liljegren et al. (2008)
 *    Liljegren JC, Carhart RA, Lawday P, Tschopp S, Sharp R. Modeling the Wet Bulb Globe
 *    Temperature Using Standard Meteorological Measurements. J Occup Environ Hyg 5(10):645-655.
 *    Ported from Argonne's public C code (WBGT v1.1) as distributed in the open-source pywbgt
 *    package; tests/heat.test.mjs checks this port against pywbgt reference values.
 * ---------------------------------------------------------------------------------------- */

const STEFANB = 5.6696e-8;
const CP = 1003.5;
const M_AIR = 28.97;
const M_H2O = 18.015;
const RATIO = (CP * M_AIR) / M_H2O;
const R_GAS = 8314.34;
const R_AIR = R_GAS / M_AIR;
const PR = CP / (CP + 1.25 * R_AIR);
const EMIS_WICK = 0.95, ALB_WICK = 0.4, D_WICK = 0.007, L_WICK = 0.0254;
const EMIS_GLOBE = 0.95, ALB_GLOBE = 0.05, D_GLOBE = 0.0508;
const EMIS_SFC = 0.999, ALB_SFC = 0.45;
const CZA_MIN = 0.00873, NORMSOLAR_MAX = 0.85, SOLAR_CONST = 1367;
const CONVERGENCE = 0.02, MAX_ITER = 50;
/** Minimum 2-m wind speed: 2 knots, pywbgt's default floor (the C code's own floor is 0.13 m/s). */
export const MIN_SPEED = 1.0288889;

/** Saturation vapour pressure over water, hPa (Buck 1981), with the C code's 1.004 enhancement. */
function esatK(tk) {
  const y = (tk - 273.15) / (tk - 32.18);
  return 1.004 * 6.1121 * Math.exp(17.502 * y);
}
function dewPointK(e) {
  const z = Math.log(e / (6.1121 * 1.004));
  return 273.15 + (240.97 * z) / (17.502 - z);
}
const emisAtm = (tk, rhFrac) => 0.575 * Math.pow(rhFrac * esatK(tk), 0.143);
const evapHeat = (tk) => ((313.15 - tk) / 30) * -71100 + 2.4073e6;
function viscosity(tk) {
  const sigma = 3.617, epsKappa = 97.0;
  const tr = tk / epsKappa;
  const omega = ((tr - 2.9) / 0.4) * -0.034 + 1.048;
  return (2.6693e-6 * Math.sqrt(M_AIR * tk)) / (sigma * sigma * omega);
}
const thermalCond = (tk) => (CP + 1.25 * R_AIR) * viscosity(tk);
function diffusivity(tk, p) {
  const pcA = 36.4, pcW = 218, tcA = 132, tcW = 647.3, a = 3.64e-4, b = 2.334;
  const pc13 = Math.pow(pcA * pcW, 1 / 3);
  const tc512 = Math.pow(tcA * tcW, 5 / 12);
  const tc12 = Math.sqrt(tcA * tcW);
  const mmix = Math.sqrt(1 / M_AIR + 1 / M_H2O);
  const patm = p / 1013.25;
  return ((a * Math.pow(tk / tc12, b) * pc13 * tc512 * mmix) / patm) * 1e-4;
}
function hSphere(d, tk, p, speed) {
  const density = (p * 100) / (R_AIR * tk);
  const re = (speed * density * d) / viscosity(tk);
  const nu = 2.0 + 0.6 * Math.sqrt(re) * Math.pow(PR, 0.3333);
  return (nu * thermalCond(tk)) / d;
}
function hCylinder(d, tk, p, speed) {
  const a = 0.56, b = 0.281, c = 0.4;
  const density = (p * 100) / (R_AIR * tk);
  const re = (speed * density * d) / viscosity(tk);
  const nu = b * Math.pow(re, 1 - c) * Math.pow(PR, 1 - a);
  return (nu * thermalCond(tk)) / d;
}

/** Black-globe temperature, °C. tk in K, rhFrac 0–1, p in hPa, speed m/s (2 m), solar W/m². */
export function globeTemp(tk, rhFrac, p, speed, solar, fdir, cza) {
  const tsfc = tk;
  let prev = tk, next = NaN;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const tref = 0.5 * (prev + tk);
    const h = hSphere(D_GLOBE, tref, p, speed);
    next = Math.pow(
      0.5 * (emisAtm(tk, rhFrac) * tk ** 4 + EMIS_SFC * tsfc ** 4)
        - (h / (STEFANB * EMIS_GLOBE)) * (prev - tk)
        + (solar / (2 * STEFANB * EMIS_GLOBE)) * (1 - ALB_GLOBE) * (fdir * (1 / (2 * cza) - 1) + 1 + ALB_SFC),
      0.25,
    );
    if (Math.abs(next - prev) < CONVERGENCE) return next - 273.15;
    prev = 0.9 * prev + 0.1 * next;
  }
  return NaN;
}

/** Natural (rad = true) or psychrometric (rad = false) wet-bulb temperature, °C. */
export function wetBulbTemp(tk, rhFrac, p, speed, solar, fdir, cza, rad = true) {
  const a = 0.56;
  const tsfc = tk;
  const sza = Math.acos(Math.max(-1, Math.min(1, cza)));
  const eair = rhFrac * esatK(tk);
  let prev = dewPointK(eair), next = NaN;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const tref = 0.5 * (prev + tk);
    let heat = 0;
    if (rad) {
      const fatm = STEFANB * EMIS_WICK
          * (0.5 * (emisAtm(tk, rhFrac) * tk ** 4 + EMIS_SFC * tsfc ** 4) - prev ** 4)
        + (1 - ALB_WICK) * solar
          * ((1 - fdir) * (1 + (0.25 * D_WICK) / L_WICK)
            + fdir * (Math.tan(sza) / Math.PI + (0.25 * D_WICK) / L_WICK) + ALB_SFC);
      heat = fatm / hCylinder(D_WICK, tref, p, speed);
    }
    const ewick = esatK(prev);
    const density = (p * 100) / (R_AIR * tref);
    const sc = viscosity(tref) / (density * diffusivity(tref, p));
    next = tk - (evapHeat(tref) / RATIO) * ((ewick - eair) / (p - ewick)) * Math.pow(PR / sc, a) + heat;
    if (Math.abs(next - prev) < CONVERGENCE) return next - 273.15;
    prev = 0.9 * prev + 0.1 * next;
  }
  return NaN;
}

/**
 * Sun position (NOAA "General Solar Position Calculations" fractional-year method).
 * @param {number} utcMs  time in ms since epoch (UTC)
 * @returns {{cza:number, distFactor:number}} cosine of zenith angle and (r0/r)^2
 */
export function solarPosition(utcMs, lat, lon) {
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const doy = Math.floor((utcMs - Date.UTC(y, 0, 1)) / 864e5) + 1;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / (leap ? 366 : 365)) * (doy - 1 + (hour - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eqtime + 4 * lon; // true solar time, minutes
  const ha = ((tst / 4 - 180) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cza = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const distFactor = 1.00011 + 0.034221 * Math.cos(g) + 0.00128 * Math.sin(g)
    + 0.000719 * Math.cos(2 * g) + 0.000077 * Math.sin(2 * g);
  return { cza, distFactor };
}

/** Liljegren's solar adjustment: caps normalized irradiance and estimates the direct-beam fraction. */
export function solarParams(solar, cza, distFactor = 1) {
  let toa = SOLAR_CONST * Math.max(0, cza) * distFactor;
  if (cza < CZA_MIN) toa = 0;
  if (toa <= 0) return { solar: 0, fdir: 0 };
  const norm = Math.min(Math.max(0, solar) / toa, NORMSOLAR_MAX);
  const fdir = norm > 0 ? Math.max(0, Math.min(0.9, Math.exp(3 - 1.34 * norm - 1.65 / norm))) : 0;
  return { solar: norm * toa, fdir };
}

/** EPA stability class (1–6) used to scale 10-m wind to 2 m (EPA-454/5-99-005 via Liljegren). */
function stabilityClass(daytime, speed, solar, dT = -1) {
  const table = [
    [1, 1, 2, 4, 0, 5, 6, 0],
    [1, 2, 3, 4, 0, 5, 6, 0],
    [2, 2, 3, 4, 0, 4, 4, 0],
    [3, 3, 4, 4, 0, 0, 0, 0],
    [3, 4, 4, 4, 0, 0, 0, 0],
  ];
  let i, j;
  if (daytime) {
    j = solar >= 925 ? 0 : solar >= 675 ? 1 : solar >= 175 ? 2 : 3;
    i = speed >= 6 ? 4 : speed >= 5 ? 3 : speed >= 3 ? 2 : speed >= 2 ? 1 : 0;
  } else {
    j = dT >= 0 ? 6 : 5;
    i = speed >= 2.5 ? 2 : speed >= 2 ? 1 : 0;
  }
  return table[i][j];
}

/** Estimate 2-m wind from 10-m wind (rural power law), floored at MIN_SPEED. */
export function windAt2m(speed10, daytime, solar) {
  const rural = [0.07, 0.07, 0.1, 0.15, 0.35, 0.55];
  const cls = stabilityClass(daytime, speed10, solar);
  return Math.max(speed10 * Math.pow(2 / 10, rural[cls - 1]), MIN_SPEED);
}

/**
 * Outdoor WBGT in the sun (°C) with the Liljegren model.
 * @param {{tempC:number, rh:number, pressure?:number, wind10?:number, solar:number, cza:number, distFactor?:number}} w
 * @returns {{wbgt:number, tg:number, tnwb:number, speed:number}}
 */
export function wbgtLiljegren(w) {
  const tk = w.tempC + 273.15;
  const rhFrac = Math.max(0.01, Math.min(1, w.rh / 100));
  const p = w.pressure ?? 1013.25;
  const sp = solarParams(w.solar, w.cza, w.distFactor ?? 1);
  const daytime = w.cza > 0;
  const speed = windAt2m(Math.max(0, w.wind10 ?? 0), daytime, sp.solar);
  const cza = Math.max(w.cza, CZA_MIN); // only matters when solar > 0, which already requires cza >= CZA_MIN
  const tg = globeTemp(tk, rhFrac, p, speed, sp.solar, sp.fdir, cza);
  const tnwb = wetBulbTemp(tk, rhFrac, p, speed, sp.solar, sp.fdir, cza, true);
  if (!Number.isFinite(tg) || !Number.isFinite(tnwb)) return { wbgt: NaN, tg, tnwb, speed };
  return { wbgt: 0.1 * w.tempC + 0.2 * tg + 0.7 * tnwb, tg, tnwb, speed };
}

/* ------------------------------------------------------------------------------------------
 * 4. NWS heat index (shown for familiarity only)
 * ---------------------------------------------------------------------------------------- */

/** NWS heat index (°F): Rothfusz regression with NWS adjustments.
 *  https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml */
export function heatIndexF(T, RH) {
  const simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094);
  const avg = (simple + T) / 2;
  if (avg < 80) return avg;
  let HI =
    -42.379 + 2.04901523 * T + 10.14333127 * RH - 0.22475541 * T * RH -
    0.00683783 * T * T - 0.05481717 * RH * RH + 0.00122874 * T * T * RH +
    0.00085282 * T * RH * RH - 0.00000199 * T * T * RH * RH;
  if (RH < 13 && T >= 80 && T <= 112) {
    HI -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  } else if (RH > 85 && T >= 80 && T <= 87) {
    HI += ((RH - 85) / 10) * ((87 - T) / 5);
  }
  return HI;
}

/* ------------------------------------------------------------------------------------------
 * 5. Scoring
 * ---------------------------------------------------------------------------------------- */

/** OSHA/NIOSH limit (°C effective WBGT) for a workload + acclimatization status. */
export function limitFor(workload, acclimatized) {
  const w = WORKLOADS[workload];
  if (!w) throw new Error(`Unknown workload: ${workload}`);
  return acclimatized ? w.acclimatized : w.unacclimatized;
}

/**
 * HeatWise bands around the OSHA/NIOSH limit. The limit is OSHA/NIOSH's; the ±2 °C bands are a
 * HeatWise design choice (documented in the README), not an official category.
 */
export function riskLevel(margin) {
  if (margin < -2) return "low";
  if (margin <= 0) return "caution";
  if (margin <= 2) return "high";
  return "extreme";
}

/** UIL flag for a WBGT in °C. */
export function uilFlag(wbgtC, uilClass = 3) {
  const edges = UIL_CLASSES[uilClass];
  if (!edges) throw new Error(`Unknown UIL class: ${uilClass}`);
  const f = Math.round(cToF(wbgtC) * 10) / 10; // readings are reported to 0.1 °F
  let i = 0;
  while (i < edges.length && f >= edges[i]) i++;
  return UIL_FLAGS[i];
}

/** Severity index 0..4 shared by both guideline systems (used for colors and comparisons). */
export const SEVERITY = { low: 0, caution: 1, high: 2, extreme: 3, green: 0, yellow: 1, orange: 2, red: 3, black: 4 };

/**
 * Estimate WBGT for one hour. Uses Liljegren when radiation and the sun angle are known,
 * otherwise falls back to the BoM approximation.
 * @param {{t:number, tempC:number, rh:number, radiation?:number, wind10?:number, pressure?:number}} h
 * @param {{lat:number, lon:number}|null} place
 */
export function estimateWbgt(h, place) {
  if (place && Number.isFinite(h.radiation) && Number.isFinite(h.t)) {
    // Radiation is the mean of the preceding hour, so evaluate the sun at the middle of that hour.
    const sun = solarPosition(h.t - 30 * 60e3, place.lat, place.lon);
    const r = wbgtLiljegren({
      tempC: h.tempC, rh: h.rh, pressure: h.pressure, wind10: h.wind10,
      solar: h.radiation, cza: sun.cza, distFactor: sun.distFactor,
    });
    if (Number.isFinite(r.wbgt)) return { wbgt: r.wbgt, model: "liljegren", tg: r.tg, tnwb: r.tnwb };
  }
  return { wbgt: wbgtApprox(h.tempC, h.rh), model: "bom" };
}

/**
 * Turn raw hourly weather into scored hours.
 * profile.guideline: "osha" (workload limit) or "uil" (Texas UIL WBGT flags).
 * margin: °C above the threshold that matters (OSHA limit, or the top of UIL green). Lower is safer.
 */
export function scoreHours(hours, profile, place = null) {
  const guideline = profile.guideline === "uil" ? "uil" : "osha";
  const limit = limitFor(profile.workload ?? "moderate", !!profile.acclimatized);
  const clothingAdj = CLOTHING[profile.clothing] ?? 0;
  const uilClass = UIL_CLASSES[profile.uilClass] ? Number(profile.uilClass) : 3;
  const greenTopC = fToC(UIL_CLASSES[uilClass][0]);
  return hours.map((h) => {
    const est = estimateWbgt(h, place);
    const eff = est.wbgt + clothingAdj;
    const base = {
      ...h,
      wbgt: est.wbgt,
      model: est.model,
      heatIndexF: heatIndexF(cToF(h.tempC), h.rh),
      likelyOverestimate: est.model === "bom" && (h.isDay === 0 || (h.radiation != null && h.radiation < 200)),
    };
    if (guideline === "uil") {
      const level = uilFlag(est.wbgt, uilClass);
      return { ...base, effWbgt: est.wbgt, limit: greenTopC, margin: est.wbgt - greenTopC, level, maxHours: UIL_MAX_HOURS[level] };
    }
    const margin = eff - limit;
    return { ...base, effWbgt: eff, limit, margin, level: riskLevel(margin), maxHours: Infinity };
  });
}

/* ------------------------------------------------------------------------------------------
 * 6. Safest window (minimax, O(n))
 * ---------------------------------------------------------------------------------------- */

/**
 * Among all runs of `duration` consecutive allowed hours, return the one whose WORST hour has the
 * smallest margin (minimax). Ties go to the earliest start. Monotonic-deque sliding-window
 * maximum, O(n).
 * @returns {{start:number,end:number,worstMargin:number}|null}  end is inclusive
 */
export function bestWindow(scored, duration, allowed = () => true) {
  const d = Math.max(1, Math.round(duration));
  let best = null;
  const dq = new Array(scored.length);
  let head = 0, tail = 0; // dq[head..tail) holds indices with decreasing margins
  let runStart = 0;
  for (let i = 0; i < scored.length; i++) {
    if (!allowed(scored[i], i)) { head = tail = 0; runStart = i + 1; continue; }
    while (tail > head && scored[dq[tail - 1]].margin <= scored[i].margin) tail--;
    dq[tail++] = i;
    const start = i - d + 1;
    if (start < runStart) continue;
    while (dq[head] < start) head++;
    const worst = scored[dq[head]].margin;
    if (best === null || worst < best.worstMargin - 1e-9) best = { start, end: i, worstMargin: worst };
  }
  return best;
}

/**
 * Is hour-of-day `hr` inside the allowed daily window [earliest, latest)?
 * Supports overnight windows (e.g. earliest 20, latest 6). earliest === latest means all day.
 */
export function hourAllowed(hr, earliest, latest) {
  if (earliest === latest || (earliest === 0 && latest === 24)) return true;
  if (earliest < latest) return hr >= earliest && hr < latest;
  return hr >= earliest || hr < latest;
}

/* ------------------------------------------------------------------------------------------
 * 7. Hydration and acclimatization
 * ---------------------------------------------------------------------------------------- */

/**
 * NIOSH (CDC Workplace Recommendations): for moderate activity in the heat lasting under 2 hours,
 * 1 cup (8 oz) every 15–20 minutes; generally no more than 6 cups (48 oz) per hour; if sweating
 * lasts several hours, sports drinks with balanced electrolytes; water cooler than 15 °C (59 °F).
 * https://www.cdc.gov/niosh/heat-stress/recommendations/index.html
 */
export function hydrationPlan(durationHours) {
  const minutes = Math.max(0, durationHours * 60);
  const cupsLow = Math.ceil(minutes / 20);
  const cupsHigh = Math.ceil(minutes / 15);
  return {
    intervalMin: [15, 20],
    cupsLow, cupsHigh,
    ozLow: cupsLow * 8, ozHigh: cupsHigh * 8,
    maxOzPerHour: 48,
    electrolytes: durationHours >= 2, // NIOSH's water-only cup rule is scoped to activity under 2 h
  };
}

/**
 * NIOSH acclimatization schedule (percent of usual time in the heat, per day).
 * New workers: ≤20% on day 1, then no more than +20% each day.
 * Experienced workers: ≤50%, 60%, 80%, 100% on days 1–4.
 */
export function acclimatizationSchedule(usualMinutes, isNew) {
  const pcts = isNew ? [20, 40, 60, 80, 100] : [50, 60, 80, 100];
  return pcts.map((pct, i) => ({ day: i + 1, pct, minutes: Math.round((usualMinutes * pct) / 100) }));
}

/* ------------------------------------------------------------------------------------------
 * 8. Synthetic sample day (demo / offline). Clearly labelled in the UI. Not real weather.
 * ---------------------------------------------------------------------------------------- */

export const SAMPLE_PLACE = { name: "Sample (Sugar Land, TX area)", lat: 29.62, lon: -95.63, tz: "America/Chicago" };

/**
 * 48 synthetic hours starting at the top of the hour containing `fromMs`, in America/Chicago.
 * Humid late-summer curve: ~23 °C (73 °F) near dawn, ~34 °C (93 °F) mid-afternoon; humidity moves
 * the other way; clear-sky-like sun (70% of top-of-atmosphere) and a light 2.5 m/s breeze.
 */
export function sampleHours(fromMs = Date.now(), place = SAMPLE_PLACE) {
  const start = Math.floor(fromMs / 3600e3) * 3600e3;
  const out = [];
  for (let i = 0; i < 48; i++) {
    const t = start + i * 3600e3;
    const hr = localHour(t, place.tz);
    const phase = Math.cos(((hr - 15) / 24) * 2 * Math.PI);
    const sun = solarPosition(t - 30 * 60e3, place.lat, place.lon);
    const radiation = sun.cza > CZA_MIN ? Math.round(0.7 * SOLAR_CONST * sun.cza * sun.distFactor) : 0;
    out.push({
      t,
      tempC: Math.round((28.5 + 5.5 * phase) * 10) / 10,
      rh: Math.round(65 - 20 * phase),
      radiation,
      wind10: 2.5,
      pressure: 1013,
      isDay: sun.cza > 0 ? 1 : 0,
    });
  }
  return out;
}

const hourFmtCache = new Map();
/** Local hour-of-day (0–23) of a UTC instant in an IANA time zone (DST-aware). */
export function localHour(utcMs, tz) {
  const key = tz || "local";
  let f = hourFmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", ...(tz ? { timeZone: tz } : {}) });
    hourFmtCache.set(key, f);
  }
  return Number(f.format(new Date(utcMs))) % 24;
}
