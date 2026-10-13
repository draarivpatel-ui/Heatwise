# HeatWise accessibility and performance audit (Mon Oct 12, 2026, ~9:55–10:30 PM EDT)

Audit only. **No app code was changed**: HeatWise is submitted to EurekaDev 2026 and its behaviour is frozen. The few follow-ups are queued in BACKLOG.md as "post-judging a11y fixes", NOT BEFORE the EurekaDev winners announcement (Devpost: **Fri Nov 6, 2026, 9:00 AM** as printed, labelled "CDT", https://eurekadev.devpost.com/details/dates).

## Result
**Serious: 0 · Critical: 0.** The cleanest of the four apps. Top finding is performance, not accessibility: Total Blocking Time is 280 ms on a simulated mid-range phone (P1). No accessibility fix is required.

## How it was tested
- Target: live https://aariv.me/Heatwise/. Local `index.html`, `js/*`, `styles.css` and `sw.js` are byte-identical to it (checked Oct 12).
- Headless Chromium 155 + Playwright 1.63.0; axe-core **4.14.0** (pinned). Harness: `/workspace/work/a11y-audit-oct12/audit.py`; raw JSON in `results/Heatwise.1280.json` and `results/Heatwise.360.json` (Hark's workspace).
- Views: landing, sample hot day (all `<details>` open), place picker ("Pasadena"), Aug 24, 2023 record-day replay. Each at 1280×900 and 360×740.
- Rule set: WCAG 2.0/2.1/2.2 A+AA + best-practice. This includes `target-size`, which axe leaves off by default.
- Keyboard pass, 360/320 px layout check and pixel-measured contrast, the same method as for the other apps.
- Performance: Lighthouse 12.8.2, mobile preset, 1 live run.

## Findings
| # | Severity | WCAG | Finding | Fix it needs |
|---|---|---|---|---|
| H1 | Advisory (passes AA) | 1.4.3 Contrast (Minimum) | The amber flag-threshold label on the plan chart ("82°F", `fill="#a16207"`, 12 px bold) has a white halo (`stroke="#fff"`, `paint-order="stroke"`). Measured against the coloured band behind it: 4.53–4.77:1. It passes, but only just. | Optional: darken to `#854d0e` (6.38:1 on the yellow band) for margin. |

No other issues found:
- **axe:** 0 violations of any impact in all 8 view×width runs. axe left the chart text (SVG) "incomplete" (40–254 nodes per view). Pixel measurement shows axis labels at 7.63:1 and titles at 17.49:1; only H1 is close to the limit.
- **Keyboard:** skip link first, moves focus to `<main>`; 48 stops; no trap; nothing unreachable; blue ring `#2563eb` at 4.91:1 on the page and 5.17:1 on white.
- **360 / 320 px:** no sideways scroll, nothing past the right edge, no target under 24 px, no text under 12 px.

## Performance (Lighthouse mobile, live, 1 run)
Performance **93** · Accessibility **100** · Best practices **100** · SEO **100**.
FCP 1.6 s · LCP 1.7 s · TBT **280 ms** · CLS 0.059 · Speed Index 1.8 s · TTI 2.1 s · Max potential FID 480 ms · 130 KiB transferred (fonts are most of it).

| # | Severity | Finding | Fix it needs |
|---|---|---|---|
| P1 | Minor | Main-thread work 2.6 s with a long task at load: TBT 280 ms, max potential FID 480 ms. The likely cause is the initial chart/validation render (inferred, not profiled). | Profile it. Defer the validation section's chart render until it scrolls into view (`IntersectionObserver`), or until idle. |
| P2 | Minor | CLS 0.059. That's in the "good" band, but not 0. | Reserve height for the late-filled blocks (replay hint / validation tiles). |
| P3 | Minor | JS not minified (~12 KiB to save). | Optional build-time minify. |
| P4 | Info (not app-fixable) | GitHub Pages 10-minute cache TTL on fonts/JS. | None. |

## Regression guard added (tests only)
`tests/browser/axe_baseline_qa.py` (8 checks, run in CI after `axe_states_qa.py`) serves the repo locally and runs axe-core 4.14.0 with WCAG 2.2 AA + best-practice tags on the 4 views at 360 and 1280 px. Geocoding is mocked; forecasts are refused, since these views don't need them. It fails on any serious or critical violation not in `BASELINE`, which is empty.
