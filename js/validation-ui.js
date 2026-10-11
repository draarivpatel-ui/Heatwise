// Renders the "Validation" section: loads the archived snapshots in data/validation/, recomputes every
// number in the browser with the same code the planner uses (heat.js + validation.js), and draws the
// charts. Nothing here is hard-coded: if the data are refreshed, the text and charts follow.
import { compareHeatIndex, compareWbgt, byPoint, replayDay, forecastRows, errorStats } from "./validation.js";
import { cToF, UIL_CLASSES, UIL_FLAGS } from "./heat.js";

const V = {
  en: {
    title: "Validation: does HeatWise agree with the National Weather Service?",
    intro: (n, pts, from, to) => `HeatWise's numbers come from code, so we checked them against the official forecast of the National Weather Service (NWS) for ${pts} Houston-area points: every forecast hour we could get, ${n.toLocaleString("en-US")} point-hours (${from} to ${to}). We call this <b>agreement</b>, not accuracy: the NWS numbers are forecasts too, made with their own methods.`,
    tileHi: "Heat index vs NWS",
    tileHiSub: (s) => `Mean difference (bias) ${sg(s.bias)}°F · ${pc(s.within1)} of ${s.n} hours within 1°F · ${pc(s.roundedExact)} identical after rounding to whole degrees like the NWS · r = ${s.r.toFixed(3)}`,
    tileWs: "WBGT vs NWS, same weather",
    tileWsSub: (s, c) => `Bias ${sg(s.bias)}°F · Texas UIL flag matched in ${pc(s.flagAgree)} of ${s.n} hours, and was never more than one flag apart in ${pc(s.flagWithinOne)}. When the flags differed, HeatWise showed the more cautious flag ${c.higher} of ${c.total} times.`,
    tileWa: "WBGT vs NWS, end to end",
    tileWaSub: (s, a) => `Bias ${sg(s.bias)}°F · UIL flag matched in ${pc(s.flagAgree)} of hours. Most of the gap is the weather input: over these hours Open-Meteo's forecast (what the app uses) was ${Math.abs(a.dT).toFixed(1)}°F ${a.dT < 0 ? "cooler" : "warmer"} and ${Math.abs(a.dRH).toFixed(1)} points ${a.dRH < 0 ? "drier" : "more humid"} than the NWS forecast on average.`,
    mae: "mean absolute difference",
    chartHi: "Heat index: HeatWise vs NWS (°F), one dot per point-hour",
    chartHiAria: (s) => `Scatter plot of ${s.n} hours. Dots sit on the diagonal line of perfect agreement; mean absolute difference ${s.mae.toFixed(2)}°F.`,
    chartWb: "WBGT: HeatWise (same NWS weather) vs NWS WBGT (°F)",
    chartWbAria: (s) => `Scatter plot of ${s.n} hours. Night hours sit on the diagonal; daytime hours sit slightly above it (HeatWise warmer in the sun). Mean absolute difference ${s.mae.toFixed(2)}°F.`,
    xNws: "NWS", yHw: "HeatWise", hiDot: "Heat index hour", day: "WBGT, daytime (sun up)", night: "WBGT, night", oneToOne: "Perfect agreement", band: "±2°F",
    tablePts: "Agreement at each point",
    thPoint: "Point", thN: "Hours", thHiMae: "Heat index MAE", thHiBias: "Heat index bias", thWbMae: "WBGT MAE (same weather)", thWbBias: "WBGT bias",
    replayTitle: "Replay: Houston's record heat, August 24, 2023",
    replayIntro: (peakT) => `On Thursday, August 24, 2023, Bush Intercontinental Airport (IAH) reached 109°F, tying Houston's all-time record high, during an NWS Excessive Heat Warning. We fed the airport's archived hourly weather reports (with archived sunshine) through HeatWise to see what a coach would have seen that day.`,
    rPeakHi: "Peak heat index", rPeakW: "Peak WBGT in the sun", rBlack: "Hours at UIL black flag", rBest: "Safest 2-hour practice window (6 AM–9 PM)",
    rBlackSub: (b, r) => `plus ${r} at red. Black = no outdoor workouts.`,
    rBestSub: (w, f) => `${f} flag, WBGT up to ${w}°F`,
    rAt: (t) => `at the ${t} report`,
    replayChart: "Aug 24, 2023 at IAH: WBGT in the sun by UIL flag (bars) and heat index (line), °F",
    replayAria: (b, best) => `Bar chart of 24 hours. The UIL flag reaches black for ${b} hours in the afternoon; the safest window is ${best}.`,
    legWbgt: "WBGT bar, coloured by UIL flag (Class 3)", legHi: "Heat index", legBest: "Safest 2-hour window",
    replayCheck: (n, d) => `Cross-check: for all ${n} reports, HeatWise's heat index matched the heat index the Iowa Environmental Mesonet computes independently for the same reports to within ${d}°F.`,
    replayNote: "The temperature dropped from 107°F to 90°F after 6 PM when storms brought Houston its first official rain in almost 50 days.",
    methodsTitle: "Methods and limits",
    methods: (m) => `<ol>
<li><b>Forecast data.</b> For each point we requested the NWS gridded forecast (api.weather.gov <code>/points</code> → <code>forecastGridData</code>, Houston/Galveston office, issued ${m.issued}) and expanded every value to hourly steps. We kept only hours valid at or after the issue time and dropped missing values (the grid uses −120°F for “missing”).</li>
<li><b>Heat index.</b> HeatWise's <code>heatIndexF()</code> (NWS Rothfusz regression with its adjustments) was run on the NWS forecast temperature and relative humidity and compared with the NWS forecast heat index for the same hour, for hours at or above 80°F, where the heat index is defined (below 80°F the NWS reports the air temperature). The NWS stores whole degrees, so even a perfect copy shows up to ±0.5°F from rounding.</li>
<li><b>WBGT, same weather.</b> HeatWise's Liljegren WBGT was run with the NWS forecast temperature, humidity and wind. The NWS grid has no sunshine value, so solar radiation and pressure come from Open-Meteo for the same hour. Compared with the NWS WBGT forecast (operational since 2022).</li>
<li><b>WBGT, end to end.</b> The app's real pipeline: Open-Meteo temperature, humidity, sunshine, wind and pressure, compared with the NWS WBGT.</li>
<li><b>Statistics.</b> Difference = HeatWise − NWS. Bias = mean difference; MAE = mean absolute difference; r = Pearson correlation. Flags use the Texas UIL Class 3 thresholds.</li>
<li><b>Replay.</b> Hourly routine reports (METARs, at :53) from IAH for Aug 24, 2023, from the Iowa Environmental Mesonet ASOS archive; each report stands for the following top of the hour. Sunshine and pressure come from the Open-Meteo historical (ERA5) archive, because airports do not measure sunshine.</li>
</ol>
<p><b>Limits.</b> One week of forecasts from one NWS issue in October, so few very hot hours; a longer, summer study would be stronger. Agreement with the NWS is not the same as matching a WBGT meter on a field. The NWS WBGT uses its own method and inputs (such as sky cover instead of measured sunshine), so some daytime difference is expected. The end-to-end gap shows that the weather forecast feeding HeatWise matters more than the formula; using the NWS grid as the input for US locations is the obvious next step.</p>`,
    sources: "Data and sources: ",
    loadErr: "Could not load the validation data.",
  },
  es: {
    title: "Validación: ¿coincide HeatWise con el Servicio Meteorológico Nacional?",
    intro: (n, pts, from, to) => `Los números de HeatWise salen de código, así que los comparamos con el pronóstico oficial del Servicio Meteorológico Nacional (NWS) de EE. UU. para ${pts} puntos del área de Houston: cada hora de pronóstico que pudimos obtener, ${n.toLocaleString("es-US")} horas-punto (del ${from} al ${to}). Lo llamamos <b>coincidencia</b>, no exactitud: los números del NWS también son pronósticos, hechos con sus propios métodos.`,
    tileHi: "Índice de calor vs NWS",
    tileHiSub: (s) => `Diferencia media (sesgo) ${sg(s.bias)}°F · ${pc(s.within1)} de ${s.n} horas a 1°F o menos · ${pc(s.roundedExact)} idénticas al redondear a grados enteros como el NWS · r = ${s.r.toFixed(3)}`,
    tileWs: "WBGT vs NWS, mismo clima",
    tileWsSub: (s, c) => `Sesgo ${sg(s.bias)}°F · la bandera UIL de Texas coincidió en ${pc(s.flagAgree)} de ${s.n} horas, y nunca estuvo a más de una bandera en ${pc(s.flagWithinOne)}. Cuando las banderas no coincidieron, HeatWise mostró la bandera más prudente ${c.higher} de ${c.total} veces.`,
    tileWa: "WBGT vs NWS, de principio a fin",
    tileWaSub: (s, a) => `Sesgo ${sg(s.bias)}°F · la bandera UIL coincidió en ${pc(s.flagAgree)} de las horas. Casi toda la diferencia viene del pronóstico de entrada: en estas horas el pronóstico de Open-Meteo (el que usa la app) fue en promedio ${Math.abs(a.dT).toFixed(1)}°F ${a.dT < 0 ? "más fresco" : "más cálido"} y ${Math.abs(a.dRH).toFixed(1)} puntos ${a.dRH < 0 ? "más seco" : "más húmedo"} que el del NWS.`,
    mae: "diferencia absoluta media",
    chartHi: "Índice de calor: HeatWise vs NWS (°F), un punto por hora y lugar",
    chartHiAria: (s) => `Gráfica de dispersión de ${s.n} horas. Los puntos quedan sobre la diagonal de coincidencia perfecta; diferencia absoluta media ${s.mae.toFixed(2)}°F.`,
    chartWb: "WBGT: HeatWise (mismo clima del NWS) vs WBGT del NWS (°F)",
    chartWbAria: (s) => `Gráfica de dispersión de ${s.n} horas. Las horas de noche quedan sobre la diagonal; las de día un poco arriba (HeatWise más cálido al sol). Diferencia absoluta media ${s.mae.toFixed(2)}°F.`,
    xNws: "NWS", yHw: "HeatWise", hiDot: "Hora de índice de calor", day: "WBGT, de día (con sol)", night: "WBGT, de noche", oneToOne: "Coincidencia perfecta", band: "±2°F",
    tablePts: "Coincidencia en cada punto",
    thPoint: "Punto", thN: "Horas", thHiMae: "MAE índice de calor", thHiBias: "Sesgo índice de calor", thWbMae: "MAE WBGT (mismo clima)", thWbBias: "Sesgo WBGT",
    replayTitle: "Repetición: el calor récord de Houston, 24 de agosto de 2023",
    replayIntro: () => `El jueves 24 de agosto de 2023, el aeropuerto Bush Intercontinental (IAH) llegó a 109°F, igualando el récord histórico de Houston, durante una Advertencia de Calor Excesivo del NWS. Pasamos los reportes horarios archivados del aeropuerto (con la radiación solar archivada) por HeatWise para ver lo que un entrenador habría visto ese día.`,
    rPeakHi: "Índice de calor máximo", rPeakW: "WBGT máximo al sol", rBlack: "Horas con bandera negra UIL", rBest: "Horario más seguro de 2 horas (6 a. m.–9 p. m.)",
    rBlackSub: (b, r) => `más ${r} con roja. Negra = no entrenar al aire libre.`,
    rBestSub: (w, f) => `bandera ${f}, WBGT de hasta ${w}°F`,
    rAt: (t) => `en el reporte de las ${t}`,
    replayChart: "24 ago 2023 en IAH: WBGT al sol por bandera UIL (barras) e índice de calor (línea), °F",
    replayAria: (b, best) => `Gráfica de barras de 24 horas. La bandera UIL llega a negra durante ${b} horas en la tarde; el horario más seguro es ${best}.`,
    legWbgt: "Barra de WBGT, con el color de la bandera UIL (Clase 3)", legHi: "Índice de calor", legBest: "Horario más seguro de 2 horas",
    replayCheck: (n, d) => `Verificación: en los ${n} reportes, el índice de calor de HeatWise coincidió con el que calcula de forma independiente el Iowa Environmental Mesonet para los mismos reportes, con una diferencia de ${d}°F o menos.`,
    replayNote: "La temperatura bajó de 107°F a 90°F después de las 6 p. m., cuando las tormentas trajeron la primera lluvia oficial en casi 50 días.",
    methodsTitle: "Métodos y límites",
    methods: (m) => `<ol>
<li><b>Datos de pronóstico.</b> Para cada punto pedimos el pronóstico en cuadrícula del NWS (api.weather.gov <code>/points</code> → <code>forecastGridData</code>, oficina de Houston/Galveston, emitido el ${m.issued}) y pasamos cada valor a pasos de una hora. Solo usamos horas válidas desde la hora de emisión y quitamos valores faltantes (la cuadrícula usa −120°F para “faltante”).</li>
<li><b>Índice de calor.</b> La función <code>heatIndexF()</code> de HeatWise (regresión de Rothfusz del NWS con sus ajustes) se aplicó a la temperatura y humedad relativa del pronóstico del NWS y se comparó con el índice de calor del NWS para la misma hora, en horas de 80°F o más, donde el índice está definido (debajo de 80°F el NWS reporta la temperatura del aire). El NWS guarda grados enteros, así que incluso una copia perfecta difiere hasta ±0.5°F por redondeo.</li>
<li><b>WBGT, mismo clima.</b> El WBGT de Liljegren de HeatWise se calculó con la temperatura, humedad y viento del pronóstico del NWS. La cuadrícula del NWS no trae radiación solar, así que la radiación y la presión vienen de Open-Meteo para la misma hora. Se comparó con el pronóstico de WBGT del NWS (operativo desde 2022).</li>
<li><b>WBGT, de principio a fin.</b> El proceso real de la app: temperatura, humedad, radiación, viento y presión de Open-Meteo, comparado con el WBGT del NWS.</li>
<li><b>Estadística.</b> Diferencia = HeatWise − NWS. Sesgo = diferencia media; MAE = diferencia absoluta media; r = correlación de Pearson. Las banderas usan los límites de la Clase 3 de la UIL de Texas.</li>
<li><b>Repetición.</b> Reportes horarios de rutina (METAR, a los :53) de IAH del 24 de agosto de 2023, del archivo ASOS del Iowa Environmental Mesonet; cada reporte representa la hora en punto siguiente. La radiación solar y la presión vienen del archivo histórico de Open-Meteo (ERA5), porque los aeropuertos no miden la radiación.</li>
</ol>
<p><b>Límites.</b> Una semana de pronósticos de una sola emisión del NWS en octubre, con pocas horas muy calurosas; un estudio más largo y en verano sería más sólido. Coincidir con el NWS no es lo mismo que coincidir con un medidor de WBGT en la cancha. El WBGT del NWS usa su propio método y datos (por ejemplo, nubosidad en vez de radiación medida), así que se espera algo de diferencia de día. La diferencia de principio a fin muestra que el pronóstico que alimenta a HeatWise importa más que la fórmula; usar la cuadrícula del NWS como entrada en EE. UU. es el siguiente paso lógico.</p>`,
    sources: "Datos y fuentes: ",
    loadErr: "No se pudieron cargar los datos de validación.",
  },
};

