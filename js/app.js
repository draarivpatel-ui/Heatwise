// HeatWise UI: fetches a free forecast (Open-Meteo, no API key), scores each hour with heat.js,
// and renders the plan. No build step, no tracking; nothing leaves the browser except the
// forecast and place-search requests.
import {
  scoreHours, bestWindow, hourAllowed, hydrationPlan, acclimatizationSchedule, sampleHours,
  cToF, localHour, SEVERITY, UIL_CLASSES, fToC, SAMPLE_PLACE, WORKLOADS, CLOTHING,
} from "./heat.js";
import { STRINGS, PRESETS } from "./i18n.js";
import { renderValidation } from "./validation-ui.js";

const $ = (id) => document.getElementById(id);
const state = {
  lang: "en",
  place: null,  // { name, lat, lon }
  data: null,   // { hours, isSample, tz, tzAbbr, place }
  busy: false,
};

const t = (key) => STRINGS[state.lang][key] ?? STRINGS.en[key] ?? key;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const LOCALE = () => (state.lang === "es" ? "es-US" : "en-US");

// ---------- i18n ----------
function applyLang() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang)));
  document.querySelectorAll("[data-show-lang]").forEach((el) => { el.hidden = el.dataset.showLang !== state.lang; });
  const sel = $("preset"), cur = sel.value || "football";
  sel.innerHTML = Object.keys(PRESETS).map((k) => `<option value="${k}">${escapeHtml(t("presets")[k])}</option>`).join("");
  sel.value = cur;
  const e = $("earliest").value, l = $("latest").value;
  fillHourSelect($("earliest"), e === "" ? 6 : Number(e), false);
  fillHourSelect($("latest"), l === "" ? 21 : Number(l), true);
  renderPlaceLabel();
  if (state.data) render();
  renderValidation(state.lang);
}

function fillHourSelect(sel, value, allowMidnight) {
  const opts = [];
  for (let h = allowMidnight ? 1 : 0; h <= (allowMidnight ? 24 : 23); h++) opts.push(`<option value="${h}">${hourLabel(h)}</option>`);
  sel.innerHTML = opts.join("");
  sel.value = String(value);
  if (sel.value === "") sel.selectedIndex = 0;
}

function hourLabel(h) {
  if (h === 24 || h === 0) return state.lang === "es" ? "medianoche" : "midnight";
  if (h === 12) return state.lang === "es" ? "mediodía" : "noon";
  return new Intl.DateTimeFormat(LOCALE(), { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, h)));
}

function renderPlaceLabel() {
  const p = state.data?.isSample && !state.data?.fallbackFor ? null : state.place;
  $("placeLabel").textContent = p ? `📍 ${p.label === "myLocation" ? t("myLocation") + " (" + p.name + ")" : p.name}` : "";
}

// ---------- time formatting (in the forecast place's own time zone, DST-aware) ----------
const fmtCache = new Map();
function fmt(opts) {
  const key = LOCALE() + JSON.stringify(opts) + (state.data?.tz || "");
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat(LOCALE(), { ...opts, ...(state.data?.tz ? { timeZone: state.data.tz } : {}) }));
  return fmtCache.get(key);
}
const fmtTime = (ms, withDay = true) => fmt(withDay ? { weekday: "short", hour: "numeric" } : { hour: "numeric" }).format(new Date(ms));
const fmtF = (c) => `${Math.round(cToF(c))}°F`;
const fmtFC = (c) => `${cToF(c).toFixed(1)}°F (${c.toFixed(1)}°C)`;

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg || "";
  el.classList.toggle("error", !!isError);
}

