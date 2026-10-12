"""Coach sheet print-fit check: Letter PDF page counts per scenario. Usage: python3 coach_print_qa.py"""
import re, json, sys, os, subprocess, time, socket, math, tempfile
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
now = int(time.time() // 3600 * 3600); start = now - 6 * 3600
times, temp, rh, rad = [], [], [], []
for i in range(72):
    t = start + i * 3600; hr = ((t // 3600) - 5) % 24; ph = math.cos((hr - 15) / 24 * 2 * math.pi)
    times.append(t); temp.append(round(29 + 5.5 * ph, 1)); rh.append(round(63 - 20 * ph))
    rad.append(round(880 * max(0.0, math.sin((hr - 7) / 12.5 * math.pi))) if 7 <= hr <= 19 else 0)
FORECAST = {"latitude": 29.62, "longitude": -95.63, "utc_offset_seconds": -18000, "timezone": "America/Chicago", "timezone_abbreviation": "CDT",
      "hourly": {"time": times, "temperature_2m": temp, "relative_humidity_2m": rh, "shortwave_radiation": rad,
                 "direct_radiation": [r * 0.8 for r in rad], "diffuse_radiation": [r * 0.2 for r in rad],
                 "wind_speed_10m": [8] * 72, "surface_pressure": [1012] * 72, "cloud_cover": [10] * 72, "is_day": [1] * 72}}
GEO = {"results": [{"name": "Sugar Land", "latitude": 29.61968, "longitude": -95.63495, "admin1": "Texas", "country": "United States", "country_code": "US"}]}
OUT = os.path.join(tempfile.gettempdir(), "heatwise-print-qa"); os.makedirs(OUT, exist_ok=True)

def pages(path):
    return int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", path], capture_output=True, text=True).stdout).group(1))

fails = []
with sync_playwright() as p:
    b = p.chromium.launch(**({"executable_path": os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {}), args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="en-US")
    pg = ctx.new_page()
    hdr = {"Access-Control-Allow-Origin": "*"}
    pg.route(re.compile(r"^https://geocoding-api\.open-meteo\.com/"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(GEO), headers=hdr))
    pg.route(re.compile(r"^https://api\.open-meteo\.com/"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(FORECAST), headers=hdr))
    pg.route(re.compile(r"^https://api\.weather\.gov/"), lambda r: r.fulfill(status=500, body="down", headers=hdr))
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_timeout(400)
    pg.fill("#place", "Sugar Land, TX"); pg.press("#place", "Enter")
    pg.wait_for_selector("#results:not([hidden])", timeout=8000); pg.wait_for_timeout(600)
    days = pg.eval_on_selector_all("#planDay option", "els=>els.map(e=>[e.value,e.textContent])")
    print("days", days)
    # football / roofing with their own hours, then midnight-to-midnight (earliest 0, latest 24: all 24 rows on the sheet)
    for preset, allday in [("football", False), ("roofing", False), ("football", True), ("roofing", True), ("football", "hot")]:
        if allday == "hot":  # worst case for length: a hot day, so the sheet lists every flag level + 24 hour cells
            for i, t in enumerate(times):
                hr = ((t // 3600) - 5) % 24; ph = math.cos((hr - 15) / 24 * 2 * math.pi)
                temp[i] = round(33 + 6 * ph, 1); rh[i] = round(62 - 18 * ph)
            pg.evaluate("localStorage.clear()"); pg.fill("#place", "Sugar Land, TX"); pg.press("#place", "Enter"); pg.wait_for_timeout(1500)
        pg.select_option("#preset", preset); pg.wait_for_timeout(300)
        if allday:
            pg.select_option("#earliest", "0"); pg.select_option("#latest", "24"); pg.wait_for_timeout(300)
            rows = pg.evaluate("document.querySelectorAll('#coachSheet tr, #coachSheet li').length")
            print("midnight-midnight rows on sheet", rows)
        for lang_ui in ["en", "es"]:
            pg.click(f"button[data-lang={lang_ui}]"); pg.wait_for_timeout(200)
            for d, _ in days:
                for sl, expect in [("en", 1), ("es", 1), ("both", 2)]:
                    pg.select_option("#planDay", d); pg.select_option("#sheetLang", sl); pg.wait_for_timeout(150)
                    pg.evaluate("document.body.classList.add('print-coach')")
                    pg.emulate_media(media="print")
                    f = f"{OUT}/{preset}{'_24h' if allday is True else ('_24h_hot' if allday else '')}_{lang_ui}_{d}_{sl}.pdf"
                    pg.pdf(path=f, format="Letter", print_background=True,
                           margin={"top": "0.5in", "bottom": "0.5in", "left": "0.5in", "right": "0.5in"})
                    n = pages(f)
                    ok = n == expect
                    print("OK  " if ok else "FAIL", preset + (" 0-24h" if allday is True else (" 0-24h hot" if allday else "")), lang_ui, d, sl, "pages", n, "expected", expect)
                    if not ok: fails.append((preset + (" 0-24h" if allday is True else (" 0-24h hot" if allday else "")), lang_ui, d, sl, n))
                    pg.evaluate("document.body.classList.remove('print-coach')"); pg.emulate_media(media="screen")
    b.close()
srv.terminate()
print("FAILS", len(fails), fails)
sys.exit(1 if fails else 0)
