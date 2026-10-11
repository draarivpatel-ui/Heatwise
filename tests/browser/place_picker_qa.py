"""Chromium check of the HeatWise place picker at phone width (390 px), EN and ES.
A stubbed geocoding answer holds one 58-letter real place name and three same-looking Springfields:
  1. the picker lists 4 distinct labels (county added where the names collide);
  2. no sideways scroll at 390 px with the picker open, and every choice fits on screen;
  3. picking the long name loads its plan with no sideways scroll;
  4. the same in Spanish; no page errors.
Usage: python3 tests/browser/place_picker_qa.py  (CHROME_PATH=/usr/bin/chromium optional)"""
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
LONG = {"results": [
    {"name": "Springfield", "latitude": 37.2, "longitude": -93.29, "admin1": "Missouri", "admin2": "Greene", "country": "United States", "country_code": "US", "population": 169000},
    {"name": "Springfield", "latitude": 37.35, "longitude": -92.9, "admin1": "Missouri", "admin2": "Webster", "country": "United States", "country_code": "US", "population": 900},
    {"name": "Springfield", "latitude": 39.8, "longitude": -89.64, "admin1": "Illinois", "admin2": "Sangamon", "country": "United States", "country_code": "US", "population": 116000},
    {"name": "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch", "latitude": 53.22, "longitude": -4.2, "admin1": "Wales", "country": "United Kingdom", "country_code": "GB", "population": 3000}]}
with sync_playwright() as p:
    b = p.chromium.launch(**({"executable_path": os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {}), args=["--no-sandbox"])
    for lang in ("en", "es"):
        ctx = b.new_context(viewport={"width": 390, "height": 844}, locale="en-US")
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route(re.compile(r"^https://geocoding-api\.open-meteo\.com/"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LONG), headers=H))
        pg.route(re.compile(r"^https://api\.open-meteo\.com/"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(FC), headers=H))
        pg.route(re.compile(r"^https://api\.weather\.gov/"), lambda r: r.fulfill(status=500, body="down", headers=H))
        pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_timeout(300)
        if lang == "es": pg.click("button[data-lang=es]"); pg.wait_for_timeout(200)
        pg.fill("#place", "Springfield"); pg.press("#place", "Enter")
        pg.wait_for_selector("#placeResults:not([hidden]) button", timeout=10000)
        names = pg.locator("#placeResults button").all_inner_texts()
        check(f"{lang} 1 picker: 4 distinct labels, county added to the two Missouri Springfields", len(names) == 4 and len(set(names)) == 4 and "Springfield, Greene, Missouri, US" in names and "Springfield, Webster, Missouri, US" in names, names)
        sw = pg.evaluate("document.documentElement.scrollWidth")
        check(f"{lang} 2 picker open: no sideways scroll at 390 px", sw <= 390, sw)
        poke = pg.evaluate("[...document.querySelectorAll('#placeResults li, #placeResults button')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length")
        check(f"{lang} 2 picker open: every choice fits on screen", poke == 0, poke)
        pg.locator("#placeResults button", has_text="Llanfair").click()
        pg.wait_for_selector("#results:not([hidden])", timeout=10000); pg.wait_for_timeout(500)
        sw = pg.evaluate("document.documentElement.scrollWidth")
        check(f"{lang} 3 plan for the 58-letter place: no sideways scroll at 390 px", sw <= 390, sw)
        ctx.close()
    check("4 no page errors", not errors, errors)
    b.close()
srv.terminate()
print(f"\n{passes[0]} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