const sg = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
const pc = (v) => `${(v * 100).toFixed(1)}%`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FLAG_FILL = { green: "#dcfce7", yellow: "#fef9c3", orange: "#ffedd5", red: "#fee2e2", black: "#374151" };
const FLAG_STROKE = { green: "#15803d", yellow: "#a16207", orange: "#c2410c", red: "#b91c1c", black: "#111827" };
const FLAG_NAME = { en: { green: "Green", yellow: "Yellow", orange: "Orange", red: "Red", black: "Black" }, es: { green: "verde", yellow: "amarilla", orange: "naranja", red: "roja", black: "negra" } };

let cache = null;   // { nws, om, day, results }
let lang = "en";

async function load() {
  if (cache) return cache;
  const get = (f) => fetch(new URL(`../data/validation/${f}`, import.meta.url)).then((r) => { if (!r.ok) throw new Error(f + " " + r.status); return r.json(); });
  const [nws, om, day] = await Promise.all([get("nws-hgx.json"), get("openmeteo.json"), get("replay-iah-2023-08-24.json")]);
  cache = { nws, om, day, results: computeAll(nws, om, day) };
  return cache;
}

/** Every number shown in the section (exported for the tests). */
export function computeAll(nws, om, day) {
  const hi = compareHeatIndex(nws);
  const same = compareWbgt(nws, om, { mode: "same" });
  const app = compareWbgt(nws, om, { mode: "app" });
  const rank = (f) => UIL_FLAGS.indexOf(f);
  const dis = same.pairs.filter((p) => p.fHw !== p.fNws);
  const cautious = { higher: dis.filter((p) => rank(p.fHw) > rank(p.fNws)).length, total: dis.length };
  // Average input difference (Open-Meteo minus NWS) over the compared hours.
  let dT = 0, dRH = 0, n = 0;
  for (const p of nws.points) {
    const o = new Map((om.points.find((q) => q.id === p.id)?.rows || []).map((r) => [r[0], r]));
    for (const r of forecastRows(p)) { const q = o.get(r[0]); if (!q) continue; dT += cToF(q[1]) - cToF(r[1]); dRH += q[2] - r[3]; n++; }
  }
  const replay = replayDay(day);
  const iemDiff = day.iemHeatIndexF ? Math.max(...replay.rows.map((r, i) => Math.abs(r.hiF - day.iemHeatIndexF[i]))) : NaN;
  const rows = forecastRows(nws.points[0]);
  const totalHours = nws.points.reduce((a, p) => a + forecastRows(p).length, 0);
  return {
    hi, same, app, cautious, inputs: { dT: dT / n, dRH: dRH / n, n }, replay, iemDiff,
    window: { from: Date.parse(rows[0][0]), to: Date.parse(rows.at(-1)[0]), issued: Date.parse(nws.points[0].updateTime), totalHours, points: nws.points.length },
    perPoint: byPoint(hi.pairs).map((h) => ({ ...h, wb: errorStats(same.pairs.filter((p) => p.point === h.point).map((p) => p.diff)), name: nws.points.find((p) => p.id === h.point).name })),
  };
}

