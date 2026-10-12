"""axe-core sweep of every HeatWise state at 390 and 1280 px, EN and ES, plus a mid-flow language switch.
States: landing, UIL guideline, sample plan (all <details> open), searched forecast plan, place picker,
not found, forecast down (Retry), location denied, historical replay. Open-Meteo/NWS are mocked.
Usage: python3 tests/browser/axe_states_qa.py [BASE_URL]   (default: serves this repo on 127.0.0.1)"""
import re, json, subprocess, time, math, socket, sys, os, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AXE_PATHS = [os.environ.get("AXE_JS", ""), os.path.join(ROOT, "node_modules/axe-core/axe.min.js"),
             "/workspace/work/hackathons/eurekadev_qa/node_modules/axe-core/axe.min.js"]
AXE = next((open(p).read() for p in AXE_PATHS if p and os.path.exists(p)), None)
if AXE is None:
    AXE = urllib.request.urlopen("https://cdn.jsdelivr.net/npm/axe-core@4.14.0/axe.min.js", timeout=30).read().decode()
BASE = sys.argv[1] if len(sys.argv) > 1 else None
srv = None
if not BASE:
    s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1); BASE = f"http://127.0.0.1:{PORT}/"
now = int(time.time() // 3600 * 3600); start = now - 6 * 3600
times, temp, rh, rad = [], [], [], []
for i in range(72):
    t = start + i * 3600; hr = ((t // 3600) - 5) % 24; ph = math.cos((hr - 15) / 24 * 2 * math.pi)
    times.append(t); temp.append(round(31 + 5.5 * ph, 1)); rh.append(round(60 - 20 * ph))
    rad.append(round(880 * max(0.0, math.sin((hr - 7) / 12.5 * math.pi))) if 7 <= hr <= 19 else 0)
FC = {"latitude": 29.62, "longitude": -95.63, "utc_offset_seconds": -18000, "timezone": "America/Chicago", "timezone_abbreviation": "CDT",
      "hourly": {"time": times, "temperature_2m": temp, "relative_humidity_2m": rh, "shortwave_radiation": rad,
                 "direct_radiation": [r * 0.8 for r in rad], "diffuse_radiation": [r * 0.2 for r in rad],
                 "wind_speed_10m": [8] * 72, "surface_pressure": [1012] * 72, "cloud_cover": [10] * 72, "is_day": [1] * 72}}
GEO_ONE = {"results": [{"name": "Sugar Land", "latitude": 29.61968, "longitude": -95.63495, "admin1": "Texas", "country": "United States", "country_code": "US", "population": 118000}]}
GEO_TWO = {"results": [
    {"name": "Pasadena", "latitude": 29.69, "longitude": -95.21, "admin1": "Texas", "country": "United States", "country_code": "US", "population": 151000},
    {"name": "Pasadena", "latitude": 34.15, "longitude": -118.14, "admin1": "California", "country": "United States", "country_code": "US", "population": 138000}]}
H = {"Access-Control-Allow-Origin": "*"}
mode = {"om": "ok"}
fails, passes = [], [0]
def check(cond, m):
    print(("PASS " if cond else "FAIL ") + m)
    if cond: passes[0] += 1
    else: fails.append(m)
def mock(pg):
    def geo(r):
        u = r.request.url
        body = {"generationtime_ms": 0.1} if "zzzz" in u else (GEO_TWO if "Pasadena" in u else GEO_ONE)
        r.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=H)
    pg.route(re.compile(r"^https://geocoding-api\.open-meteo\.com/"), geo)
    def fc(r):
        if mode["om"] == "down": return r.fulfill(status=500, body="down", headers=H)
        r.fulfill(status=200, content_type="application/json", body=json.dumps(FC), headers=H)
    pg.route(re.compile(r"^https://api\.open-meteo\.com/"), fc)
    pg.route(re.compile(r"^https://api\.weather\.gov/"), lambda r: r.fulfill(status=500, body="down", headers=H))
    if not BASE.startswith("http://127.0.0.1"):
        def live_site(r):
            resp = urllib.request.urlopen(urllib.request.Request(r.request.url, headers={"User-Agent": "Mozilla/5.0"}), timeout=25)
            r.fulfill(status=resp.status, body=resp.read(), headers={"Content-Type": resp.headers.get("Content-Type", "text/html")})
        pg.route(re.compile(r"^https://aariv\.me/"), live_site)
def axe(pg, tag):
    if not pg.evaluate("!!window.axe"): pg.add_script_tag(content=AXE)
    v = pg.evaluate("""async()=>{const r=await axe.run(document,{resultTypes:['violations']});
      return r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes.slice(0,2).map(n=>n.target.join(' ')).join(' | '))}""")
    check(not v, f"[{tag}] axe 0 violations {v}")
def overflow(pg, tag):
    w = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(w <= 0, f"[{tag}] no sideways scroll ({w}px)")
def open_details(pg): pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
def switch(pg, L): pg.click(f"button[data-lang={L}]"); pg.wait_for_timeout(250)

def fresh(pg, L):
    pg.goto(BASE); pg.evaluate("localStorage.clear(); sessionStorage.clear()"); pg.goto(BASE); pg.wait_for_timeout(300)
    if L == "es": switch(pg, "es")
    mode["om"] = "ok"
def search(pg, q):
    pg.fill("#place", q); pg.click("#searchBtn"); pg.wait_for_timeout(900)

STATES = []
def state(fn): STATES.append(fn); return fn
@state
def landing(pg): pass
@state
def uil(pg): pg.select_option("#guideline", index=pg.evaluate("[...document.querySelectorAll('#guideline option')].findIndex(o=>/uil/i.test(o.value))"))
@state
def sample(pg): pg.click("#sampleBtn"); pg.wait_for_selector("#results:not([hidden])", timeout=8000); open_details(pg)
@state
def forecast_plan(pg): search(pg, "Sugar Land, TX"); pg.click("button.primary"); pg.wait_for_selector("#results:not([hidden])", timeout=8000); open_details(pg)
@state
def picker(pg): search(pg, "Pasadena")
@state
def not_found(pg): search(pg, "zzzzqq")
@state
def forecast_down(pg): mode["om"] = "down"; search(pg, "Sugar Land, TX"); pg.click("button.primary"); pg.wait_for_timeout(1500)
@state
def geo_denied(pg): pg.click("#geoBtn"); pg.wait_for_timeout(800)
@state
def replay(pg): pg.click("#replayBtn"); pg.wait_for_selector("#replayBanner:not([hidden])", timeout=10000); pg.wait_for_timeout(300); open_details(pg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    for vw in (390, 1280):
        for L in ("en", "es"):
            for fn in STATES:
                tag = f"{vw}-{L} {fn.__name__}"
                ctx = b.new_context(viewport={"width": vw, "height": 900}, locale="en-US")  # no geolocation grant -> denied
                pg = ctx.new_page(); mock(pg); errs = []
                pg.on("pageerror", lambda e: errs.append(str(e)))
                fresh(pg, L)
                try: fn(pg)
                except Exception as e: check(False, f"[{tag}] state reached ({str(e)[:120]})"); ctx.close(); continue
                axe(pg, tag); overflow(pg, tag)
                other = "en" if L == "es" else "es"
                switch(pg, other); open_details(pg)  # mid-flow language switch: still clean, page lang follows
                axe(pg, tag + f" ->{other}")
                check(pg.evaluate("document.documentElement.lang") == other, f"[{tag}] <html lang> follows switch to {other}")
                check(not errs, f"[{tag}] no page errors {errs[:2]}")
                ctx.close()
    b.close()
if srv: srv.terminate()
print(f"\n{passes[0]} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
