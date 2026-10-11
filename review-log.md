# HeatWise review log

Judge-style review passes: bugs, accuracy of the heat guidance against the sources, accessibility,
the 390 px phone layout, error states, and the Spanish text. Each round lists what was found and what changed.

## 2026-10-10 review cycle (3 rounds)

Baseline before the cycle: `node tests/heat.test.mjs` → 27/27 passing. Headless Chromium at 390×844
(EN and ES, sample day): no console errors, no horizontal overflow, axe-core 4.10 (WCAG 2.0/2.1 A/AA +
best practice): 0 violations. The live site matched the local files byte-for-byte.

### Round 1: bugs and error states

| Found | Fix |
|---|---|
| When the forecast request failed (e.g. Open-Meteo's HTTP 429 "Daily API request limit exceeded"), the app swapped in the sample day, rewrote the URL to `?sample=1` (so the shared link lost the place) and offered no way to retry. The message also said the service "didn't respond", which is wrong for a 429. | The place is kept: the URL still carries `lat/lon/name`, the place label stays, and a **Try again** button appears next to the status. The message now says plainly that the chart below is the SYNTHETIC sample day, not their weather. Retry was verified headlessly (429 → retry with a working response → real forecast, banner gone). |
| A plan left open in a tab never moved on: "This hour" kept showing the hour the page was loaded. | All future forecast hours are kept (72 h from Open-Meteo) and every render drops hours that have ended, then shows the next 48. Coming back to the tab after ≥ 1 h refetches the forecast; if every hour has passed it refetches instead of showing old hours. Verified with Playwright's fake clock: +3 h moves "This hour" from 3 PM to 6 PM. |
| A failed place search left the previous result list on screen. | The result list is hidden at the start of every search. |
| "Use my location" had no busy state and gave one message for both "permission denied" and "timed out/unavailable". | Buttons are disabled while locating, "Finding your location…" is announced, and denied vs. unavailable get separate messages (EN + ES). |
| On a plain visit the Activity menu showed "Football practice" but the hidden OSHA workload was still "Light", so switching the guideline to OSHA started from the wrong workload. | The default preset is applied on load, so the workload matches the menu. |
| Spanish chart description ended "…8 a.m.." (double period). | No extra period when the time already ends in one (EN + ES). |
| Printed summary showed "—" for not acclimatized. | Prints "Not acclimatized" / "No aclimatado". |

### Round 2: accuracy of the heat guidance

Sources read this round (fetched 2026-10-10): OSHA *Heat Hazard Recognition* (Table 2 limits, clothing
factors, workload examples) https://www.osha.gov/heat-exposure/hazards · CDC/NIOSH *Workplace
Recommendations* (hydration, acclimatization) https://www.cdc.gov/niosh/heat-stress/recommendations/index.html ·
NWS/WPC *The Heat Index Equation* https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml · NWS *Heat
Cramps, Exhaustion, Stroke* https://www.weather.gov/safety/heat-illness · OSHA *Heat-Related Illnesses and
First Aid* https://www.osha.gov/heat-exposure/illness-first-aid · UIL *2026-2027 Heat Stress & Athletic
Participation REQUIRED Plan*, including its WBGT Activity Guidelines chart image and WBGT class map
https://www.uiltexas.org/health/info/heat-stress-and-athletic-participation

Confirmed correct, no change needed: OSHA/NIOSH limits (light 28/30, moderate 25/28, heavy 23/26, very
heavy 21/25 °C); clothing factors (0, 0, 0.5, 1, 3, 11 °C); NIOSH hydration (1 cup every 15–20 min for
moderate activity < 2 h, ≤ 6 cups/h, water < 15 °C, electrolytes when sweating lasts hours); NIOSH
acclimatization (new: 20 % then +20 %/day; experienced: 50/60/80/100 %; 7–14 days); NWS Rothfusz heat index
including the simple-formula step and both adjustments; UIL Class 3 and Class 2 flag edges and each flag's
rest-break, equipment and practice-length rules; UIL's 15-min / 30-min WBGT checks; OSHA first aid (cold-water
immersion is the best method, never leave them alone, when in doubt cool and call 911).

