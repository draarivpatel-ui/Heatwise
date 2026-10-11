# HeatWise 🌡️

**Plan outdoor practice and work around the heat, hour by hour.**

HeatWise turns a free weather forecast into a personal heat-safety plan for student athletes, marching-band members, coaches, and outdoor workers. You tell it *where*, *what you're doing*, and *for how long*; it tells you:

- **This hour:** your heat level right now, either as a **Texas UIL WBGT flag** (athletics and marching band) or against the **OSHA/NIOSH heat-stress limit** for *your* workload, acclimatization and clothing
- **Safest window:** the best time in the next 48 hours to schedule your session (within the hours you allow), with a warning if even that window hits a flag that caps practice length
- **Hour-by-hour chart and table** of estimated WBGT in the sun vs. the flag lines or your limit, plus the familiar NWS heat index
- **Water plan** from NIOSH hydration guidance (plus UIL's water rules in athletics mode)
- **Acclimatization planner** (NIOSH day-by-day build-up for people new to the heat)
- **Warning signs and first aid** from OSHA and the NWS, in **English and Spanish**
- **Shareable link and printable plan**, so a coach can send the whole team the same plan
- **One-page coach plan** for any day in the plan: the safest practice window, an hour-by-hour flag strip, the rules for each flag that day, water, a before-practice checklist and first aid. Print it (or save as PDF) in **English, Spanish, or both** (one page per language), or share it as plain text for a team chat
- **One-click replay of Houston's record day** ("▶ Replay Houston's record day (Aug 24, 2023)" at the top of the page): runs the archived IAH weather from the day Houston hit 109°F through the normal plan view, clearly labelled as a historical replay, so judges and coaches can see what HeatWise does on a dangerous day even when today's forecast is mild

**Live:** https://aariv.me/Heatwise/ · **Record-day replay:** https://aariv.me/Heatwise/?replay=iah2023 · **Demo day (synthetic, labelled):** https://aariv.me/Heatwise/?sample=1

Built for **EurekaDev 2026**, Coding Track, Problem in the Community.

---

## Why

Heat is getting deadlier, and the people at risk are often the ones who don't get to pick their hours.

- U.S. heat-related deaths rose from 1,069 in 1999 to **2,325 in 2023**, the highest in the 25-year study period ([Howard et al., *JAMA*, 2024](https://jamanetwork.com/journals/jama/fullarticle/2822854)).
- Texas recorded **334 heat deaths in 2023** (preliminary state data, Jan 1–Nov 30), the most since the state started tracking in 1989, and **Harris County had the most of any Texas county** ([Texas Tribune, Jan 12, 2024](https://www.texastribune.org/2024/01/12/texas-heat-deaths-2023-record-climate-change)).
- OSHA notes outdoor workers have died of heat stroke on days when the maximum heat index was **only 86°F**, and that the weather-app heat index can underestimate real risk because it ignores workload, sun, and clothing ([OSHA](https://www.osha.gov/heat-exposure/hazards)).

Most weather apps answer "how hot is it?" HeatWise answers the question a coach or worker actually has: **"Is it safe for *us* to do *this*, and if not, when?"**

## How it works

1. **Forecast:** for **U.S. places**, hourly temperature, humidity and 10 m wind come from the **National Weather Service gridded forecast** ([api.weather.gov](https://www.weather.gov/documentation/services-web-api) `/points` → `forecastGridData`, the same NDFD grid behind the NWS heat index and WBGT forecasts). Solar radiation and surface pressure come from [Open-Meteo](https://open-meteo.com/), because the NWS grid has no sunshine value. **Outside the U.S., or if the NWS request fails or times out**, every input comes from Open-Meteo. Both are free with no API key. The plan says which source it used (and links to the NWS forecast for that spot); when it had to fall back inside the U.S., it says so and warns that the backup read WBGT low in testing. See [`js/forecast.js`](js/forecast.js).
2. **WBGT in the sun** (wet-bulb globe temperature, the index OSHA, NIOSH, the military, and Texas UIL use) is estimated with the **Liljegren et al. (2008)** physics model: it solves the heat balance of a black globe and a wet wick using the sun's angle (NOAA solar-position equations), sunshine, wind (scaled from 10 m to 2 m), humidity, and temperature, then `WBGT = 0.7·Tnwb + 0.2·Tg + 0.1·Ta`. The JavaScript port is tested against the open-source reference implementation (pywbgt) to within 0.05 °C. If sun or wind data are missing it falls back to the Australian Bureau of Meteorology approximation `WBGT ≈ 0.567·T + 0.393·e + 3.94` and marks hours where that estimate likely reads high.
3. **Texas UIL mode** (athletics and marching band): WBGT is compared with UIL's required WBGT activity flags (Class 3: green < 82.0 °F, yellow 82.0–86.9, orange 87.0–90.0, red 90.1–92.0, black ≥ 92.1; Class 2: 79.7 / 84.7 / 87.7 / 89.8 °F), and HeatWise shows UIL's rest-break, equipment and practice-length rules for each flag (orange: 2 h max, red: 1 h max, black: no outdoor workouts).
4. **Work mode:** effective WBGT = WBGT + clothing adjustment (OSHA/NIOSH: 0 °C for work clothes up to +11 °C for vapor-barrier coveralls), compared with the OSHA/NIOSH limit (unacclimatized / acclimatized):

   | Workload | Limit |
   |---|---|
   | Light | 28 / 30 °C |
   | Moderate | 25 / 28 °C |
   | Heavy | 23 / 26 °C |
   | Very heavy | 21 / 25 °C |

   HeatWise bands: < −2 °C *lower risk*, −2 to 0 *caution*, 0 to +2 *high*, > +2 *extreme*. (The limit is OSHA/NIOSH's; the ±2 °C bands are a HeatWise design choice.)
5. **Safest window:** among every run of consecutive allowed hours of your session length, choose the one whose *worst* hour is coolest (a minimax problem). It runs in **O(n)** using a monotonic-deque sliding-window maximum, and the test suite checks it against brute force on 500 random cases.
6. **Activity presets** (football practice, band rehearsal, mowing, a mail route…) pick the guideline and the closest OSHA workload category.
7. **Heat index** (shade, for familiarity only) uses the NWS Rothfusz regression with its published adjustments.

## Validation study: does HeatWise agree with the National Weather Service?

HeatWise's numbers come from code, so I checked them against the **National Weather Service's own forecast** for 8 Houston-area points (downtown Houston, Sugar Land, Katy, Pearland, Baytown, Tomball, Conroe, Galveston), over every forecast hour the NWS grid had: **1,472 point-hours**, Oct 10, 4 PM to Oct 18, 7 AM (Central), from the forecast issued Oct 10, 2026 at 4:06 PM CDT. It is framed as **agreement, not accuracy**: the NWS numbers are forecasts too. The same results, with charts, are in the app's **Validation** section, which recomputes every number in the browser from the archived data.

| Comparison | Hours | Bias (HeatWise − NWS) | Mean abs. difference | Other |
|---|---|---|---|---|
| **Heat index**, HeatWise formula on the NWS forecast temperature + humidity vs the NWS forecast heat index (hours ≥ 80 °F) | 770 | **+0.01 °F** | **0.28 °F** | 99.1% within 1 °F, 100% within 2 °F, max 1.04 °F; 89.1% identical after rounding to whole °F like the NWS; r = 0.998 |
| **WBGT, end to end, the app in the U.S.**: the archived NWS grid rebuilt in the API's format and run through the app's own input code (`nwsHourly()` + `mergeInputs()` in `js/forecast.js`: NWS temperature, humidity and wind, Open-Meteo sunshine and pressure), then HeatWise's Liljegren WBGT, vs the NWS WBGT forecast | 1,376 | **+0.56 °F** (day +1.54, night −0.42) | 1.07 °F (day 1.64, night 0.50) | Texas UIL flag (Class 3) matched in **90.6%** of hours, within one flag in 99.9%; in **118 of the 129** disagreements HeatWise showed the *more cautious* flag; r = 0.979. Identical to feeding the NWS weather straight from the snapshot, so the app's input code adds no error. |
| **WBGT, backup path** (all inputs from Open-Meteo: the app outside the U.S. or when the NWS fails, and the app's only path before this change) vs the NWS WBGT forecast | 1,376 | −3.92 °F | 4.33 °F | UIL flag matched in 86.2% of hours; in 163 of the 190 disagreements HeatWise's flag was *lower*. Over these hours Open-Meteo's forecast was on average 4.2 °F cooler and 8.7 RH points drier than the NWS forecast. |

**What this shows.** (1) The heat-index code reproduces the NWS's operational output; the remaining 0.28 °F is about what rounding the NWS's whole-degree values alone produces. (2) Given the same weather, HeatWise's physics-based WBGT agrees with the NWS's operational WBGT to about 1 °F, matches at night, and runs slightly warmer in the sun, which errs on the side of caution. (3) The biggest source of disagreement was not the formula but the **weather forecast feeding it**: this week Open-Meteo forecast cooler, drier air than the NWS, so the Open-Meteo-only pipeline read WBGT 3.9 °F low (the unsafe direction) and its flags were lower than the NWS's in about 1 hour in 8. **So U.S. plans now use the NWS grid as input**, which moves the end-to-end bias from −3.92 °F to **+0.56 °F** (slightly cautious) on the same archived data. Open-Meteo stays as the source for sunshine and as the fallback.

### Replay: Houston's record heat, Aug 24, 2023

On Aug 24, 2023, Bush Intercontinental Airport (IAH) reached **109 °F**, tying Houston's all-time record, during an NWS Excessive Heat Warning ([NWS Houston August 2023 climate summary](https://www.weather.gov/media/hgx/climate/summary/Aug_2023_Regional_Climate_Summary.pdf); [NWS Storm Data, Aug 2023](https://www.weather.gov/media/hgx/stormdata/aug23hgx.pdf)). Running IAH's archived hourly reports (Iowa Environmental Mesonet ASOS archive) plus archived sunshine (Open-Meteo ERA5) through HeatWise:

- Heat index peaked at **117 °F** (3:53 PM report: 109 °F, 27% RH). WBGT in the sun peaked at **94.4 °F** (4:53 PM report).
- The UIL Class 3 flag was **black (no outdoor workouts) for 4 hours** (the 12:53, 2:53, 3:53 and 4:53 PM reports) and red for 3 more.
- The planner's safest 2-hour window between 6 AM and 9 PM was **6–8 AM, green flag, WBGT ≤ 78.1 °F**.
- Cross-check: HeatWise's heat index matched the Iowa Environmental Mesonet's independently computed heat index for all 24 reports to within 0.01 °F.

### Method and limits
- NWS data: `https://api.weather.gov/points/{lat},{lon}` → `forecastGridData` (Houston/Galveston office, NDFD). Grid values cover 1–N hours each (ISO-8601 durations) and are expanded to hourly steps. Only hours valid at or after the issue time are used (the grid also carries a few already-past hours that are not refreshed with the rest). Missing values (null, and −120 °F) are dropped.
- Heat index is compared only at ≥ 80 °F, where it is defined (below that the NWS reports the air temperature).
- Replay: each routine METAR (at :53) stands for the following top of the hour; airports do not measure sunshine, so solar radiation and pressure come from the ERA5 reanalysis.
- Limits: one forecast issue in October (few very hot hours); agreement with a forecast is not the same as matching a WBGT meter on a field; the NWS WBGT uses its own method and inputs (sky cover rather than measured sunshine).
- Reproduce: `node scripts/fetch-validation-data.mjs` re-downloads everything into `data/validation/`; the tests (`node tests/heat.test.mjs`) re-run the comparisons on the archived snapshot.

## Tech

- Plain **HTML, CSS, and JavaScript (ES modules)**. No framework, no build step, no backend, no tracking.
- Works on phones, and you can print the plan or save it as a PDF.
- **NWS API** (api.weather.gov) for U.S. temperature, humidity and wind, and **Open-Meteo** Forecast and Geocoding APIs (free, no key). The two forecast requests run in parallel. NWS usage rules followed: the API asks for an identifying User-Agent; browsers don't let a page set that header, so the browser sends its own (the API accepts browser requests and returns `Access-Control-Allow-Origin: *`), while the Node data script sends a descriptive one. Only CORS-safelisted headers are sent (`Accept: application/geo+json`), so there is no preflight; coordinates are rounded to 4 decimals (more decimals get a redirect); a 429/5xx from the grid endpoint is retried once; a 9 s timeout and a stale-grid check (> 36 h old) fall back to Open-Meteo. Grid hours before the issue time are ignored (they aren't refreshed). If Open-Meteo fails but the NWS works, the plan uses NWS data with the simpler WBGT formula. If neither loads (offline, rate limits), HeatWise says so, shows a clearly labelled **synthetic sample day**, keeps your place in the link, and offers **Try again**.
- All math lives in pure functions in [`js/heat.js`](js/heat.js) with a dependency-free test suite in [`tests/heat.test.mjs`](tests/heat.test.mjs).

```
index.html        UI markup
styles.css        styles (incl. print stylesheet)
js/heat.js        heat math: Liljegren WBGT, heat index, UIL flags, OSHA/NIOSH limits, best window, hydration, acclimatization
js/i18n.js        English/Spanish strings + activity presets
js/forecast.js    forecast inputs: NWS grid (U.S.) + Open-Meteo sunshine, Open-Meteo fallback, source label data
js/app.js         rendering (SVG chart), sharing, record-day replay, coach plan sheet
js/plan.js        replay hours (IAH Aug 24, 2023) and the one-page coach plan (per-day window, flag strip, share text)
js/validation.js  validation study math: NWS grid parsing, agreement statistics, 2023 replay
js/validation-ui.js  the Validation section (loads data/validation/, draws the charts)
data/validation/  archived NWS + Open-Meteo forecast snapshot (Oct 10, 2026) and the IAH Aug 24, 2023 replay data
scripts/fetch-validation-data.mjs  re-downloads the validation data from the NWS, Open-Meteo and IEM
tests/heat.test.mjs  unit tests (node tests/heat.test.mjs)
tests/make_reference.py  regenerates the pywbgt/pvlib reference values in tests/fixtures/
review-log.md     what each review pass found and fixed
```

## Run it

**Online:** https://aariv.me/Heatwise/ (GitHub Pages from `main` / root).

**Locally:**
```bash
git clone https://github.com/draarivpatel-ui/Heatwise.git
cd Heatwise
python3 -m http.server 8000     # ES modules need http://, not file://
# open http://localhost:8000  (try http://localhost:8000/?sample=1 for the demo day)
```

**Tests** (Node 18+):
```bash
node tests/heat.test.mjs
```
The tests check the Liljegren globe and wet-bulb temperatures and end-to-end WBGT against pywbgt reference values, the sun position against NREL SPA (pvlib), the heat index against NWS chart values, the BoM fallback against BoM's worked example (29.4 °C / 59% RH → ≈30 °C), the UIL flag edges for Class 2 and 3, OSHA/NIOSH limits and clothing factors, the best-window algorithm (including the brute-force comparison), hydration and acclimatization math, DST-aware local hours, that every English string has a Spanish one, and that the guidance text quotes the same numbers as the code. Eight more tests cover the validation study: NWS duration parsing and missing-value handling, the agreement statistics, the archived NWS snapshot (heat index MAE < 0.5 °F, UIL flag agreement > 85%), and the 2023 replay (109 °F, heat index equal to IEM's within 0.1 °F, safest window in the early morning). Twelve cover the forecast inputs: the NWS-area check, the grid parser on a real api.weather.gov response (multi-hour values, °F and m/s units, −120 °F missing values, RH from dewpoint, pre-issue hours), the merge (NWS temperature/humidity/wind, Open-Meteo sunshine/pressure), every fallback with a fake fetch (NWS 500, grid 503 retried once, outside the U.S. with no NWS request, `/points` 404, stale grid, timeout, Open-Meteo down → NWS-only, both down → error), that the app's U.S. path reproduces the NWS-weather validation result and errs warm, and that the source labels exist in both languages and quote the measured backup bias. Five cover the record-day replay and the coach plan: the replay through the plan view gives exactly the validation replay's WBGT and flags; the coach plan for Aug 24, 2023 picks 6–8 AM (green) and counts every black-flag hour; edge cases (no window fits, whole-day hours, a forecast spanning three local days across the end of daylight saving time); the share text in English and Spanish (every hour, the window, 911, the replay label, no English words left in the Spanish); and the page wiring (button above the form, print CSS that prints only the sheet with one page per language). 54 tests in total.

## Limitations (being honest)

- WBGT here is **estimated from a forecast**, not measured. The Liljegren model is the standard physics approach, but the inputs are a forecast for a grid cell, not your field or roof: clouds, wind and humidity can differ, and artificial turf, asphalt, and bowl-shaped stadiums can be hotter. OSHA recommends an on-site WBGT meter, and UIL requires schools to check WBGT with a meter or an approved app before and during practice. HeatWise is for **planning ahead**, not for that check.
- When the forecast has no sun or wind data, the simple BoM fallback is used; it tends to read **high at night, in clouds, or in wind** (HeatWise marks those hours with *).
- The validation study found that Open-Meteo forecast about 4 °F cooler and drier air than the NWS during the test week, so an Open-Meteo-only WBGT read about 3.9 °F lower than the NWS WBGT forecast. U.S. plans now use the NWS grid (end-to-end bias +0.56 °F), but **places outside the U.S., and U.S. plans when the NWS doesn't answer, still use Open-Meteo alone**; the study can't say how far off it is outside Houston. The app labels those plans.
- The validation is one October week from one NWS forecast issue in one region; the NWS WBGT is itself a forecast, not a meter reading.
- Personal factors (medications, illness, fitness, prior heat illness) are not modeled.
- The Spanish text was written for this project and checked against the English, but it has **not yet been reviewed by a native speaker**.
- HeatWise is a **screening and planning tool, not medical advice**. When in doubt, cool the person and call 911.

## What's next

- Repeat the validation over a full summer, and against on-site WBGT meter readings
- Team mode: a coach dashboard with roster acclimatization tracking
- Alerts when the next practice window turns high-risk
- More languages (Vietnamese, Chinese, and Urdu are widely spoken in the Houston area), reviewed by native speakers
- A native-speaker review of the Spanish

## Sources

- OSHA, *Heat Hazard Recognition* (NIOSH limits, clothing factors, workload table): https://www.osha.gov/heat-exposure/hazards
- OSHA, *Water. Rest. Shade.*: https://www.osha.gov/heat-exposure/water-rest-shade
- OSHA, *Heat-Related Illnesses and First Aid*: https://www.osha.gov/heat-exposure/illness-first-aid
- NWS, *Heat Cramps, Exhaustion, Stroke*: https://www.weather.gov/safety/heat-illness
- UIL, *2026-2027 Heat Stress & Athletic Participation REQUIRED Plan* (WBGT flags, monitoring, rapid cooling zones): https://www.uiltexas.org/health/info/heat-stress-and-athletic-participation
- Liljegren JC et al. (2008), *Modeling the Wet Bulb Globe Temperature Using Standard Meteorological Measurements*, J Occup Environ Hyg 5(10):645–655: https://doi.org/10.1080/15459620802310770
- CDC/NIOSH, *Workplace Recommendations* (hydration, acclimatization): https://www.cdc.gov/niosh/heat-stress/recommendations/index.html
- Australian Bureau of Meteorology, *Thermal Comfort observations* (fallback WBGT approximation): http://www.bom.gov.au/info/thermal_stress/
- NOAA/NWS WPC, *The Heat Index Equation*: https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
- Howard JT et al. *Trends of Heat-Related Deaths in the US, 1999–2023.* JAMA. 2024;332(14):1203–1204: https://jamanetwork.com/journals/jama/fullarticle/2822854
- Texas Tribune, Jan 12, 2024: https://www.texastribune.org/2024/01/12/texas-heat-deaths-2023-record-climate-change
- National Weather Service API (gridpoint forecasts, used for validation): https://www.weather.gov/documentation/services-web-api
- NWS Houston/Galveston, *August 2023 Regional Climate Summary*: https://www.weather.gov/media/hgx/climate/summary/Aug_2023_Regional_Climate_Summary.pdf
- NWS Houston/Galveston, *Storm Data and Unusual Weather Phenomena, August 2023*: https://www.weather.gov/media/hgx/stormdata/aug23hgx.pdf
- Houston Public Media, Aug 25, 2023, *Houston ties record for hottest temperature ever recorded*: https://www.houstonpublicmedia.org/articles/news/weather/2023/08/25/460628/houston-ties-record-for-hottest-temperature-ever-recorded-in-city-at-109-degrees
- Space City Weather, Aug 25, 2023 (first official rain in almost 50 days): https://spacecityweather.com/thursday-matched-houstons-hottest-day-on-record-and-brought-our-first-official-rain-in-almost-50-days/
- Iowa Environmental Mesonet, ASOS/METAR archive (IAH hourly reports): https://mesonet.agron.iastate.edu/request/download.phtml
- Open-Meteo Historical Weather API (ERA5): https://open-meteo.com/en/docs/historical-weather-api
- Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0)

## License

MIT © 2026 Aariv Patel
