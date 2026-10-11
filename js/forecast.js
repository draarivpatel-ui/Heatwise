// HeatWise forecast inputs. No DOM: shared by the app, the validation study and the tests.
//
// U.S. places: temperature, humidity and wind come from the National Weather Service gridded forecast
// (api.weather.gov /points -> forecastGridData, the same NDFD grid behind the NWS heat index and WBGT
// forecasts). The NWS grid has no solar radiation, so sunshine and pressure still come from Open-Meteo.
// Everywhere else, or when the NWS request fails, every input comes from Open-Meteo (the fallback).
//
// Why: the validation study found that Open-Meteo's forecast for Houston ran 4.2 °F cooler and 8.7 RH
// points drier than the NWS forecast for the same hours, which made the app's WBGT 3.9 °F low (the
// unsafe direction) even though the formulas themselves match the NWS.
//
// NWS API usage (https://www.weather.gov/documentation/services-web-api): free and open, no key; a
// User-Agent identifying the app is required. Browsers do not let a page set User-Agent, so in the app
// the browser's own User-Agent is sent (the API answers browser requests and sends
// Access-Control-Allow-Origin: *); Node scripts send a descriptive one. Rate limits are not published;
// a limited request can be retried after ~5 s. Coordinates are rounded to 4 decimals (more decimals
// get a 301 redirect). Only CORS-safelisted headers are sent from the browser, so there is no preflight.

export const NWS_API = "https://api.weather.gov";
export const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";
export const NWS_USER_AGENT = "HeatWise heat-safety planner (github.com/draarivpatel-ui/Heatwise)";
const IS_BROWSER = typeof window !== "undefined" && typeof document !== "undefined";

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

/**
 * Rough boxes around the areas the NWS forecasts (contiguous U.S., Alaska, Hawaii, Puerto Rico and
 * the U.S. Virgin Islands, Guam and the Northern Marianas, American Samoa). Only used to skip a
 * pointless request for places that are clearly elsewhere; the /points answer (404 outside the NWS
 * area) is what decides.
 */
const NWS_BOXES = [
  [24, 50, -125, -66.5],   // contiguous U.S.
  [51, 72, -180, -129],    // Alaska
  [51, 55, 172, 180],      // western Aleutians
  [18.5, 22.5, -161, -154], // Hawaii
  [17.5, 18.8, -68, -64.4], // Puerto Rico, USVI
  [13, 21, 144, 146.5],    // Guam, Northern Marianas
  [-15, -11, -171.5, -168], // American Samoa
];
export const inNwsArea = (lat, lon) => NWS_BOXES.some(([a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d);

/** fetch() with a timeout; JSON body or a descriptive error (err.status set for HTTP errors). */
export async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 10000, headers = {} } = {}) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl?.signal });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) {
      const err = new Error(j.reason || j.detail || j.title || `HTTP ${res.status} ${url}`);
      err.status = res.status;
      throw err;
    }
    return j;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const nwsHeaders = () => (IS_BROWSER ? { Accept: "application/geo+json" } : { Accept: "application/geo+json", "User-Agent": NWS_USER_AGENT });

/**
 * NWS gridded forecast for a point: /points/{lat},{lon} -> forecastGridData. The grid endpoint now
 * and then answers 500/502/503 or 429 for a moment, so it is retried once after a short pause.
 * Throws if the point is outside the NWS area (404) or the API does not answer in time.
 */
export async function fetchNwsGrid(lat, lon, { fetchImpl = fetch, timeoutMs = 9000, retryDelayMs = 1200 } = {}) {
  const opts = { fetchImpl, timeoutMs, headers: nwsHeaders() };
  const meta = (await fetchJson(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, opts)).properties;
  if (!meta?.forecastGridData) throw new Error("NWS: no forecast grid for this point");
  let grid;
  try { grid = await fetchJson(meta.forecastGridData, opts); }
  catch (e) {
    if (!(e.status === 429 || e.status >= 500)) throw e;
    await new Promise((r) => setTimeout(r, retryDelayMs));
    grid = await fetchJson(meta.forecastGridData, opts);
  }
  return {
    props: grid.properties, gridUrl: meta.forecastGridData, timeZone: meta.timeZone,
    office: meta.gridId, city: meta.relativeLocation?.properties?.city, state: meta.relativeLocation?.properties?.state,
  };
}

// Unit conversions for the units the NWS grid can report.
const toC = (v, uom) => (uom === "wmoUnit:degF" ? ((v - 32) * 5) / 9 : uom === "wmoUnit:K" ? v - 273.15 : v);
const toKmh = (v, uom) => (uom === "wmoUnit:m_s-1" ? v * 3.6 : uom === "wmoUnit:km_h-1" || !uom ? v : uom === "wmoUnit:kn" ? v * 1.852 : uom === "wmoUnit:mi_h-1" ? v * 1.609344 : NaN);

