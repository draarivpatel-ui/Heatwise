"""Print checks HeatWise was missing (Letter, 0.5in margins, real Chromium PDFs + pdftotext):
 1. Replay mode (Houston IAH, Aug 24, 2023): the coach sheet says it is a historical replay, not a forecast,
    in EN and ES, and stays 1 page per language (Both = 2), for football and roofing.
 2. The regular 'Print / save PDF' plan (printBtn, no coach-sheet mode; it carries the 48-hour table): <= 6 pages in EN and ES,
    for a forecast and for the replay; the replay printout carries the HISTORICAL REPLAY banner.
Usage: python3 print_plan_qa.py [ROOT]"""
import re, json, sys, os, subprocess, time, socket, math, tempfile
from playwright.sync_api import sync_playwright
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
GEO = {"results": [{"name": "Sugar Land", "latitude": 29.61968, "longitude": -95.63495, "admin1": "Texas", "country": "United States", "country_code": "US", "population": 118000}]}
OUT = os.path.join(tempfile.gettempdir(), "heatwise-print-qa"); os.makedirs(OUT, exist_ok=True)
MARG = {"top": "0.5in", "bottom": "0.5in", "left": "0.5in", "right": "0.5in"}
NOTE = {"en": "Historical replay of August 24, 2023 at IAH", "es": "Repetición histórica del 24 de agosto de 2023 en IAH"}
BANNER = {"en": "HISTORICAL REPLAY, not a forecast", "es": "REPETICIÓN HISTÓRICA, no es un pronóstico"}
passes, fails = [0], []
def check(m, c):
    print(("PASS " if c else "FAIL ") + m)
    if c: passes[0] += 1
    else: fails.append(m)
def pdf(pg, name):
    f = f"{OUT}/{name}.pdf"; pg.pdf(path=f, format="Letter", print_background=True, margin=MARG)
    n = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", f], capture_output=True, text=True).stdout).group(1))
    txt = subprocess.run(["pdftotext", "-layout", f, "-"], capture_output=True, text=True).stdout
    return n, re.sub(r"\s+", " ", txt)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(**({"executable_path": os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {}), args=["--no-sandbox"])
    pg = b.new_page(viewport={"width": 1280, "height": 900}, locale="en-US")
    pg.on("pageerror", lambda e: errors.append(str(e)))
    H = {"Access-Control-Allow-Origin": "*"}
    pg.route(re.compile(r"^https://geocoding-api\.open-meteo\.com/"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(GEO), headers=H))
    pg.route(re.compile(r"^https://api\.open-meteo\.com/"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(FORECAST), headers=H))
    pg.route(re.compile(r"^https://api\.weather\.gov/"), lambda r: r.fulfill(status=500, body="down", headers=H))
    pg.goto(f"http://127.0.0.1:{PORT}/"); pg.wait_for_timeout(400)
    pg.evaluate("window.print = () => {}")

    # --- 1. replay coach sheet ---
    pg.click("#replayBtn"); pg.wait_for_selector("#results:not([hidden])", timeout=8000); pg.wait_for_timeout(600)
    check("replay: screen banner visible", pg.is_visible("#replayBanner"))
    for preset in ["football", "roofing"]:
        pg.select_option("#preset", preset); pg.wait_for_timeout(250)
        for ui in ["en", "es"]:
            pg.click(f"button[data-lang={ui}]"); pg.wait_for_timeout(200)
            for sl, expect in [("en", 1), ("es", 1), ("both", 2)]:
                pg.select_option("#sheetLang", sl); pg.wait_for_timeout(150)
                pg.evaluate("document.body.classList.add('print-coach')"); pg.emulate_media(media="print")
                n, txt = pdf(pg, f"replay_coach_{preset}_{ui}_{sl}")
                pg.evaluate("document.body.classList.remove('print-coach')"); pg.emulate_media(media="screen")
                langs = ["en", "es"] if sl == "both" else [sl]
                check(f"replay coach {preset} ui={ui} sheet={sl}: {n} page(s), expected {expect}", n == expect)
                for L in langs:
                    check(f"replay coach {preset} ui={ui} sheet={sl}: says '{NOTE[L][:28]}…' ({L})", NOTE[L] in txt)
                check(f"replay coach {preset} ui={ui} sheet={sl}: shows the date/time of the record day, no 'forecast for' wording",
                      ("2023" in txt) and ("Forecast for" not in txt) and ("Pronóstico para" not in txt))

    # --- 2. regular printBtn plan: replay, then forecast ---
    for ui in ["en", "es"]:
        pg.click(f"button[data-lang={ui}]"); pg.wait_for_timeout(200)
        pg.click("#printBtn"); pg.emulate_media(media="print")
        n, txt = pdf(pg, f"replay_plan_{ui}")
        pg.emulate_media(media="screen")
        check(f"replay plan (Print button) ui={ui}: {n} page(s) <= 6", 1 <= n <= 6)
        check(f"replay plan (Print button) ui={ui}: HISTORICAL REPLAY banner printed", BANNER[ui] in txt)
    pg.click("button[data-lang=en]")
    pg.fill("#place", "Sugar Land, TX"); pg.press("#place", "Enter")
    pg.wait_for_function("!document.getElementById('replayBanner') || document.getElementById('replayBanner').hidden", timeout=8000)
    pg.wait_for_timeout(700)
    for ui in ["en", "es"]:
        pg.click(f"button[data-lang={ui}]"); pg.wait_for_timeout(200)
        pg.click("#printBtn"); pg.emulate_media(media="print")
        n, txt = pdf(pg, f"forecast_plan_{ui}")
        pg.emulate_media(media="screen")
        check(f"forecast plan (Print button) ui={ui}: {n} page(s) <= 6", 1 <= n <= 6)
        check(f"forecast plan (Print button) ui={ui}: no replay banner on a forecast", BANNER[ui] not in txt)
        hdr_pos = pg.evaluate("(()=>{matchMedia; return getComputedStyle(document.querySelector('#hourTable thead th')).position})()")
        pg.emulate_media(media="print")
        hdr_pos = pg.evaluate("getComputedStyle(document.querySelector('#hourTable thead th')).position")
        pg.emulate_media(media="screen")
        check(f"forecast plan ui={ui}: table header is not sticky in print (was overlapping rows on page 2+), got {hdr_pos}", hdr_pos == "static")
        raw = subprocess.run(["pdftotext", "-layout", f"{OUT}/forecast_plan_{ui}.pdf", "-"], capture_output=True, text=True).stdout
        H0 = {"en": "Time", "es": "Hora"}[ui]
        hl = [l for l in raw.splitlines() if l.strip().startswith(H0 + " ")]
        bad = [l for l in hl if re.search(r"\d+°F", l)]
        check(f"forecast plan ui={ui}: header row never printed on top of a data row ({len(hl)} header lines, {len(bad)} mixed)", hl and not bad)
    check("no page errors", not errors)
    b.close()
srv.terminate()
print(f"\n{passes[0]} passed, {len(fails)} failed"); [print(" -", f) for f in fails]
sys.exit(1 if fails else 0)
