"""Edge cases a strict judge tries, at 390 px in EN and ES: extreme numbers in the session and acclimatization boxes
(the box always shows the value the plan used), same start/finish hour, a 1-letter search, and switching language
mid-flow (every status line re-worded, typed values and the plan kept). Open-Meteo/NWS are mocked.
Usage: python3 tests/browser/edge_inputs_qa.py [BASE_URL]"""
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


def st(pg): return pg.evaluate("document.getElementById('status').textContent")
def S(pg, L, k): return pg.evaluate("async ([L,k]) => (await import('./js/i18n.js')).STRINGS[L][k]", [L, k])
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    for L in ("en", "es"):
        O = "en" if L == "es" else "es"
        def new():
            ctx = b.new_context(viewport={"width": 390, "height": 900}, locale="en-US"); pg = ctx.new_page(); mock(pg); fresh(pg, L); return ctx, pg
        # status lines follow a language switch
        for name, act, key in (("not found", lambda pg: search(pg, "zzzzqq"), "errGeo"), ("1-letter search", lambda pg: search(pg, "a"), "errGeo"),
                               ("location denied", lambda pg: (pg.click("#geoBtn"), pg.wait_for_timeout(800)), "errLocation"),
                               ("no place yet", lambda pg: pg.click("button.primary"), "needPlace")):
            ctx, pg = new(); act(pg)
            check(st(pg) == S(pg, L, key), f"[{L}] {name}: {key} shown ({st(pg)[:50]!r})")
            if name == "1-letter search": check(pg.evaluate("document.activeElement.id") == "place", f"[{L}] 1-letter search: focus back in the box")
            switch(pg, O)
            check(st(pg) == S(pg, O, key), f"[{L}->{O}] {name}: status re-worded on switch ({st(pg)[:50]!r})")
            ctx.close()
        # number boxes show what the plan used
        ctx, pg = new(); pg.click("#sampleBtn"); pg.wait_for_selector("#results:not([hidden])")
        for typed, shown in (("5000", "720"), ("5", "10"), ("", "120"), ("0", "10"), ("-40", "10"), ("95", "95"), ("abc", "120")):
            pg.fill("#acclUsual", typed) if typed != "abc" else pg.evaluate("document.getElementById('acclUsual').value=''")
            pg.dispatch_event("#acclUsual", "input"); pg.dispatch_event("#acclUsual", "change"); pg.wait_for_timeout(120)
            day5 = pg.inner_text("#acclList").strip().splitlines()[-1]
            check(pg.input_value("#acclUsual") == shown and f"→ {shown} " in day5, f"[{L}] acclimatization {typed!r}: box {pg.input_value('#acclUsual')!r}, day 5 {day5!r}")
        for typed, shown, hours in (("0", "1", 1), ("99", "12", 12), ("2.5", "3", 3), ("-3", "1", 1), ("", "1", 1)):
            pg.fill("#duration", typed); pg.dispatch_event("#duration", "change"); pg.wait_for_timeout(250)
            win = pg.inner_text("#bestTime")
            check(pg.input_value("#duration") == shown, f"[{L}] session length {typed!r}: box shows {pg.input_value('#duration')!r} (want {shown})")
            check(win.strip() != "" , f"[{L}] session length {typed!r}: a best window or 'none' line is shown ({win[:40]!r})")
        pg.fill("#duration", "2"); pg.dispatch_event("#duration", "change")
        pg.select_option("#earliest", "10"); pg.select_option("#latest", "10"); pg.dispatch_event("#latest", "change"); pg.wait_for_timeout(250)
        check(S(pg, L, "hoursInvalid") in pg.inner_text("#bestAdvice"), f"[{L}] same start and finish hour explained")
        # switch mid-flow: typed values and the plan stay
        pg.select_option("#earliest", "6"); pg.select_option("#latest", "20"); pg.fill("#duration", "3"); pg.dispatch_event("#duration", "change")
        pg.fill("#acclUsual", "60"); pg.dispatch_event("#acclUsual", "change"); pg.wait_for_timeout(250)
        before = (pg.inner_text("#bestTime"), pg.input_value("#duration"), pg.input_value("#acclUsual"), pg.input_value("#earliest"), pg.input_value("#latest"))
        switch(pg, O)
        after = (pg.inner_text("#bestTime"), pg.input_value("#duration"), pg.input_value("#acclUsual"), pg.input_value("#earliest"), pg.input_value("#latest"))
        check(before[1:] == after[1:] and pg.is_visible("#results"), f"[{L}->{O}] switch keeps typed values and the plan {before[1:]} -> {after[1:]}")
        digits = lambda s: re.findall(r"\d+", s)
        check(digits(before[0]) == digits(after[0]), f"[{L}->{O}] same best window after switch ({before[0]!r} / {after[0]!r})")
        ctx.close()
    b.close()
if srv: srv.terminate()
print(f"\n{passes[0]} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