const dtf = (opts) => new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: "America/Chicago", ...opts });
const fmtDay = (ms) => dtf({ month: "short", day: "numeric", hour: "numeric" }).format(new Date(ms));
const fmtHour = (ms) => dtf({ hour: "numeric" }).format(new Date(ms));
const fmtHM = (ms) => dtf({ hour: "numeric", minute: "2-digit" }).format(new Date(ms));

export async function renderValidation(newLang = lang) {
  lang = newLang;
  const root = document.getElementById("validationBody");
  if (!root) return;
  const S = V[lang] || V.en;
  document.getElementById("validationTitle").textContent = S.title;
  let c;
  try { c = await load(); }
  catch (e) { console.warn(e); root.innerHTML = `<p class="status error">${esc(S.loadErr)}</p>`; return; }
  const R = c.results, w = R.window, rp = R.replay;
  const bestTxt = rp.best ? `${fmtHour(rp.rows[rp.best.start].t)}–${fmtHour(rp.rows[rp.best.end].t + 3600e3)}` : "–";
  const bestMax = rp.bestRows.length ? Math.max(...rp.bestRows.map((r) => r.wbgtF)) : NaN;
  const obsT = (t) => fmtHM(t - 7 * 60e3); // each row stands for the :53 report before it
  const fnwsLink = (p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`;
  root.innerHTML = `
    <p>${S.intro(w.totalHours, w.points, fmtDay(w.from), fmtDay(w.to))}</p>
    <div class="vtiles">
      <div class="vtile"><h3>${esc(S.tileHi)}</h3><p class="vbig">${R.hi.stats.mae.toFixed(2)}°F</p><p class="vlabel">${esc(S.mae)}</p><p class="small">${esc(S.tileHiSub(R.hi.stats))}</p></div>
      <div class="vtile"><h3>${esc(S.tileWs)}</h3><p class="vbig">${R.same.stats.mae.toFixed(2)}°F</p><p class="vlabel">${esc(S.mae)}</p><p class="small">${esc(S.tileWsSub(R.same.stats, R.cautious))}</p></div>
      <div class="vtile"><h3>${esc(S.tileWa)}</h3><p class="vbig">${R.app.stats.mae.toFixed(2)}°F</p><p class="vlabel">${esc(S.mae)}</p><p class="small">${esc(S.tileWaSub(R.app.stats, R.inputs))}</p></div>
    </div>
    <div class="grid2 vcharts">
      <figure><figcaption>${esc(S.chartHi)}</figcaption><div class="chart" id="vChartHi" role="img" aria-label="${esc(S.chartHiAria(R.hi.stats))}"></div></figure>
      <figure><figcaption>${esc(S.chartWb)}</figcaption><div class="chart" id="vChartWb" role="img" aria-label="${esc(S.chartWbAria(R.same.stats))}"></div></figure>
    </div>
    <ul class="legend small">
      <li><span class="sw dot" style="background:#57534e"></span>${esc(S.hiDot)}</li>
      <li><span class="sw dot" style="background:#7c2d12"></span>${esc(S.day)}</li>
      <li><span class="sw dot" style="background:#2563eb"></span>${esc(S.night)}</li>
      <li><span class="sw diag"></span>${esc(S.oneToOne)}</li>
      <li><span class="sw bandk"></span>${esc(S.band)}</li>
    </ul>
    <details><summary>${esc(S.tablePts)}</summary>
      <div class="table-wrap" tabindex="0" role="region" aria-label="${esc(S.tablePts)}"><table>
        <thead><tr><th scope="col">${esc(S.thPoint)}</th><th scope="col">${esc(S.thN)}</th><th scope="col">${esc(S.thHiMae)}</th><th scope="col">${esc(S.thHiBias)}</th><th scope="col">${esc(S.thWbMae)}</th><th scope="col">${esc(S.thWbBias)}</th></tr></thead>
        <tbody>${R.perPoint.map((p) => `<tr><th scope="row">${esc(p.name)}</th><td>${p.n}</td><td>${p.mae.toFixed(2)}°F</td><td>${sg(p.bias)}°F</td><td>${p.wb.mae.toFixed(2)}°F</td><td>${sg(p.wb.bias)}°F</td></tr>`).join("")}</tbody>
      </table></div>
    </details>

    <h3 class="vh">${esc(S.replayTitle)}</h3>
    <p>${esc(S.replayIntro())}</p>
    <dl class="vfacts">
      <div><dt>${esc(S.rPeakHi)}</dt><dd>${rp.peakHi.hiF.toFixed(0)}°F</dd><dd class="small muted">${esc(S.rAt(obsT(rp.peakHi.t)))} (${rp.peakHi.tempF}°F, ${Math.round(rp.peakHi.rh)}% RH)</dd></div>
      <div><dt>${esc(S.rPeakW)}</dt><dd>${rp.peakWbgt.wbgtF.toFixed(1)}°F</dd><dd class="small muted">${esc(S.rAt(obsT(rp.peakWbgt.t)))}</dd></div>
      <div><dt>${esc(S.rBlack)}</dt><dd>${rp.flagHours.black}</dd><dd class="small muted">${esc(S.rBlackSub(rp.flagHours.black, rp.flagHours.red))}</dd></div>
      <div><dt>${esc(S.rBest)}</dt><dd>${esc(bestTxt)}</dd><dd class="small muted">${esc(S.rBestSub(bestMax.toFixed(1), FLAG_NAME[lang][rp.bestRows[0]?.flag] || ""))}</dd></div>
    </dl>
    <figure><figcaption>${esc(S.replayChart)}</figcaption><div class="chart" id="vChartReplay" role="img" aria-label="${esc(S.replayAria(rp.flagHours.black, bestTxt))}"></div></figure>
    <ul class="legend small">
      ${UIL_FLAGS.map((f) => `<li><span class="sw" style="background:${FLAG_FILL[f]};border-color:${FLAG_STROKE[f]}"></span>${esc(FLAG_NAME[lang][f])}</li>`).join("")}
      <li><span class="sw line"></span>${esc(S.legHi)}</li><li><span class="sw boxk"></span>${esc(S.legBest)}</li>
    </ul>
    <p class="small">${esc(S.replayCheck(rp.rows.length, R.iemDiff.toFixed(2)))} ${esc(S.replayNote)}</p>

    <details class="vmethods"><summary>${esc(S.methodsTitle)}</summary>${S.methods({ issued: esc(fmtDay(w.issued) + " CT") })}</details>
    <p class="small"><span>${esc(S.sources)}</span>
      NWS gridpoint forecasts (${c.nws.points.map(fnwsLink).join(", ")}) ·
      <a href="https://www.weather.gov/documentation/services-web-api" target="_blank" rel="noopener">NWS API documentation</a> ·
      <a href="https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml" target="_blank" rel="noopener">NWS heat index equation</a> ·
      <a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener">Open-Meteo forecast API</a> ·
      <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener">Open-Meteo historical (ERA5) API</a> ·
      <a href="${esc(c.day.sources.observations)}" target="_blank" rel="noopener">IAH hourly reports, Iowa Environmental Mesonet</a> ·
      <a href="https://www.weather.gov/media/hgx/climate/summary/Aug_2023_Regional_Climate_Summary.pdf" target="_blank" rel="noopener">NWS Houston August 2023 climate summary</a> ·
      <a href="https://www.weather.gov/media/hgx/stormdata/aug23hgx.pdf" target="_blank" rel="noopener">NWS Houston Storm Data, August 2023</a> ·
      <a href="https://www.houstonpublicmedia.org/articles/news/weather/2023/08/25/460628/houston-ties-record-for-hottest-temperature-ever-recorded-in-city-at-109-degrees" target="_blank" rel="noopener">Houston Public Media, Aug 25 2023</a> ·
      <a href="https://spacecityweather.com/thursday-matched-houstons-hottest-day-on-record-and-brought-our-first-official-rain-in-almost-50-days/" target="_blank" rel="noopener">Space City Weather, Aug 25 2023</a> ·
      <a href="https://github.com/draarivpatel-ui/Heatwise/tree/main/data/validation" target="_blank" rel="noopener">archived data and script</a></p>`;
  drawAll();
}

function drawAll() {
  if (!cache) return;
  const R = cache.results;
  scatter(document.getElementById("vChartHi"), R.hi.pairs, () => "#57534e", 2);
  scatter(document.getElementById("vChartWb"), R.same.pairs, (p) => (p.day ? "#7c2d12" : "#2563eb"), 2);
  replayChart(document.getElementById("vChartReplay"), R.replay);
}

function scatter(box, pairs, color, band) {
  if (!box) return;
  const S = V[lang] || V.en;
  const W = Math.max(280, Math.min(520, Math.round(box.clientWidth || 480)));
  const H = Math.round(W * 0.8), L = 42, Rm = 10, T = 10, B = 40;
  const vals = pairs.flatMap((p) => [p.nws, p.hw]);
  const lo = Math.floor(Math.min(...vals) / 5) * 5, hi = Math.ceil(Math.max(...vals) / 5) * 5;
  const x = (v) => L + ((v - lo) * (W - L - Rm)) / (hi - lo);
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-size="12" font-family="system-ui, sans-serif" aria-hidden="true" focusable="false">`;
  const step = hi - lo > 30 ? 10 : 5;
  for (let v = lo; v <= hi; v += step) {
    s += `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="#000" stroke-opacity="0.07"/><line y1="${T}" y2="${H - B}" x1="${x(v)}" x2="${x(v)}" stroke="#000" stroke-opacity="0.07"/>`;
    s += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="#57534e">${v}°</text><text x="${x(v)}" y="${H - B + 16}" text-anchor="middle" fill="#57534e">${v}°</text>`;
  }
  s += `<polygon points="${x(lo)},${y(lo + band)} ${x(hi - band)},${y(hi)} ${x(hi)},${y(hi)} ${x(hi)},${y(hi - band)} ${x(lo + band)},${y(lo)} ${x(lo)},${y(lo)}" fill="#a8a29e" fill-opacity="0.18"/>`;
  s += `<line x1="${x(lo)}" y1="${y(lo)}" x2="${x(hi)}" y2="${y(hi)}" stroke="#1c1917" stroke-width="1.4" stroke-dasharray="5 4"/>`;
  for (const p of pairs) s += `<circle cx="${x(p.nws).toFixed(1)}" cy="${y(p.hw).toFixed(1)}" r="2.3" fill="${color(p)}" fill-opacity="0.4"/>`;
  s += `<text x="${(L + W - Rm) / 2}" y="${H - 6}" text-anchor="middle" fill="#1c1917" font-weight="600">${esc(S.xNws)} (°F)</text>`;
  s += `<text transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" fill="#1c1917" font-weight="600">${esc(S.yHw)} (°F)</text>`;
  box.innerHTML = s + "</svg>";
}

function replayChart(box, rp) {
  if (!box) return;
  const W = Math.max(300, Math.min(1000, Math.round(box.clientWidth || 960)));
  const H = W < 520 ? 250 : 300, L = 40, Rm = 10, T = 12, B = 34;
  const n = rp.rows.length;
  const lo = 70, hi = Math.ceil(Math.max(...rp.rows.map((r) => r.hiF)) / 5) * 5 + 2;
  const x = (i) => L + (i * (W - L - Rm)) / n, bw = (W - L - Rm) / n;
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-size="12" font-family="system-ui, sans-serif" aria-hidden="true" focusable="false">`;
  for (let v = lo; v <= hi; v += 10) s += `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="#000" stroke-opacity="0.07"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="#57534e">${v}°</text>`;
  rp.rows.forEach((r, i) => {
    s += `<rect x="${(x(i) + 1).toFixed(1)}" y="${y(r.wbgtF).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(y(lo) - y(r.wbgtF)).toFixed(1)}" fill="${FLAG_FILL[r.flag]}" stroke="${FLAG_STROKE[r.flag]}" stroke-width="1.2"/>`;
  });
  UIL_CLASSES[3].forEach((f, k) => { s += `<line x1="${L}" x2="${W - Rm}" y1="${y(f)}" y2="${y(f)}" stroke="${FLAG_STROKE[UIL_FLAGS[k + 1]]}" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.8"/>`; });
  if (rp.best) s += `<rect x="${x(rp.best.start).toFixed(1)}" y="${T}" width="${(bw * (rp.best.end - rp.best.start + 1)).toFixed(1)}" height="${H - T - B}" fill="none" stroke="#15803d" stroke-width="3" rx="4"/>`;
  s += `<polyline points="${rp.rows.map((r, i) => `${(x(i) + bw / 2).toFixed(1)},${y(r.hiF).toFixed(1)}`).join(" ")}" fill="none" stroke="#431407" stroke-width="2.5" stroke-linejoin="round"/>`;
  const every = W < 520 ? 6 : 3, offset = W < 520 ? 3 : 0;  // narrow: 3 AM, 9 AM, 3 PM, 9 PM
  rp.rows.forEach((r, i) => {
    if ((i - offset) % every) return;
    const cx = x(i) + bw / 2;
    s += `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${H - B}" y2="${H - B + 4}" stroke="#78716c"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${H - B + 17}" text-anchor="${i === 0 ? "start" : "middle"}" fill="#57534e">${esc(fmtHour(r.t))}</text>`;
  });
  box.innerHTML = s + "</svg>";
}

let rt = 0;
if (typeof window !== "undefined") window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawAll, 150); });
