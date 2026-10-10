# HeatWise 🌡️

**Plan outdoor practice and work around the heat, hour by hour.**

HeatWise turns a free weather forecast into a personal heat-safety plan for student athletes, marching-band members, coaches, and outdoor workers. You tell it *where*, *what you're doing*, and *for how long*; it tells you:

- **Right now:** your heat risk this hour, compared with the NIOSH heat-stress limit for *your* workload
- **Safest window:** the best time in the next 48 hours to schedule your session (within the hours you allow)
- **Hour-by-hour chart and table** of estimated effective WBGT vs. your limit, plus the familiar NWS heat index
- **Water plan** based on NIOSH hydration guidance
- **Acclimatization planner** (NIOSH day-by-day build-up for people new to the heat)
- **Warning signs and first aid** from OSHA, in **English and Spanish**
- **Shareable link and printable plan**, so a coach can send the whole team the same plan

Built for **EurekaDev 2026**, Coding Track, Problem in the Community.

---

## Why

Heat is getting deadlier, and the people at risk are often the ones who don't get to pick their hours.

- U.S. heat-related deaths rose from 1,069 in 1999 to **2,325 in 2023**, the highest in the 25-year study period ([Howard et al., *JAMA*, 2024](https://jamanetwork.com/journals/jama/fullarticle/2822854)).
- Texas recorded **334 heat deaths in 2023** (preliminary state data, Jan 1–Nov 30), the most since the state started tracking in 1989, and **Harris County had the most of any Texas county** ([Texas Tribune, Jan 12, 2024](https://www.texastribune.org/2024/01/12/texas-heat-deaths-2023-record-climate-change)).
- OSHA notes outdoor workers have died of heat stroke on days when the maximum heat index was **only 86°F**, and that the weather-app heat index can underestimate real risk because it ignores workload, sun, and clothing ([OSHA](https://www.osha.gov/heat-exposure/hazards)).

Most weather apps answer "how hot is it?" HeatWise answers the question a coach or worker actually has: **"Is it safe for *us* to do *this*, and if not, when?"**

## How it works

1. **Forecast:** hourly temperature and humidity from [Open-Meteo](https://open-meteo.com/) (free, no API key), for any place you search or your device location.
2. **Estimated WBGT** (wet-bulb globe temperature, the index OSHA, NIOSH, the military, and athletic bodies use), via the Australian Bureau of Meteorology / ACSM approximation:
   `e = RH/100 × 6.105 × exp(17.27·T / (237.7 + T))` and `WBGT ≈ 0.567·T + 0.393·e + 3.94` (T in °C).
3. **Effective WBGT** = WBGT + clothing adjustment (OSHA/NIOSH: 0 °C for normal clothes up to +11 °C for vapor-barrier coveralls).
4. **Your limit** from NIOSH by workload and acclimatization (unacclimatized / acclimatized):

   | Workload | Limit |
   |---|---|
   | Light | 28 / 30 °C |
   | Moderate | 25 / 28 °C |
   | Heavy | 23 / 26 °C |
   | Very heavy | 21 / 25 °C |

5. **Risk** = effective WBGT − limit. HeatWise bands: < −2 °C *lower risk*, −2 to 0 *caution*, 0 to +2 *high*, > +2 *extreme*. (The limit is NIOSH's; the ±2 °C bands are a HeatWise design choice.)
6. **Safest window:** among every run of consecutive allowed hours of your session length, choose the one whose *worst* hour is coolest (a minimax problem). It runs in **O(n)** using a monotonic-deque sliding-window maximum, and the test suite checks it against brute force on 300 random cases.
7. **Activity presets** (football practice, band rehearsal, mowing, a mail route…) map to the closest OSHA workload category.

## Tech

- Plain **HTML, CSS, and JavaScript (ES modules)**. No framework, no build step, no backend, no tracking.
- Works on phones, and you can print the plan or save it as a PDF.
- **Open-Meteo** Forecast and Geocoding APIs (free, no key). If the API is unreachable, HeatWise falls back to a clearly labelled **synthetic sample day** so the demo always works.
- All math lives in pure functions in [`js/heat.js`](js/heat.js) with a dependency-free test suite in [`tests/heat.test.mjs`](tests/heat.test.mjs).

```
index.html        UI markup
styles.css        styles (incl. print stylesheet)
js/heat.js        heat math: WBGT, heat index, NIOSH limits, risk, best-window, hydration, acclimatization
js/i18n.js        English/Spanish strings + activity presets
js/app.js         forecast fetch, rendering (SVG chart), sharing
tests/heat.test.mjs  unit tests (node tests/heat.test.mjs)
```

## Run it

**Online:** enable GitHub Pages (Settings → Pages → Deploy from branch → `main` / root), then open `https://<user>.github.io/heatwise/`.

**Locally:**
```bash
git clone https://github.com/draarivpatel-ui/heatwise.git
cd heatwise
python3 -m http.server 8000     # ES modules need http://, not file://
# open http://localhost:8000  (try http://localhost:8000/?sample=1 for the demo day)
```

**Tests** (Node 18+):
```bash
node tests/heat.test.mjs
```
The tests check the heat index against NWS chart values, the WBGT approximation against BoM's worked example (29.4 °C / 59% RH → ≈30 °C), NIOSH limits, clothing factors, the best-window algorithm (including the brute-force comparison), hydration math, and the acclimatization schedules.

## Limitations (being honest)

- The WBGT here is an **estimate from temperature and humidity**. BoM notes it assumes moderate sun and light wind, so it tends to read **high at night, in clouds, or in wind** (HeatWise marks those hours with *) and **slightly low in full sun with low humidity**. OSHA recommends an on-site WBGT meter for the most accurate assessment.
- Forecasts are for a grid cell, not your exact field or roof. Artificial turf, asphalt, and enclosed stadiums can be hotter.
- Personal factors (medications, illness, fitness, prior heat illness) are not modeled.
- HeatWise is a **screening and planning tool, not medical advice**. When in doubt, cool the person and call 911.

## What's next

- Use Open-Meteo's solar radiation and wind for a fuller WBGT model (e.g., Liljegren) instead of the simplified formula
- Team mode: a coach dashboard with roster acclimatization tracking
- Push/SMS alerts when the next practice window turns high-risk
- More languages (Vietnamese, Chinese, and Urdu are widely spoken in the Houston area), reviewed by native speakers

## Sources

- OSHA, *Heat Hazard Recognition* (NIOSH limits, clothing factors, workload table): https://www.osha.gov/heat-exposure/hazards
- OSHA, *Water. Rest. Shade.*: https://www.osha.gov/heat-exposure/water-rest-shade
- OSHA, *Heat-Related Illnesses and First Aid*: https://www.osha.gov/heat-exposure/illness-first-aid
- CDC/NIOSH, *Workplace Recommendations* (hydration, acclimatization): https://www.cdc.gov/niosh/heat-stress/recommendations/index.html
- Australian Bureau of Meteorology, *Thermal Comfort observations* (WBGT approximation): http://www.bom.gov.au/info/thermal_stress/
- NOAA/NWS WPC, *The Heat Index Equation*: https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
- Howard JT et al. *Trends of Heat-Related Deaths in the US, 1999–2023.* JAMA. 2024;332(14):1203–1204: https://jamanetwork.com/journals/jama/fullarticle/2822854
- Texas Tribune, Jan 12, 2024: https://www.texastribune.org/2024/01/12/texas-heat-deaths-2023-record-climate-change
- Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0)

## License

MIT © 2026 Aariv Patel
