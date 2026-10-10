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