// ---------- data ----------
async function geocode(query) {
  // Open-Meteo matches place names or postal codes; "Sugar Land, TX" style input works for the
  // first part, so search that and rank results whose state/country matches the rest.
  const [main, ...rest] = query.split(",").map((s) => s.trim()).filter(Boolean);
  const hint = rest.join(" ").toLowerCase();
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(main || query)}&count=8&language=${state.lang}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("geocode " + res.status);
  const json = await res.json();
  const results = (json.results || []).map((r) => ({
    name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "),
    lat: r.latitude, lon: r.longitude,
    score: hint && [r.admin1, r.country, r.country_code, stateAbbr(r.admin1)].some((v) => v && hint.includes(String(v).toLowerCase())) ? 1 : 0,
  }));
  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

const US_STATES = { Texas: "tx", Louisiana: "la", Oklahoma: "ok", "New Mexico": "nm", Arizona: "az", California: "ca", Florida: "fl", Georgia: "ga", Alabama: "al", Mississippi: "ms", Arkansas: "ar" };
const stateAbbr = (admin1) => US_STATES[admin1] || null;

async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: "temperature_2m,relative_humidity_2m,shortwave_radiation,wind_speed_10m,surface_pressure,is_day",
    wind_speed_unit: "ms",
    forecast_days: "3",
    timezone: "auto",
    timeformat: "unixtime",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.reason || "forecast " + res.status);
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

/** Index of the hour containing "now" (or the first future hour). */
function currentIndex(hours, now = Date.now()) {
  const i = hours.findIndex((h) => now < h.t + 3600e3);
  return i >= 0 ? i : 0;
}

async function loadPlace(place) {
  state.place = place;
  renderPlaceLabel();
  setStatus(t("loading"));
  setBusy(true);
  try {
    const { hours, tz, tzAbbr } = await fetchForecast(place.lat, place.lon);
    const future = hours.slice(currentIndex(hours));
    if (future.length < 6) throw new Error("too few hours");
    state.data = { hours: future, isSample: false, tz, tzAbbr, place, fetchedAt: Date.now() };
    $("retryBtn").hidden = true;
    setStatus("");
  } catch (e) {
    console.warn(e);
    // Keep the place so "Try again" and the share link still point at it, but show the labelled sample day.
    loadSample(false, place);
    setStatus(t("errApi"), true);
    $("retryBtn").hidden = false;
    return;
  } finally {
    setBusy(false);
  }
  render(true);
}

function loadSample(clearStatus = true, fallbackFor = null) {
  state.data = { hours: sampleHours(Date.now()), isSample: true, tz: SAMPLE_PLACE.tz, tzAbbr: "", place: SAMPLE_PLACE, fallbackFor, fetchedAt: Date.now() };
  if (clearStatus) { setStatus(""); $("retryBtn").hidden = true; }
  renderPlaceLabel();
  render(true);
}

function setBusy(b) {
  state.busy = b;
  ["searchBtn", "geoBtn", "sampleBtn", "retryBtn"].forEach((id) => { $(id).disabled = b; });
  document.querySelector("button.primary").disabled = b;
}

// ---------- profile ----------
function profile() {
  const dur = Math.round(Number($("duration").value));
  return {
    guideline: $("guideline").value === "osha" ? "osha" : "uil",
    uilClass: Number($("uilClass").value) || 3,
    workload: $("workload").value in WORKLOADS ? $("workload").value : "moderate",
    acclimatized: $("acclimatized").checked,
    clothing: $("clothing").value in CLOTHING ? $("clothing").value : "work",
    duration: Math.min(12, Math.max(1, Number.isFinite(dur) && dur > 0 ? dur : 1)),
    earliest: Number($("earliest").value),
    latest: Number($("latest").value),
  };
}

function syncGuidelineFields() {
  const uil = $("guideline").value !== "osha";
  $("uilFields").hidden = !uil;
  $("oshaFields").hidden = uil;
}

// ---------- render ----------
let lastScored = null, lastBest = null, lastAllowed = null;

