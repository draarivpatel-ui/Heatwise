// Place search for HeatWise (Open-Meteo geocoding, free, no key). Pure ranking logic lives here so
// it can be tested in Node; app.js only renders the result.
import { fetchJson } from "./forecast.js";

export const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";
export const GEOCODE_TIMEOUT_MS = 8000;

// All 50 states + DC, so "Chicago, IL" or "Miami, Florida" can steer the ranking.
export const US_STATES = {
  Alabama: "al", Alaska: "ak", Arizona: "az", Arkansas: "ar", California: "ca", Colorado: "co", Connecticut: "ct",
  Delaware: "de", "District of Columbia": "dc", Florida: "fl", Georgia: "ga", Hawaii: "hi", Idaho: "id", Illinois: "il",
  Indiana: "in", Iowa: "ia", Kansas: "ks", Kentucky: "ky", Louisiana: "la", Maine: "me", Maryland: "md",
  Massachusetts: "ma", Michigan: "mi", Minnesota: "mn", Mississippi: "ms", Missouri: "mo", Montana: "mt",
  Nebraska: "ne", Nevada: "nv", "New Hampshire": "nh", "New Jersey": "nj", "New Mexico": "nm", "New York": "ny",
  "North Carolina": "nc", "North Dakota": "nd", Ohio: "oh", Oklahoma: "ok", Oregon: "or", Pennsylvania: "pa",
  "Rhode Island": "ri", "South Carolina": "sc", "South Dakota": "sd", Tennessee: "tn", Texas: "tx", Utah: "ut",
  Vermont: "vt", Virginia: "va", Washington: "wa", "West Virginia": "wv", Wisconsin: "wi", Wyoming: "wy",
  "Puerto Rico": "pr",
};

/** "Sugar Land, TX" -> { main: "Sugar Land", hint: "tx" } (the part after the first comma steers ranking). */
export function parseQuery(query) {
  const [main, ...rest] = String(query).split(",").map((s) => s.trim()).filter(Boolean);
  return { main: main || String(query).trim(), hint: rest.join(" ").toLowerCase() };
}

// Whole-word match, so the hint "tx" never matches inside another word and "in" (Indiana) needs to stand alone.
const hasWord = (hint, v) => new RegExp(`(^|[^a-z])${String(v).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`).test(hint);

/**
 * Rank raw Open-Meteo results: places whose state/country matches the hint first, then by population
 * (bigger first; Open-Meteo already orders by relevance, and the sort keeps that order for ties). Top 5.
 */
export function rankPlaces(results, hint = "") {
  return (results || []).map((r, i) => ({
    name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "),
    lat: r.latitude, lon: r.longitude,
    pop: Number(r.population) || 0,
    score: hint && [r.admin1, r.country, r.country_code, US_STATES[r.admin1]].some((v) => v && hasWord(hint, v)) ? 1 : 0,
    i,
  })).sort((a, b) => b.score - a.score || b.pop - a.pop || a.i - b.i).slice(0, 5);
}

/**
 * Should the search skip the picker? Yes when there is one result, when only the top result matches the
 * state/country hint, or when the top town is at least 10x bigger than the next (so "Houston" opens
 * Houston, TX and "Katy" opens Katy, TX, while "Pasadena" still asks: Texas or California).
 */
export function autoPick(ranked) {
  if (!ranked?.length) return null;
  if (ranked.length === 1) return ranked[0];
  const [a, b] = ranked;
  if (a.score > b.score) return a;
  if (a.score === b.score && a.pop >= 1000 && a.pop >= 10 * b.pop) return a;
  return null;
}

/** Search with a timeout (a stalled phone connection must not leave "Searching…" up forever). */
export async function searchPlaces(query, lang = "en", { fetchImpl = fetch, timeoutMs = GEOCODE_TIMEOUT_MS } = {}) {
  const { main, hint } = parseQuery(query);
  const url = `${GEOCODE_API}?name=${encodeURIComponent(main)}&count=8&language=${lang === "es" ? "es" : "en"}&format=json`;
  const json = await fetchJson(url, { fetchImpl, timeoutMs });
  const ranked = rankPlaces(json.results, hint);
  return { ranked, pick: autoPick(ranked) };
}
