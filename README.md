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

**Live:** https://aariv.me/Heatwise/ · **Demo day (synthetic, labelled):** https://aariv.me/Heatwise/?sample=1

Built for **EurekaDev 2026**, Coding Track, Problem in the Community.

---

## Why

Heat is getting deadlier, and the people at risk are often the ones who don't get to pick their hours.

- U.S. heat-related deaths rose from 1,069 in 1999 to **2,325 in 2023**, the highest in the 25-year study period ([Howard et al., *JAMA*, 2024](https://jamanetwork.com/journals/jama/fullarticle/2822854)).
- Texas recorded **334 heat deaths in 2023** (preliminary state data, Jan 1–Nov 30), the most since the state started tracking in 1989, and **Harris County had the most of any Texas county** ([Texas Tribune, Jan 12, 2024](https://www.texastribune.org/2024/01/12/texas-heat-deaths-2023-record-climate-change)).
- OSHA notes outdoor workers have died of heat stroke on days when the maximum heat index was **only 86°F**, and that the weather-app heat index can underestimate real risk because it ignores workload, sun, and clothing ([OSHA](https://www.osha.gov/heat-exposure/hazards)).

Most weather apps answer "how hot is it?" HeatWise answers the question a coach or worker actually has: **"Is it safe for *us* to do *this*, and if not, when?"**

## How it works

1. **Forecast:** hourly temperature, humidity, solar radiation, 10 m wind and surface pressure from [Open-Meteo](https://open-meteo.com/) (free, no API key), for any place you search or your device location.
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

## Tech

- Plain **HTML, CSS, and JavaScript (ES modules)**. No framework, no build step, no backend, no tracking.
- Works on phones, and you can print the plan or save it as a PDF.
- **Open-Meteo** Forecast and Geocoding APIs (free, no key). If the forecast can't be loaded (offline, or the API's rate limit), HeatWise says so, shows a clearly labelled **synthetic sample day**, keeps your place in the link, and offers **Try again**.
- All math lives in pure functions in [`js/heat.js`](js/heat.js) with a dependency-free test suite in [`tests/heat.test.mjs`](tests/heat.test.mjs).

```
index.html        UI markup
styles.css        styles (incl. print stylesheet)
js/heat.js        heat math: Liljegren WBGT, heat index, UIL flags, OSHA/NIOSH limits, best window, hydration, acclimatization
js/i18n.js        English/Spanish strings + activity presets
js/app.js         forecast fetch, rendering (SVG chart), sharing
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
The tests check the Liljegren globe and wet-bulb temperatures and end-to-end WBGT against pywbgt reference values, the sun position against NREL SPA (pvlib), the heat index against NWS chart values, the BoM fallback against BoM's worked example (29.4 °C / 59% RH → ≈30 °C), the UIL flag edges for Class 2 and 3, OSHA/NIOSH limits and clothing factors, the best-window algorithm (including the brute-force comparison), hydration and acclimatization math, DST-aware local hours, that every English string has a Spanish one, and that the guidance text quotes the same numbers as the code.

## Limitations (being honest)

- WBGT here is **estimated from a forecast**, not measured. The Liljegren model is the standard physics approach, but the inputs are a forecast for a grid cell, not your field or roof: clouds, wind and humidity can differ, and artificial turf, asphalt, and bowl-shaped stadiums can be hotter. OSHA recommends an on-site WBGT meter, and UIL requires schools to check WBGT with a meter or an approved app before and during practice. HeatWise is for **planning ahead**, not for that check.
- When the forecast has no sun or wind data, the simple BoM fallback is used; it tends to read **high at night, in clouds, or in wind** (HeatWise marks those hours with *).
- Personal factors (medications, illness, fitness, prior heat illness) are not modeled.
- The Spanish text was written for this project and checked against the English, but it has **not yet been reviewed by a native speaker**.
- HeatWise is a **screening and planning tool, not medical advice**. When in doubt, cool the person and call 911.

## What's next

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
- Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0)

## License

MIT © 2026 Aariv Patel