function render(scrollTo = false) {
  if (!state.data) return;
  const p = profile();
  const uil = p.guideline === "uil";
  const tz = state.data.tz;
  if (state.data.isSample && Date.now() - state.data.fetchedAt > 3600e3) state.data.hours = sampleHours(Date.now());
  const visible = state.data.hours.slice(currentIndex(state.data.hours)).slice(0, 48);
  if (!visible.length || visible[0].t + 3600e3 <= Date.now() || (visible.length < 6 && !state.data.isSample)) {
    // Every forecast hour has passed (tab left open for days): get a fresh one instead of showing old hours.
    if (state.place && !state.busy) loadPlace(state.place); else loadSample();
    return;
  }
  const scored = scoreHours(visible, p, state.data.place);
  const sameHours = p.earliest === p.latest;
  const allowed = (h) => hourAllowed(localHour(h.t, tz), p.earliest, p.latest);
  const best = bestWindow(scored, p.duration, allowed);
  lastScored = scored; lastBest = best; lastAllowed = allowed;

  $("results").hidden = false;
  $("sampleBanner").hidden = !state.data.isSample;
  const model = scored.some((h) => h.model === "liljegren") ? t("modelLiljegren") : t("modelBom");
  const where = state.data.isSample ? "" : `${t("forecastFor")} ${state.data.place.label === "myLocation" ? t("myLocation") : state.data.place.name} · `;
  $("forecastMeta").textContent = `${where}${t("timesIn")}${state.data.tzAbbr ? " (" + state.data.tzAbbr + ")" : ""} · ${model} · ${t("source")}`;
  $("uilNote").hidden = !uil;
  $("acclAthlete").hidden = !uil;
  $("printSummary").textContent = printSummaryText(p);

  // This hour
  const now = scored[0];
  setRiskCard("nowCard", now.level);
  $("nowRisk").innerHTML = `${pill(now.level)} <span class="when">${escapeHtml(fmtTime(now.t))}</span>`;
  $("nowStats").innerHTML = statsHtml(now, uil);
  $("nowAdvice").textContent = advice(now.level, uil);

  // Safest window
  $("bestWarn").hidden = true;
  if (best) {
    const worst = scored.slice(best.start, best.end + 1).reduce((a, b) => (b.margin > a.margin ? b : a));
    setRiskCard("bestCard", worst.level);
    $("bestTime").innerHTML = `${escapeHtml(fmtTime(scored[best.start].t))} – ${escapeHtml(fmtTime(scored[best.end].t + 3600e3, false))}`;
    $("bestStats").innerHTML = `<dt>${t("worstHour")}</dt><dd>${pill(worst.level)} ${escapeHtml(fmtTime(worst.t, false))}</dd>` + statsHtml(worst, uil);
    $("bestAdvice").textContent = advice(worst.level, uil) + (sameHours ? " " + t("hoursInvalid") : "");
    if (uil && p.duration > worst.maxHours) {
      $("bestWarn").textContent = STRINGS[state.lang].windowTooLong(worst.maxHours);
      $("bestWarn").hidden = false;
    }
  } else {
    setRiskCard("bestCard", "");
    $("bestTime").textContent = "—";
    $("bestStats").innerHTML = "";
    $("bestAdvice").textContent = t("noWindow");
  }

  renderChart();
  $("hourTable").innerHTML = tableHtml(scored, uil);
  $("nightNote").hidden = !scored.some((h) => h.likelyOverestimate);

  // Water plan
  const w = hydrationPlan(p.duration);
  const items = [STRINGS[state.lang].waterLine(w), t("waterThirst"), t("waterMax"), t("waterCool"), t("waterAvoid")];
  if (w.electrolytes) items.push(t("waterElectro"));
  if (uil) items.push(t("waterUil"));
  $("waterList").innerHTML = items.map((s) => `<li>${escapeHtml(s)}</li>`).join("");

  renderAccl();
  syncUrl();
  if (scrollTo) {
    $("results").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    $("results").focus({ preventScroll: true });
  }
}

const pill = (level) => `<span class="pill ${level}">${escapeHtml(t("level_" + level))}</span>`;
const advice = (level, uil) => (uil ? t("uil_" + level) : t("adv_" + level));

