// Rebuilds the snapshot files the Validation section reads. Run from the repo root:
//   node scripts/fetch-validation-data.mjs            (forecast snapshot + 2023 replay)
//   node scripts/fetch-validation-data.mjs replay     (only the 2023 replay)
// Node 18+ (global fetch). Sources:
//   - NWS forecast grids: https://api.weather.gov/points/{lat},{lon} -> forecastGridData (NDFD, HGX office)
//   - Open-Meteo forecast: https://api.open-meteo.com/v1/forecast (what the app itself uses)
//   - Archived ASOS observations, Houston Intercontinental (IAH): Iowa Environmental Mesonet
//     https://mesonet.agron.iastate.edu/request/download.phtml
//   - Archived sunshine and pressure: Open-Meteo historical weather API (ERA5 reanalysis)
//     https://archive-api.open-meteo.com/v1/archive
import fs from "node:fs";
import { expandSeries, isValidC } from "../js/validation.js";

const UA = { "User-Agent": "HeatWise validation study (github.com/draarivpatel-ui/Heatwise)", Accept: "application/geo+json" };
const OUT = new URL("../data/validation/", import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

// Eight Houston-area points spread across the NWS Houston/Galveston (HGX) forecast area.
export const POINTS = [
  { id: "houston", name: "Houston (downtown)", lat: 29.7604, lon: -95.3698 },
  { id: "sugarland", name: "Sugar Land", lat: 29.6197, lon: -95.6349 },
  { id: "katy", name: "Katy", lat: 29.7858, lon: -95.8245 },
  { id: "pearland", name: "Pearland", lat: 29.5636, lon: -95.286 },
  { id: "baytown", name: "Baytown", lat: 29.7355, lon: -94.9774 },
  { id: "tomball", name: "Tomball", lat: 30.0972, lon: -95.6161 },
  { id: "conroe", name: "Conroe", lat: 30.3119, lon: -95.4561 },
  { id: "galveston", name: "Galveston", lat: 29.3013, lon: -94.7977 },
];

async function getJson(url, headers = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (attempt === 4) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}
const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const hourIso = (ms) => new Date(ms).toISOString().slice(0, 13) + ":00Z";

async function forecastSnapshot() {
  const nws = { source: "National Weather Service, api.weather.gov gridpoints (NDFD)", fetchedAt: new Date().toISOString(), cols: ["t", "tC", "tdC", "rh", "hiC", "wbgtC", "windKmh"], points: [] };
  const om = { source: "Open-Meteo forecast API (same request as the app, plus past_days=1)", fetchedAt: nws.fetchedAt, cols: ["t", "tC", "rh", "radiation", "wind10", "pressure"], points: [] };
  for (const p of POINTS) {
    const meta = await getJson(`https://api.weather.gov/points/${p.lat},${p.lon}`, UA);
    const gridUrl = meta.properties.forecastGridData;
    const g = (await getJson(gridUrl, UA)).properties;
    const S = Object.fromEntries(["temperature", "dewpoint", "relativeHumidity", "heatIndex", "wetBulbGlobeTemperature", "windSpeed"].map((k) => [k, expandSeries(g[k]?.values)]));
    for (const k of ["temperature", "dewpoint", "heatIndex", "wetBulbGlobeTemperature"]) if (g[k] && g[k].uom !== "wmoUnit:degC") throw new Error(`${k} unit ${g[k].uom}`);
    if (g.windSpeed.uom !== "wmoUnit:km_h-1") throw new Error(`wind unit ${g.windSpeed.uom}`);
    const times = [...S.temperature.keys()].filter((t) => S.heatIndex.has(t) && S.relativeHumidity.has(t) && isValidC(S.temperature.get(t))).sort((a, b) => a - b);
    const rows = times.map((t) => [hourIso(t), r2(S.temperature.get(t)), r2(S.dewpoint.get(t) ?? null), S.relativeHumidity.get(t), r2(S.heatIndex.get(t)), r2(S.wetBulbGlobeTemperature.get(t) ?? null), r2(S.windSpeed.get(t) ?? null)]);
    nws.points.push({ ...p, grid: `${g.gridId}/${g.gridX},${g.gridY}`, url: gridUrl, updateTime: g.updateTime, rows });

    const q = new URLSearchParams({ latitude: p.lat, longitude: p.lon, hourly: "temperature_2m,relative_humidity_2m,shortwave_radiation,wind_speed_10m,surface_pressure", wind_speed_unit: "ms", past_days: "1", forecast_days: "9", timezone: "GMT", timeformat: "unixtime" });
    const H = (await getJson(`https://api.open-meteo.com/v1/forecast?${q}`)).hourly;
    const want = new Set(rows.map((r) => r[0]));
    const orows = H.time.map((s, i) => [hourIso(s * 1000), H.temperature_2m[i], H.relative_humidity_2m[i], H.shortwave_radiation[i], H.wind_speed_10m[i], H.surface_pressure[i]]).filter((r) => want.has(r[0]) && r.every((v) => v !== null));
    om.points.push({ id: p.id, rows: orows });
    console.log(`${p.id}: ${rows.length} NWS hours (${rows[0][0]} .. ${rows.at(-1)[0]}), ${orows.length} Open-Meteo hours`);
  }
  fs.writeFileSync(new URL("nws-hgx.json", OUT), JSON.stringify(nws));
  fs.writeFileSync(new URL("openmeteo.json", OUT), JSON.stringify(om));
}

// Aug 24, 2023: Houston (IAH) tied its all-time record high of 109 °F during an NWS Excessive Heat Warning.
async function replay2023() {
  const day = { date: "2023-08-24", station: "IAH", name: "Houston Intercontinental Airport (IAH)", lat: 29.9844, lon: -95.3414, tz: "America/Chicago" };
  // Hourly routine METARs at :53. The 23:53 report of the day before stands for 00:00, and so on.
  const iem = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=IAH&data=tmpf&data=dwpf&data=relh&data=sknt&data=feel&tz=Etc%2FUTC&format=onlycomma&latlon=no&elev=no&missing=M&trace=T&direct=no&report_type=3&year1=2023&month1=8&day1=24&hour1=4&minute1=0&year2=2023&month2=8&day2=25&hour2=4&minute2=0`;
  const csv = await (await fetch(iem)).text();
  const obs = csv.trim().split("\n").slice(1).map((l) => l.split(",")).filter((c) => c[1].endsWith(":53"));
  const q = new URLSearchParams({ latitude: day.lat, longitude: day.lon, start_date: "2023-08-24", end_date: "2023-08-25", hourly: "shortwave_radiation,surface_pressure", timezone: "GMT", timeformat: "unixtime" });
  const archUrl = `https://archive-api.open-meteo.com/v1/archive?${q}`;
  const A = (await getJson(archUrl)).hourly;
  const arch = new Map(A.time.map((s, i) => [s * 1000, [A.shortwave_radiation[i], A.surface_pressure[i]]]));
  const rows = [], iemFeel = [];
  for (const c of obs) {
    const t = Date.parse(c[1].replace(" ", "T") + ":00Z") + 7 * 60e3; // :53 -> next top of hour
    const a = arch.get(t);
    if (!a || c.slice(2, 6).includes("M")) continue;
    rows.push([t, Number(c[2]), Number(c[3]), Number(c[4]), Number(c[5]), a[0], a[1]]);
    iemFeel.push(Number(c[6]));
  }
  if (rows.length !== 24) throw new Error(`expected 24 hours, got ${rows.length}`);
  day.cols = ["t", "tempF", "dewF", "rh", "windKt", "radiation", "pressure"];
  day.rows = rows;
  day.iemHeatIndexF = iemFeel; // IEM's own heat index ("feel") for the same reports, an independent cross-check
  day.sources = { observations: iem, sunshine: archUrl };
  fs.writeFileSync(new URL("replay-iah-2023-08-24.json", OUT), JSON.stringify(day));
  console.log(`replay: ${rows.length} hours, max ${Math.max(...rows.map((r) => r[1]))} °F`);
}

if (process.argv[2] !== "replay") await forecastSnapshot();
await replay2023();
