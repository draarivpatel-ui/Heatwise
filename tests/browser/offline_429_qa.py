"""Chromium regression check for HeatWise when the weather APIs rate-limit (HTTP 429) or the device is offline.
Serves the folder locally and stubs every API (NWS answers 500, so Open-Meteo is the forecast source).
  1. Normal lookup -> plan, no warning.
  2. Open-Meteo 429 on "Refresh now" -> the saved forecast stays, labelled honestly, button keeps focus.
  3. Device offline + "Refresh now" -> the saved forecast stays, labelled.
  4. Nothing saved + 429 -> "Couldn't get the forecast ... SYNTHETIC sample day" + Try again.
  5. Nothing saved + offline + Try again -> the offline line (EN), re-worded in Spanish on the ES switch.
  6. Back online + Try again -> the real plan returns, warning gone.
No page errors throughout. Usage: python3 tests/browser/offline_429_qa.py  (CHROME_PATH=/usr/bin/chromium optional)"""
import re, json, os, sys, subprocess, time, math, socket
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
now = int(time.time() // 3600 * 3600); start = now - 6 * 3600
times, temp, rh, rad = [], [], [], []
for i in range(72):
    t = start + i * 3600; hr = ((t // 3600) - 5) % 24; ph = math.cos((hr - 15) / 24 * 2 * math.pi)
    times.append(t); temp.append(round(29 + 5.5 * ph, 1)); rh.append(round(63 - 20 * ph))
    rad.append(round(880 * max(0.0, math.sin((hr - 7) / 12.5 * math.pi))) if 7 <= hr <= 19 else 0)
FC = {"latitude": 29.62, "longitude": -95.63, "utc_offset_seconds": -18000, "timezone": "America/Chicago", "timezone_abbreviation": "CDT",
      "hourly": {"time": times, "temperature_2m": temp, "relative_humidity_2m": rh, "shortwave_radiation": rad,
                 "direct_radiation": [r * 0.8 for r in rad], "diffuse_radiation": [r * 0.2 for r in rad],
                 "wind_speed_10m": [8] * 72, "surface_pressure": [1012] * 72, "cloud_cover": [10] * 72, "is_day": [1] * 72}}
GEO = {"results": [{"name": "Sugar Land", "latitude": 29.61968, "longitude": -95.63495, "admin1": "Texas", "country": "United States", "country_code": "US", "population": 118000}]}
H = {"Access-Control-Allow-Origin": "*"}
mode = {"om": "ok"}
passes, fails, errors = [0], [], []
def check(m, c, extra=""):
    print(("PASS " if c else "FAIL ") + m + ("" if c else f"  [{extra}]"))
    if c: passes[0] += 1
    else: fails.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(**({"executable_path": os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {}), args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, locale="en-US")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route(re.compile(r"^https://geocoding-api\.open-meteo\.com/"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(GEO), headers=H))
    def fc(r):
        if mode.get("off"): return r.abort("internetdisconnected")  # stubs win over set_offline, so cut them too
        if mode["om"] == "429": r.fulfill(status=429, content_type="application/json", body='{"error":true,"reason":"Too many requests"}', headers=H)
        else: r.fulfill(status=200, content_type="application/json", body=json.dumps(FC), headers=H)
    pg.route(re.compile(r"^https://api\.open-meteo\.com/"), fc)
    pg.route(re.compile(r"^https://api\.weather\.gov/"), lambda r: r.abort("internetdisconnected") if mode.get("off") else r.fulfill(status=500, body="down", headers=H))
    status = lambda: pg.text_content("#status").strip()
    sample = lambda: pg.evaluate("document.getElementById('results') && !document.getElementById('results').hidden && /SYNTHETIC|SINTÉTICO/.test(document.getElementById('results').innerText.slice(0, 3000))")
    def idle(): pg.wait_for_function("!document.getElementById('searchBtn').disabled", timeout=15000); pg.wait_for_timeout(250)

    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_timeout(300)
    # 1
    pg.fill("#place", "Sugar Land, TX"); pg.press("#place", "Enter"); pg.wait_for_selector("#results:not([hidden])", timeout=10000); idle()
    check("1 normal lookup: plan shown, no error line, not the sample", not pg.evaluate("document.getElementById('status').classList.contains('error')") and not sample(), status())
    # make the saved forecast 12 min old so 'Refresh now' shows
    pg.evaluate("""(()=>{for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.savedAt) { v.savedAt -= 12*60e3; localStorage.setItem(k, JSON.stringify(v)); } } catch {} }})()""")
    pg.fill("#place", "Sugar Land, TX"); pg.press("#place", "Enter"); idle()
    check("1b repeat lookup reuses the saved forecast with a 'min ago' label and Refresh now", "min ago" in status() and pg.is_visible("#refreshBtn"), status())
    # 2
    mode["om"] = "429"; pg.focus("#refreshBtn"); pg.keyboard.press("Enter"); idle()
    check("2 429 on Refresh now: saved forecast kept, honest label", "didn't answer" in status() and not sample(), status())
    check("2 429 on Refresh now: focus back on Refresh now", pg.evaluate("document.activeElement.id") == "refreshBtn", pg.evaluate("document.activeElement.id"))
    # 3
    mode["om"] = "ok"; ctx.set_offline(True); mode["off"] = True; pg.click("#refreshBtn"); idle()
    check("3 offline Refresh now: saved forecast kept, labelled, not the sample", "didn't answer" in status() and not sample(), status())
    ctx.set_offline(False); mode["off"] = False
    # 4
    pg.evaluate("localStorage.clear()"); mode["om"] = "429"
    pg.fill("#place", "Sugar Land, TX"); pg.press("#place", "Enter"); idle()
    check("4 nothing saved + 429: 'Couldn't get the forecast' + SYNTHETIC sample + Try again", status().startswith("Couldn't get the forecast") and sample() and pg.is_visible("#retryBtn"), status())
    # 5
    ctx.set_offline(True); mode["off"] = True; pg.click("#retryBtn"); idle()
    check("5 offline + Try again: offline line (EN)", status().startswith("You're offline") and "SYNTHETIC" in status(), status())
    check("5 offline: the SYNTHETIC sample is labelled and Try again stays", sample() and pg.is_visible("#retryBtn"))
    pg.click("button[data-lang=es]"); pg.wait_for_timeout(200)
    check("5 ES switch re-words the offline line", status().startswith("No tienes conexión") and "SINTÉTICO" in status(), status())
    check("5 ES line stays styled as an error", pg.evaluate("document.getElementById('status').classList.contains('error')"))
    pg.click("button[data-lang=en]"); pg.wait_for_timeout(200)
    check("5 EN switch back re-words it again", status().startswith("You're offline"), status())
    # 6
    ctx.set_offline(False); mode["off"] = False; mode["om"] = "ok"; pg.click("#retryBtn"); idle()
    check("6 back online + Try again: real plan, no warning, Try again hidden", not sample() and not pg.evaluate("document.getElementById('status').classList.contains('error')") and not pg.is_visible("#retryBtn"), status())
    check("no page errors", not errors, errors)
    b.close()
srv.terminate()
print(f"\n{passes[0]} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