function printSummaryText(p) {
  const pr = $("preset");
  const parts = [`${t("printSummary")}: ${pr.options[pr.selectedIndex]?.text || ""}`,
    p.guideline === "uil" ? `${t("gl_uil")} – ${t("uil_" + p.uilClass)}` : `${t("gl_osha")} – ${$("workload").selectedOptions[0]?.text}, ${p.acclimatized ? t("acclimatized") : t("notAcclimatized")}, ${$("clothing").selectedOptions[0]?.text}`,
    `${t("duration")}: ${p.duration}`, `${t("earliest")}: ${hourLabel(p.earliest)}`, `${t("latest")}: ${hourLabel(p.latest)}`];
  return parts.join(" · ");
}

function renderAccl() {
  const usual = Math.min(720, Math.max(10, Number($("acclUsual").value) || 120));
  const sched = acclimatizationSchedule(usual, $("acclNew").checked);
  $("acclList").innerHTML = sched.map((d) => `<li>${t("acclDay")} ${d.day}: ${d.pct}% → ${d.minutes} ${t("acclMax")}</li>`).join("");
}

function setRiskCard(id, level) {
  const el = $(id);
  el.className = "card risk-card" + (level ? " sev" + SEVERITY[level] : "");
}

function statsHtml(h, uil) {
  const main = uil
    ? `<dt>${t("wbgtLabel")}</dt><dd>${fmtFC(h.wbgt)}${h.likelyOverestimate ? " *" : ""}</dd>
       <dt>${t("greenLimitLabel")}</dt><dd>${UIL_CLASSES[profile().uilClass][0].toFixed(1)}°F</dd>`
    : `<dt>${t("effLabel")}</dt><dd>${fmtFC(h.effWbgt)}${h.likelyOverestimate ? " *" : ""}</dd>
       <dt>${t("limitLabel")}</dt><dd>${fmtFC(h.limit)}</dd>`;
  return `${main}
    <dt>${t("hiLabel")}</dt><dd>${Math.round(h.heatIndexF)}°F</dd>
    <dt>${t("airLabel")}</dt><dd>${fmtF(h.tempC)} · ${Math.round(h.rh)}% ${t("rhAbbr")}</dd>`;
}

function tableHtml(scored, uil) {
  const head = `<tr><th scope="col">${t("thTime")}</th><th scope="col">${t("thTemp")}</th><th scope="col">${t("thRh")}</th><th scope="col">${t("thHi")}</th><th scope="col">${t("thWbgt")}</th><th scope="col">${t("thRisk")}</th></tr>`;
  const rows = scored.map((h) => `<tr${lastAllowed && !lastAllowed(h) ? ' class="off"' : ""}>
    <th scope="row">${escapeHtml(fmtTime(h.t))}</th>
    <td>${fmtF(h.tempC)}</td>
    <td>${Math.round(h.rh)}%</td>
    <td>${Math.round(h.heatIndexF)}°F</td>
    <td>${cToF(uil ? h.wbgt : h.effWbgt).toFixed(1)}°F${h.likelyOverestimate ? " *" : ""}</td>
    <td>${pill(h.level)}</td></tr>`).join("");
  return `<thead>${head}</thead><tbody>${rows}</tbody>`;
}

// ---------- chart (hand-drawn SVG, sized to its container so text stays readable on phones) ----------
const SEV_FILL = ["#dcfce7", "#fef9c3", "#ffedd5", "#fee2e2", "#e5e7eb"];
const SEV_STROKE = ["#15803d", "#a16207", "#c2410c", "#b91c1c", "#111827"];

