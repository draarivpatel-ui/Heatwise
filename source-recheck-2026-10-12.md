# HeatWise source re-check, Mon Oct 12 2026 (~10:05 PM CDT)
Fetched with curl; text compared to README/js quotes. Docs only, no app change.

| Source | URL | Result |
|---|---|---|
| UIL heat plan (2026-2027) | uiltexas.org/health/info/heat-stress-and-athletic-participation | 200. Page titled 2026-2027 plan; still says rapid cooling needed at WBGT 79.7 (Class 2) / 82 (Class 3). Matches README. Full flag table edges not re-read from text (page layout); covered by tests. |
| NWS heat illness | weather.gov/safety/heat-illness | 200, reachable. |
| WPC Heat Index Equation | wpc.ncep.noaa.gov/html/heatindex_equation.shtml | 200. Rothfusz coefficients present (-42.379, 2.04901523, 0.22475541, 80 and 13-RH adjustment term). Matches. |
| BoM thermal comfort | bom.gov.au/info/thermal_stress/ | 200. 0.567 / 0.393 / 3.94 present. Matches js/heat.js. |
| Texas Tribune Jan 12 2024 | texastribune.org/2024/01/12/... | 200. 334, 1989, Harris all present. Matches. |
| OSHA heat hazards (86°F claim) | osha.gov/heat-exposure/hazards | UNVERIFIED: 403 to curl (bot block). |
| CDC/NIOSH recommendations | cdc.gov/niosh/... | UNVERIFIED: 403 to curl. |
| JAMA Howard 2024 / Liljegren DOI | jamanetwork.com, doi.org | UNVERIFIED: 403 to curl (publisher bot block). |

Verdict: no stale quote found among the 5 pages that could be read; 4 are bot-blocked and need a real browser to confirm. No README change.