| Found | Fix |
|---|---|
| First aid omitted NWS points that change what a bystander does: heat stroke, **do not give fluids**; heat exhaustion, give sips of water and get medical help if they vomit, get worse, or aren't better within 1 hour; heat cramps, get help if they last over 1 hour; heat stroke body temperature above 103 °F. | Added to the warning-signs card in EN and ES, plus OSHA's "hot dry skin or heavy sweating" sign; NWS page added to Sources. |
| Water plan left out NIOSH's "avoid alcohol and drinks with high caffeine or sugar". | Added (EN + ES). |
| UIL monitoring note said UIL requires a WBGT reading before every practice; UIL ties the rule to practices at or above the yellow flag (82.0 °F Class 3 / 79.7 °F Class 2). | Note now states the threshold (EN + ES). |
| Orange-flag football text missed UIL's exception: if WBGT rises to orange during practice, players may keep pants on. | Added (EN + ES). |
| UIL class hint gave no basis for picking a class. | Hint now says what UIL's map shows: Houston area and most of Texas are Class 3, parts of West Texas and the Panhandle are lower. |
| README and devpost.md were out of date and over/under-claimed: said WBGT used only the BoM formula and listed Liljegren as "what's next" (it is implemented), described only NIOSH mode (no UIL), "300" brute-force cases (it is 500), "13 tests", old github.io URLs and a lowercase repo name, a video script that referenced a non-existent preset and an acclimatized box that is hidden in UIL mode. | Rewrote README "How it works", tests, limitations (incl. that the Spanish has not had a native-speaker review) and run links (live: https://aariv.me/Heatwise/); updated devpost.md the same way and fixed the video script. No users, pilots or testimonials are claimed anywhere. |
| Nothing stopped the explanation text from drifting away from the code. | Two new tests: the EN and ES "How the math works" text quotes the same UIL edges and OSHA/NIOSH limits as `heat.js`; guidance strings in both languages carry the sources' numbers (48 oz/h, 15 °C/59 °F, 82.0/79.7 °F, 15/30 min, 911, 103 °F, 7–14 days) and the fallback is labelled SYNTHETIC/SINTÉTICO. Tests: 27 → 29. |

### Round 3: 390 px phone layout, accessibility, Spanish

| Found | Fix |
|---|---|
| Chart time labels overlapped at 390 px, badly in Spanish ("sáb 3 p.m." ran into "3 a.m."). | Tick labels are two lines (hour, then weekday), the first is left-aligned and any near the right edge right-aligned. Flag/limit labels on the chart get a white halo so the WBGT line can't hide them. |
| Closed menus were cut off on a phone: "Texas UIL athletics & marching bar…", "Class 3 (Houston-area districts use…", and the search placeholder lost "77479". | Shorter labels in EN and ES ("Texas UIL: sports & band", "Work: OSHA/NIOSH limits", "Class 3 (incl. Houston area)"), placeholder "e.g. Houston or 77479" / "ej. Houston o 77479". The detail moved into the class hint. |
| Stat values wrapped mid-value in the Safest-window card ("73.8°F / (23.2°C)", "78°F · 75% / RH"). | Values stay on one line; the label column wraps instead. Slightly tighter table and card padding under 480 px. |
| The checkboxes inherited the 44 px minimum height meant for text fields, so the box sat out of line with its label. | Checkboxes are 24×24 and centred in a 44 px-tall clickable label. |
| The skip link pointed at the results section, which is hidden until a plan exists, so it did nothing on first visit. | "Skip to main content" / "Saltar al contenido principal" now targets `<main>` (focusable). |
| Language buttons were announced as "E N" / "E S". | `aria-label="English"` / `"Español"`. |
| A shared link with work settings (`g=osha&wl=heavy`) but no preset showed "Football practice" in the Activity menu. | When a link's settings don't match its preset, the menu shows "Custom". |
| Spanish: "% RH" (English abbreviation); "Extremo" was the only level without "Riesgo"; the heat-exhaustion line used "Llévala… enfríala" with no clear antecedent. | "% HR" (humedad relativa), "Riesgo extremo", and "Lleva a la persona a la sombra…". All new strings (errors, retry, locating, first aid, water) were added in both languages; the i18n completeness test still passes. |

### Results after the 3 rounds

- `node tests/heat.test.mjs`: **29/29 passing** (was 27; 2 new source-consistency tests).
- Headless Chromium (Playwright 1.63) at 390×844, EN and ES, sample day: 0 console/page errors, page width
  390 = viewport (no horizontal overflow), 0 elements outside the viewport, axe-core 4.10 WCAG 2.0/2.1 A/AA +
  best practice: **0 violations** in both languages. Only targets under 24 px are inline source links in
  running text (allowed by WCAG 2.5.8's inline exception).
- Error states checked headlessly: submit with no place, place search offline, place not found, forecast
  HTTP 429 → labelled sample + Try again → recovers on retry, stale tab (+3 h fake clock) advances "This hour".
- Real-forecast path was tested with a mocked Open-Meteo response because the sandbox's shared IP had hit
  Open-Meteo's daily limit (`{"reason":"Daily API request limit exceeded"}`); the place search (geocoding)
  API itself answered normally ("77479" → Sugar Land, TX).
- Still open: the Spanish has not had a native-speaker review; the long OSHA workload option labels are
  truncated in the closed menu on a phone (the native picker shows them in full).
- Published with `push_repo.sh` to github.com/draarivpatel-ui/Heatwise (main). Live check after the Pages
  rebuild: https://aariv.me/Heatwise/ serves files identical to the repo (index.html, app.js, i18n.js,
  styles.css, README.md, review-log.md hashes match), and the same headless suite run against the live URL
  gave 0 errors, no overflow at 390 px, 0 axe violations (EN + ES), and the same error-state results.

## 2026-10-10 (evening): validation study, the top recommendation from the winning-patterns research

Built because EurekaDev is "a science fair blended with a hackathon" and the Coding track says citations and evidence are a bonus.

| What | Detail |
|---|---|
| NWS agreement study | `js/validation.js` (pure functions) + `scripts/fetch-validation-data.mjs`. 8 Houston-area points (downtown Houston, Sugar Land, Katy, Pearland, Baytown, Tomball, Conroe, Galveston), NWS HGX gridpoint forecast issued 2026-10-10 21:06 UTC, 1,472 forecast point-hours (Oct 10 4 PM – Oct 18 7 AM CT). Archived in `data/validation/` (each file < 90 KB). |
| Heat index result | 770 hours ≥ 80 °F: bias **+0.01 °F**, MAE **0.28 °F**, RMSE 0.33 °F, 99.1% within 1 °F, 100% within 2 °F, max 1.04 °F, 89.1% identical after rounding, r = 0.998. |
| WBGT, same weather | HeatWise Liljegren on NWS T/RH/wind (+ Open-Meteo sunshine/pressure) vs NWS WBGT, 1,376 hours: bias +0.56 °F (day +1.54, night −0.42), MAE 1.07 °F (day 1.64, night 0.50), r = 0.979. UIL Class 3 flag agreement 90.6% (99.9% within one flag); HeatWise was the more cautious flag in 118 of 129 disagreements. |
| WBGT, end to end | App pipeline (Open-Meteo inputs) vs NWS WBGT: bias **−3.92 °F**, MAE 4.33 °F, flag agreement 86.2%; HeatWise's flag was lower in 163 of 190 disagreements. Cause: Open-Meteo's forecast averaged 4.2 °F cooler and 8.7 RH points drier than NWS over the same hours. Reported openly in the app, README and Devpost text; listed as the main "what's next" (use NWS grids as input for U.S. places). |
| 2023 replay | IAH, Aug 24, 2023 (109 °F, tied all-time record; NWS HGX climate summary). IEM ASOS hourly METARs + Open-Meteo ERA5 sunshine. Peak heat index 117 °F (3:53 PM report), peak WBGT 94.4 °F (4:53 PM), UIL black 4 h + red 3 h, safest 2-h window 6–8 AM (green, WBGT ≤ 78.1 °F). HeatWise heat index = IEM's independent value within 0.01 °F for all 24 reports. |
| Methods choices | Only hours valid at/after the NWS issue time (the grid's few past hours aren't refreshed: e.g. Katy showed a 109 °F heat index with a 79 °F WBGT); NWS missing value −120 °F dropped; heat index compared only ≥ 80 °F where it's defined. |
| App | New "Validation" section after "How the math works" (EN + ES): 3 result tiles, heat-index and WBGT scatter plots with 1:1 line and ±2 °F band, per-point table, replay chart (WBGT bars by UIL flag, heat-index line, safest-window box), methods & limits, 12 cited sources. All numbers are recomputed in the browser from the archived data (nothing hard-coded). Header link "Validation ↓". |
| Also fixed | axe `label-content-name-mismatch` on the EN/ES buttons (aria-label now "EN, English" / "ES, Español"). |
| Tests | 29 → **37** passing: ISO-duration/series expansion, missing values, statistics, synthetic heat-index comparison (exclusions), real-snapshot heat index (MAE < 0.5 °F), real-snapshot WBGT (night MAE < 1 °F, flag agreement > 85%), 2023 replay, section consistency + data files < 90 KB. |
| Headless check | Chromium (Playwright) at 1280 px and 390 px, EN and ES, local and live: 0 console/page errors, no horizontal overflow (only the per-point table scrolls inside its own scroll box at 390 px), axe-core WCAG 2.0/2.1 A/AA + best practice: 0 violations on the whole page with the sample plan open. |
| Live | Pushed with `push_repo.sh`; https://aariv.me/Heatwise/ serves files byte-identical to the local copies (index.html, app.js, validation.js, validation-ui.js, i18n.js, styles.css, all three data files). |
| Limits / still open | One October forecast issue (few very hot hours); no WBGT-meter ground truth; README, devpost.md and the video script updated. `heatwise.zip` in the working folder predates this change (it isn't pushed). |

## 2026-10-10 (night): NWS grid as the U.S. input, fixing the validation study's cold bias

The validation study showed the formulas match the NWS but the Open-Meteo inputs ran 4.2 °F cooler and 8.7 RH points drier, so WBGT read 3.9 °F low (the unsafe direction). Fixed:

| What | Detail |
|---|---|
| New input path | `js/forecast.js`. For U.S. places (rough boxes for CONUS, AK, HI, PR/USVI, Guam/CNMI, American Samoa; the `/points` 404 decides near borders) the app requests the NWS grid (`/points/{lat,lon}` rounded to 4 decimals → `forecastGridData`) and Open-Meteo in parallel. NWS temperature, RH (dewpoint if RH is missing) and 10 m wind replace Open-Meteo's for every hour the grid covers; Open-Meteo keeps sunshine, pressure and day/night. Grid hours before the issue hour are ignored (same rule as the study). °F, K, m/s, kn, mph units handled; −120 °F missing values dropped. |
| NWS API rules | Checked https://www.weather.gov/documentation/services-web-api: free/open, User-Agent identifying the app required, unpublished rate limit (retry after ~5 s), grids can be cached but /points must be re-checked. Browsers can't set User-Agent, so the browser sends its own and only `Accept: application/geo+json` (CORS-safelisted, no preflight); Node scripts send `HeatWise heat-safety planner (github.com/draarivpatel-ui/Heatwise)`. Grid 429/5xx retried once; 9 s timeout; grid older than 36 h treated as stale. |
| Browser fetch test | Headless Chromium (Playwright): `GET api.weather.gov/points/29.6197,-95.6349` and `/gridpoints/HGX/53,88` both 200 with `access-control-allow-origin: *`, method GET (no OPTIONS preflight), browser's own User-Agent, page used the data (source = NWS). The sandbox Chromium has no direct internet, so requests were replayed server-side with the browser's exact headers and the real response headers returned (CORS still enforced by Chromium). |
| Fallbacks | NWS error/timeout/stale → Open-Meteo for everything, with an orange warning line ("backup… read WBGT about 4°F low… be extra careful"); outside the U.S. → Open-Meteo, no NWS request; Open-Meteo down but NWS up → NWS-only plan with the simpler BoM WBGT; both down → the existing labelled synthetic sample + Try again. |
| Source in the UI | New line under the plan (EN + ES): "Temperature, humidity and wind: National Weather Service (NWS) · Sunshine and pressure: Open-Meteo · NWS forecast for this spot" (links to forecast.weather.gov MapClick), or the Open-Meteo / outside-U.S. / backup / NWS-only / synthetic-sample variants. "How the math works", Sources and README describe the new path. |
| Validation re-run | Same archived data (`data/validation/`, unchanged). New `compareWbgt` mode "app" rebuilds each archived NWS point in the API's own series format and feeds it through `nwsHourly()` + `mergeInputs()`, exactly as the app does. **End-to-end WBGT bias −3.92 °F → +0.56 °F** (day +1.54, night −0.42), MAE 4.33 → 1.07 °F, RMSE 6.36 → 1.40 °F, r 0.873 → 0.979, UIL Class 3 flag agreement 86.2% → 90.6% (within one flag 99.9%), HeatWise the more cautious flag in 118 of 129 disagreements (was the lower flag in 163 of 190). Identical to the NWS-weather-from-snapshot result, so the input code adds no error. The Validation section now shows heat index / WBGT end to end (U.S. path) / WBGT backup path (Open-Meteo only); all recomputed in the browser. |
| Tests | 37 → **49** passing: NWS-area check; grid parser on a trimmed real response (`tests/fixtures/nws-grid-sugarland.json`, `nws-points-sugarland.json`); units/missing/dewpoint; merge; fake-fetch fallbacks (NWS 500, grid 503 retried once / twice → fallback, London makes no NWS request, `/points` 404, stale grid, 50 ms timeout, Open-Meteo 429 → NWS-only, both down → reject); app path = same-weather result and errs warm; source labels in EN/ES and the backup warning quotes the measured bias (test fails if the study's number changes). |
| Headless check | Chromium at 1280 and 390 px, EN and ES: U.S. place (real NWS; Open-Meteo stood in by an Open-Meteo-shaped mock because the sandbox IP was at Open-Meteo's hourly limit, HTTP 429), NWS-down (500) and London. 0 page errors (only the browser's own log line for the deliberate 500/429), no horizontal overflow, axe-core WCAG 2.0/2.1 A/AA + best practice: 0 violations in every run. With the real Open-Meteo 429 the app correctly showed the NWS-only plan. |
| Still open | Outside the U.S. Open-Meteo is still the only input and its bias there is unknown; one October week, one region; Spanish still not native-reviewed. |
| Live | Pushed with `push_repo.sh`; after the Pages rebuild https://aariv.me/Heatwise/ serves files byte-identical to the local copies (index.html, all JS incl. the new `js/forecast.js`, styles.css, README.md, tests, fixtures, data). The headless suite against the live URL gave the same results (U.S. → NWS source, NWS 500 → warned backup, London → Open-Meteo; 0 axe violations, no overflow at 390 px, EN + ES). A separate real browser (no proxy, no mocks, real Open-Meteo) opened `?lat=29.6197&lon=-95.6349&name=Sugar Land, TX` on the live site: source line "Temperature, humidity and wind: National Weather Service (NWS) · Sunshine and pressure: Open-Meteo · NWS forecast for this spot", no sample banner, no errors, This hour 86 °F · 45% RH, WBGT 74.2 °F, green; Validation tiles 0.28 °F / 1.07 °F (bias +0.56) / 4.33 °F (bias −3.92). |

## 2026-10-10 (late night): mock judges' fixes – record-day replay button, one-page coach plan, stale zip

| What | Detail |
|---|---|
| 1. One-click replay | New button at the top of the page, above the form (above the fold at 1280 and 390 px): "▶ Replay Houston's record day (Aug 24, 2023)" / "▶ Repetir el día récord de Houston (24 ago 2023)". It loads the archived `data/validation/replay-iah-2023-08-24.json` and runs it through the normal plan view (`js/plan.js` `replayHours()`, same conversion as `validation.js` `replayDay()`): a blue "HISTORICAL REPLAY, not a forecast" banner, source line naming the IEM archive + Open-Meteo ERA5, "Hottest hour that day" (Black, 5 PM, WBGT 94.4 °F) in place of "This hour", the 24-hour chart titled "August 24, 2023, hour by hour (replay)" with the UIL flag bands and safest-window box, the hourly table, and the safest window **6 AM – 8 AM (green, worst hour 78.1 °F)**, identical to the validation study. All settings (class, duration, hours, work mode) still apply. Link: `?replay=iah2023`. A replay never refetches or rolls forward with the clock. |
| 2. One-page coach plan | New card in every plan: pick the day (local days in the plan) and the plan language (English / Spanish / Both). The sheet shows place, activity, guideline, practice hours, the safest window for that day with its worst-hour flag and the UIL/OSHA rule, an hour-by-hour flag strip (window outlined), the hottest hour, the rules for each level that occurs that day, water (NIOSH + UIL), a before-practice checklist (cold-water tub, water stations, a 911 caller who knows the address), heat-stroke first aid, and the "measure on site" note. **Print / save as PDF** prints only the sheet: 1 Letter page per language (Both = 2 pages, checked in Letter and A4 PDFs, EN and ES). **Share plan as text** uses the phone share sheet on touch devices, otherwise copies a plain-text version (title, replay label, window, rule, every hour, water, checklist, 911, link) to the clipboard. Day and sheet language ride in the share link (`pd=`, `sl=`). The full-page "Print / save PDF" still prints the whole plan without the coach card. |
| 3. heatwise.zip | Nothing in the repo or docs used it (only a comment in the local-only `push_to_github.sh`, which never gets pushed, and push_repo.sh skips `*.zip`), so it was **deleted** and that comment updated. A test fails if it comes back. |
| Tests | 49 → **54** passing: replay through the plan view = validation replay (WBGT and flags for all 24 hours); coach plan for Aug 24, 2023 (15 practice hours, 6–8 AM green, every black hour counted); edge cases (no window fits, whole-day hours, a forecast spanning three local days across the Nov 1 DST change); share text in EN and ES (every hour, window, 911, replay label, no English words left in the Spanish, cap warning on a red/black window); page wiring (button before the form, print CSS prints only the sheet, one page per language, zip gone). |
| Headless check | Chromium (Playwright) at 1280 and 390 px, EN and ES, local and live: replay button above the fold, click → replay banner, source `replay`, window 6–8 AM, 24 table rows, plan day 2023-08-24, sheet with 15 hour cells (2 outlined); 0 console/page errors, no horizontal overflow, axe-core WCAG 2.0/2.1 A/AA + best practice **0 violations** with the replay and coach plan open; share button copied the plan text and showed the EN/ES confirmation; print PDFs 1/1/2 pages. Also: `?sample=1&lang=es` lists 3 days and a Spanish sheet; a shared `?replay=iah2023&sl=both` link restores the replay with both sheets. Regression on the live NWS path (Sugar Land, 1280/390, EN/ES): source NWS, 0 errors, 0 axe violations. |
| Docs | README (features, replay link, file list, tests), devpost.md (What it does, Try-it-out replay link, video script: replay button at 3:35, Spanish coach plan print at 3:44, end card 3:50–3:56, still under 4:00). |
| Live | Pushed with `push_repo.sh`; https://aariv.me/Heatwise/ serves files byte-identical to the local copies (index.html, js/app.js, js/plan.js, js/i18n.js, styles.css, README.md, tests). |
| Still open | Spanish still not native-reviewed (new sheet strings included); the coach plan is one Letter/A4 page for a 15-hour practice range, and a much wider range (e.g. midnight–midnight) can run to a second page. |