function renderChart() {
  const scored = lastScored, best = lastBest, allowed = lastAllowed;
  if (!scored) return;
  const p = profile();
  const uil = p.guideline === "uil";
  const box = $("chart");
  const W = Math.max(300, Math.min(1000, Math.round(box.clientWidth || 960)));
  const H = W < 520 ? 240 : 300;
  const L = 44, R = 10, T = 12, B = 46;
  const n = scored.length;
  const valF = scored.map((h) => cToF(uil ? h.wbgt : h.effWbgt));
  const lines = uil
    ? UIL_CLASSES[p.uilClass].map((f, i) => ({ f, sev: i + 1 }))
    : [{ f: cToF(scored[0].limit), sev: 3 }];
  const all = valF.concat(lines.map((l) => l.f));
  let lo = Math.floor(Math.min(...valF) - 3), hi = Math.ceil(Math.max(...valF) + 3);
  // keep the lowest threshold in view so the chart always shows "how far from the line"
  lo = Math.min(lo, Math.floor(Math.min(...lines.map((l) => l.f)) - 2));
  hi = Math.max(hi, Math.ceil(Math.min(Math.max(...all), hi + 6)));
  const span = Math.max(4, hi - lo);
  const x = (i) => L + (i * (W - L - R)) / n;
  const y = (v) => T + ((hi - v) * (H - T - B)) / span;
  const bw = (W - L - R) / n;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-size="12" font-family="system-ui, sans-serif" aria-hidden="true" focusable="false">`;
  scored.forEach((h, i) => {
    const on = allowed(h);
    s += `<rect x="${x(i).toFixed(1)}" y="${T}" width="${(bw + 0.6).toFixed(1)}" height="${H - T - B}" fill="${SEV_FILL[SEVERITY[h.level]]}" opacity="${on ? 1 : 0.35}"/>`;
  });
  const step = span > 24 ? 6 : span > 12 ? 4 : 2;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#000" stroke-opacity="0.07"/>`;
    s += `<text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" fill="#57534e">${v}°</text>`;
  }
  lines.forEach((l) => {
    if (l.f < lo || l.f > hi) return;
    s += `<line x1="${L}" x2="${W - R}" y1="${y(l.f).toFixed(1)}" y2="${y(l.f).toFixed(1)}" stroke="${SEV_STROKE[l.sev]}" stroke-width="1.6" stroke-dasharray="6 4"/>`;
    s += `<text x="${W - R - 4}" y="${(y(l.f) - 4).toFixed(1)}" text-anchor="end" fill="${SEV_STROKE[l.sev]}" font-weight="700" stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${l.f.toFixed(l.f % 1 ? 1 : 0)}°F</text>`;
  });
  if (best) {
    s += `<rect x="${x(best.start).toFixed(1)}" y="${T + 1}" width="${(bw * (best.end - best.start + 1)).toFixed(1)}" height="${H - T - B - 2}" fill="none" stroke="#15803d" stroke-width="3" rx="4"/>`;
  }
  const pts = valF.map((v, i) => `${(x(i) + bw / 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  s += `<polyline points="${pts}" fill="none" stroke="#431407" stroke-width="2.5" stroke-linejoin="round"/>`;
  // Two-line tick labels (hour, then weekday) so they never collide on a 390 px phone, in either language.
  const every = W < 520 ? 12 : 6;
  const dayFmt = fmt({ weekday: "short" });
  scored.forEach((h, i) => {
    if (i % every === 0) {
      const cx = x(i) + bw / 2;
      const anchor = i === 0 ? "start" : cx > W - R - 30 ? "end" : "middle";
      const tx = (i === 0 ? x(i) : cx).toFixed(1);
      s += `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${H - B}" y2="${H - B + 4}" stroke="#78716c"/>`;
      s += `<text x="${tx}" y="${H - B + 17}" text-anchor="${anchor}" fill="#57534e">${escapeHtml(fmtTime(h.t, false))}`
        + `<tspan x="${tx}" dy="14">${escapeHtml(dayFmt.format(new Date(h.t)))}</tspan></text>`;
    }
  });
  box.innerHTML = s + "</svg>";
  const bestText = best ? `${fmtTime(scored[best.start].t)} – ${fmtTime(scored[best.end].t + 3600e3, false)}` : "";
  box.setAttribute("aria-label", STRINGS[state.lang].chartAria(`${Math.round(Math.min(...valF))}°F`, `${Math.round(Math.max(...valF))}°F`, bestText));

  const levels = uil ? ["green", "yellow", "orange", "red", "black"] : ["low", "caution", "high", "extreme"];
  $("legend").innerHTML = levels.map((lv) => `<li><span class="sw" style="background:${SEV_FILL[SEVERITY[lv]]};border-color:${SEV_STROKE[SEVERITY[lv]]}"></span>${escapeHtml(t("level_" + lv))}</li>`).join("")
    + `<li><span class="sw line"></span>${t("legendLine")}</li><li><span class="sw dash"></span>${uil ? t("legendFlags") : t("legendLimit")}</li><li><span class="sw boxk"></span>${t("legendBox")}</li><li><span class="sw faded"></span>${t("legendFaded")}</li>`;
}