/** Relative humidity (%) from temperature and dewpoint (°C), Magnus formula. */
export function rhFromDewpoint(tC, tdC) {
  const es = (x) => Math.exp((17.625 * x) / (243.04 + x));
  return Math.max(0, Math.min(100, (100 * es(tdC)) / es(tC)));
}

/** A grid issued more than this long ago is not trusted (normally the NWS updates it every hour or so). */
export const NWS_MAX_AGE_MS = 36 * 3600e3;

/**
 * Hourly inputs from an NWS grid (`properties` of the forecastGridData response):
 * Map(epochMs -> { tempC, rh, windKmh }). Hours before the hour of `updateTime` are skipped: the grid
 * keeps a few already-past hours that are not refreshed with the rest (the validation study saw a
 * 109 °F heat index next to a 79 °F WBGT in one of them). Missing values are skipped; RH falls back to
 * the dewpoint when the grid has no RH for an hour.
 */
export function nwsHourly(props) {
  const S = (k) => expandSeries(props?.[k]?.values);
  const T = S("temperature"), TD = S("dewpoint"), RH = S("relativeHumidity"), W = S("windSpeed");
  const tU = props?.temperature?.uom, dU = props?.dewpoint?.uom, wU = props?.windSpeed?.uom;
  const from = props?.updateTime ? Math.floor(Date.parse(props.updateTime) / 3600e3) * 3600e3 : -Infinity;
  const out = new Map();
  for (const [t, raw] of T) {
    if (t < from || typeof raw !== "number") continue;
    const tempC = toC(raw, tU);
    if (!isValidC(tempC)) continue;
    let rh = RH.get(t);
    if (!(typeof rh === "number" && rh >= 0 && rh <= 100)) {
      const td = typeof TD.get(t) === "number" ? toC(TD.get(t), dU) : NaN;
      rh = isValidC(td) ? rhFromDewpoint(tempC, td) : NaN;
    }
    if (!Number.isFinite(rh)) continue;
    const w = W.get(t);
    const windKmh = typeof w === "number" && w >= 0 ? toKmh(w, wU) : NaN;
    out.set(t, { tempC, rh, windKmh });
  }
  return out;
}

/**
 * Put NWS temperature, humidity and wind into the Open-Meteo hours. Sunshine (radiation), pressure and
 * day/night always stay Open-Meteo's. Each hour gets `src`: "nws" or "open-meteo" (an hour the NWS grid
 * does not cover keeps every Open-Meteo value). If an NWS hour has no wind, Open-Meteo's wind is kept.
 */
export function mergeInputs(omHours, nwsMap) {
  return omHours.map((h) => {
    const n = nwsMap?.get(h.t);
    if (!n) return { ...h, src: "open-meteo" };
    return { ...h, tempC: n.tempC, rh: n.rh, wind10: Number.isFinite(n.windKmh) ? n.windKmh / 3.6 : h.wind10, src: "nws" };
  });
}

/** Hours built from the NWS grid alone (used only if Open-Meteo fails): no sunshine, so heat.js uses its simpler formula. */
export function nwsOnlyHours(nwsMap) {
  return [...nwsMap].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({
    t, tempC: n.tempC, rh: n.rh, wind10: Number.isFinite(n.windKmh) ? n.windKmh / 3.6 : undefined, src: "nws",
  }));
}

/** Open-Meteo hourly forecast (all inputs). */
export async function fetchOpenMeteo(lat, lon, { fetchImpl = fetch, timeoutMs = 10000, days = 3 } = {}) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: "temperature_2m,relative_humidity_2m,shortwave_radiation,wind_speed_10m,surface_pressure,is_day",
    wind_speed_unit: "ms", forecast_days: String(days), timezone: "auto", timeformat: "unixtime",
  });
  const j = await fetchJson(`${OPEN_METEO_API}?${params}`, { fetchImpl, timeoutMs });
  const H = j.hourly;
  const hours = H.time.map((sec, i) => ({
    t: sec * 1000,
    tempC: H.temperature_2m[i],
    rh: H.relative_humidity_2m[i],
    radiation: H.shortwave_radiation?.[i] ?? undefined,
    wind10: H.wind_speed_10m?.[i] ?? undefined,
    pressure: H.surface_pressure?.[i] ?? undefined,
    isDay: H.is_day?.[i],
  })).filter((h) => Number.isFinite(h.tempC) && Number.isFinite(h.rh));
  return { hours, tz: j.timezone, tzAbbr: j.timezone_abbreviation };
}

function tzAbbrFor(tz, ms) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value || ""; }
  catch { return ""; }
}