let resizeTimer = 0;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (lastScored) renderChart(); }, 150); });

// ---------- URL sharing ----------
function syncUrl() {
  const p = profile();
  const q = new URLSearchParams({
    lang: state.lang, preset: $("preset").value, g: p.guideline, uc: p.uilClass, wl: p.workload,
    acc: p.acclimatized ? 1 : 0, cl: p.clothing, dur: p.duration, e: p.earliest, l: p.latest,
  });
  if (state.data?.isSample && !state.data?.fallbackFor) q.set("sample", "1");
  else if (state.place) { q.set("lat", state.place.lat); q.set("lon", state.place.lon); q.set("name", state.place.name); }
  history.replaceState(null, "", `${location.pathname}?${q}`);
}

function setIfValid(id, value, valid) { if (value != null && valid(value)) $(id).value = value; }

function readUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get("lang") in STRINGS) state.lang = q.get("lang");
  else if (!q.has("lang") && (navigator.language || "").toLowerCase().startsWith("es")) state.lang = "es";
  applyLang();
  setIfValid("preset", q.get("preset"), (v) => v in PRESETS);
  applyPreset(false); // also on a plain visit, so the default preset's workload matches what the menu shows
  setIfValid("guideline", q.get("g"), (v) => v === "uil" || v === "osha");
  setIfValid("uilClass", q.get("uc"), (v) => v === "2" || v === "3");
  setIfValid("workload", q.get("wl"), (v) => v in WORKLOADS);
  if (q.has("acc")) $("acclimatized").checked = q.get("acc") === "1";
  setIfValid("clothing", q.get("cl"), (v) => v in CLOTHING);
  setIfValid("duration", q.get("dur"), (v) => /^\d{1,2}$/.test(v) && +v >= 1 && +v <= 12);
  setIfValid("earliest", q.get("e"), (v) => /^\d{1,2}$/.test(v) && +v >= 0 && +v <= 23);
  setIfValid("latest", q.get("l"), (v) => /^\d{1,2}$/.test(v) && +v >= 1 && +v <= 24);
  // A link whose settings don't match its preset (or that has no preset) is a custom plan: say so in the menu.
  const pr = PRESETS[$("preset").value];
  if (pr && ($("guideline").value !== pr.guideline || Number($("duration").value) !== pr.duration
    || (pr.guideline === "osha" && $("workload").value !== pr.workload))) $("preset").value = "custom";
  syncGuidelineFields();
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  if (q.get("sample") === "1") loadSample();
  else if (q.has("lat") && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    loadPlace({ lat, lon, name: (q.get("name") || `${lat.toFixed(2)}, ${lon.toFixed(2)}`).slice(0, 80) });
  }
}

// ---------- events ----------
async function doSearch() {
  const query = $("place").value.trim();
  const list = $("placeResults");
  list.hidden = true;
  if (query.length < 2) { setStatus(t("errGeo"), true); $("place").focus(); return; }
  setStatus(t("searching"));
  setBusy(true);
  let results;
  try {
    results = await geocode(query);
  } catch (e) {
    console.warn(e);
    setBusy(false);
    setStatus(t("errNet"), true);
    return;
  }
  setBusy(false);
  if (!results.length) { list.hidden = true; setStatus(t("errGeo"), true); return; }
  setStatus("");
  if (results.length === 1 || results[0].score > (results[1]?.score ?? 0)) {
    list.hidden = true;
    loadPlace(results[0]);
    return;
  }
  list.innerHTML = results.map((r, i) => `<li><button type="button" data-i="${i}">${escapeHtml(r.name)}</button></li>`).join("");
  list.hidden = false;
  list.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    list.hidden = true;
    loadPlace(results[Number(b.dataset.i)]);
  }));
  list.querySelector("button")?.focus();
}

function applyPreset(rerender = true) {
  const pr = PRESETS[$("preset").value];
  if (pr) {
    $("guideline").value = pr.guideline;
    $("workload").value = pr.workload;
    $("duration").value = pr.duration;
    syncGuidelineFields();
  }
  if (rerender) render();
}

$("searchBtn").addEventListener("click", doSearch);
$("place").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
$("placeResults").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { $("placeResults").hidden = true; $("place").focus(); }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const btns = [...$("placeResults").querySelectorAll("button")];
    const i = btns.indexOf(document.activeElement);
    btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
    e.preventDefault();
  }
});
$("geoBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus(t("errLocationOff"), true);
  setStatus(t("locating"));
  setBusy(true);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setBusy(false);
      const lat = +pos.coords.latitude.toFixed(3), lon = +pos.coords.longitude.toFixed(3);
      loadPlace({ lat, lon, name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, label: "myLocation" });
    },
    (err) => { setBusy(false); setStatus(t(err && err.code === 1 ? "errLocation" : "errLocationOff"), true); },
    { timeout: 10000, maximumAge: 600000 },
  );
});
$("sampleBtn").addEventListener("click", () => { state.place = null; loadSample(); });
$("retryBtn").addEventListener("click", () => { if (state.place) loadPlace(state.place); });
// A plan left open in a tab goes stale: refetch when the user comes back after an hour or more.
document.addEventListener("visibilitychange", () => {
  const d = state.data;
  if (document.visibilityState !== "visible" || !d || state.busy) return;
  if (Date.now() - d.fetchedAt < 3600e3) return;
  if (!d.isSample && state.place) loadPlace(state.place);
  else render();
});
$("preset").addEventListener("change", () => applyPreset(true));
$("guideline").addEventListener("change", () => { syncGuidelineFields(); $("preset").value = "custom"; render(); });
["uilClass", "workload", "acclimatized", "clothing", "duration", "earliest", "latest"].forEach((id) => $(id).addEventListener("change", () => {
  if (["workload", "duration"].includes(id)) $("preset").value = "custom";
  if (id === "duration") $("duration").value = profile().duration;
  render();
}));
["acclUsual", "acclNew"].forEach((id) => $(id).addEventListener("input", renderAccl));
$("planForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.busy) return;
  if (state.data) { render(true); return; }
  if ($("place").value.trim()) doSearch();
  else { setStatus(t("needPlace"), true); $("place").focus(); }
});
document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
  state.lang = b.dataset.lang; fmtCache.clear(); applyLang(); if (state.data) syncUrl();
}));
$("shareBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); setStatus(t("copied")); }
  catch { window.prompt(t("copyPrompt"), location.href); }
});
$("printBtn").addEventListener("click", () => window.print());
// Print the hour-by-hour table too: open closed <details> for printing, then restore.
let reopened = [];
window.addEventListener("beforeprint", () => { reopened = [...document.querySelectorAll("details:not([open])")]; reopened.forEach((d) => { d.open = true; }); });
window.addEventListener("afterprint", () => { reopened.forEach((d) => { d.open = false; }); reopened = []; });

// boot
readUrl();
syncGuidelineFields();

// Exposed for the headless test harness only.
window.__heatwise = { state, render, profile };