/**
 * The forecast the planner uses. Requests Open-Meteo and (for U.S. places) the NWS grid at the same
 * time, then:
 *   - NWS ok + Open-Meteo ok   -> NWS temperature/humidity/wind + Open-Meteo sunshine/pressure ("nws")
 *   - outside the NWS area     -> Open-Meteo only ("open-meteo", reason "outside")
 *   - NWS failed or stale      -> Open-Meteo only ("open-meteo", reason "error" / "stale")
 *   - Open-Meteo failed, NWS ok-> NWS only, no sunshine ("nws-only")
 *   - both failed              -> throws (the app then shows its labelled sample day)
 * `source` describes what was used, for the label under the plan.
 */
export async function getForecast(lat, lon, { fetchImpl = fetch, now = Date.now(), useNws = true, timeoutMs, retryDelayMs } = {}) {
  const tryNws = useNws && inNwsArea(lat, lon);
  const [om, nws] = await Promise.allSettled([
    fetchOpenMeteo(lat, lon, { fetchImpl, ...(timeoutMs ? { timeoutMs } : {}) }),
    tryNws ? fetchNwsGrid(lat, lon, { fetchImpl, ...(timeoutMs ? { timeoutMs } : {}), ...(retryDelayMs != null ? { retryDelayMs } : {}) }) : Promise.reject(Object.assign(new Error("outside NWS area"), { outside: true })),
  ]);
  let nwsMap = null, reason = null, nwsErr = null;
  if (nws.status === "fulfilled") {
    const age = now - Date.parse(nws.value.props?.updateTime || 0);
    if (!(age <= NWS_MAX_AGE_MS)) reason = "stale";
    else {
      nwsMap = nwsHourly(nws.value.props);
      if (!nwsMap.size) { nwsMap = null; reason = "error"; }
    }
  } else {
    nwsErr = nws.reason;
    reason = nws.reason?.outside || nws.reason?.status === 404 ? "outside" : "error";
  }
  const nwsInfo = nwsMap ? { office: nws.value.office, gridUrl: nws.value.gridUrl, updateTime: nws.value.props.updateTime } : null;

  if (om.status === "fulfilled") {
    const { tz, tzAbbr } = om.value;
    if (!nwsMap) {
      return { hours: om.value.hours.map((h) => ({ ...h, src: "open-meteo" })), tz, tzAbbr, source: { inputs: "open-meteo", reason, nwsError: nwsErr ? String(nwsErr.message || nwsErr) : null } };
    }
    const hours = mergeInputs(om.value.hours, nwsMap);
    const future = hours.filter((h) => h.t + 3600e3 > now);
    return {
      hours, tz, tzAbbr,
      source: { inputs: "nws", reason: null, nwsHours: future.filter((h) => h.src === "nws").length, totalHours: future.length, ...nwsInfo },
    };
  }
  if (nwsMap) {
    const tz = nws.value.timeZone || "UTC";
    const hours = nwsOnlyHours(nwsMap);
    return { hours, tz, tzAbbr: tzAbbrFor(tz, now), source: { inputs: "nws-only", reason: "om-error", ...nwsInfo } };
  }
  throw om.reason;
}

/** Cache lifetime for a repeat lookup, and how long an old answer may stand in when both APIs fail. */
export const CACHE_TTL_MS = 30 * 60e3;
export const CACHE_STALE_MAX_MS = 3 * 3600e3;
const cacheKey = (lat, lon) => `heatwise:fc:${lat.toFixed(2)},${lon.toFixed(2)}`;

/**
 * getForecast with a small localStorage-style cache (`storage` has getItem/setItem). A repeat lookup
 * within 30 min reuses the last good answer (no API calls); if the APIs fail (e.g. HTTP 429), an
 * answer up to 3 h old is reused. Result gets cachedAt (epoch ms) when it came from the cache, else null.
 */
export async function getForecastCached(lat, lon, { storage = null, now = Date.now(), ...opts } = {}) {
  const key = cacheKey(lat, lon);
  let hit = null;
  try { const raw = storage?.getItem(key); if (raw) hit = JSON.parse(raw); } catch { hit = null; }
  const age = hit && typeof hit.savedAt === "number" ? now - hit.savedAt : Infinity;
  if (hit?.data && age >= 0 && age <= CACHE_TTL_MS) return { ...hit.data, cachedAt: hit.savedAt };
  try {
    const data = await getForecast(lat, lon, { now, ...opts });
    try { storage?.setItem(key, JSON.stringify({ savedAt: now, data })); } catch { /* quota: ignore */ }
    return { ...data, cachedAt: null };
  } catch (e) {
    if (hit?.data && age >= 0 && age <= CACHE_STALE_MAX_MS) return { ...hit.data, cachedAt: hit.savedAt };
    throw e;
  }
}
