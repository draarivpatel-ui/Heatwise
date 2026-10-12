"""Shared-link table test: every ?param a link can carry, with real values and hostile ones (Object.prototype names such as
?lang=constructor, out-of-range numbers, bad dates). The page must never throw, never leave a menu blank, and fall back to the
default for anything it doesn't know; valid links must apply exactly. Weather APIs are mocked (500) so only readUrl() runs.
Usage: python3 tests/browser/url_params_qa.py [BASE_URL]"""
import re, json, subprocess, time, socket, sys, os, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = sys.argv[1] if len(sys.argv) > 1 else None
srv = None
if not BASE:
    s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1); BASE = f"http://127.0.0.1:{PORT}/"
H = {"Access-Control-Allow-Origin": "*"}
D = {"lang": "en", "preset": "football", "guideline": "uil", "uilClass": "3", "workload": "veryHeavy", "clothing": "work", "duration": "2", "earliest": "6", "latest": "21"}
# query -> fields that must differ from the defaults D (everything else must equal D)
TABLE = [
    ("lang=es", {"lang": "es"}),
    ("lang=fr", {}), ("lang=constructor", {}), ("lang=toString", {}), ("lang=__proto__", {}), ("lang=", {}),
    ("preset=roofing", {"preset": "roofing", "guideline": "osha", "workload": "heavy", "duration": "4"}),
    ("preset=constructor", {}), ("preset=__proto__", {}), ("preset=hasOwnProperty", {}),
    ("wl=toString", {}), ("wl=__proto__", {}), ("cl=hasOwnProperty", {}), ("cl=valueOf", {}),
    ("g=osha&wl=light&cl=double", {"preset": "custom", "guideline": "osha", "workload": "light", "clothing": "double"}),
    ("g=nope&uc=4", {}), ("uc=2", {"uilClass": "2"}),
    ("dur=00", {}), ("dur=99", {}), ("dur=-1", {}), ("dur=3", {"preset": "custom", "duration": "3"}),
    ("e=24", {}), ("e=5", {"earliest": "5"}), ("l=0", {}), ("l=24", {"latest": "24"}),
    ("pd=2026-13-45", {}), ("pd=<script>", {}), ("sl=constructor", {}),
    ("lat=999&lon=999", {}), ("lat=abc&lon=1", {}),
    ("lang=es&preset=toString&wl=constructor&cl=__proto__", {"lang": "es"}),
]
fails, passes = [], [0]
def check(cond, m):
    print(("PASS " if cond else "FAIL ") + m)
    if cond: passes[0] += 1
    else: fails.append(m)
READ = """()=>{const v=id=>document.getElementById(id).value;return {lang:document.documentElement.lang,preset:v('preset'),guideline:v('guideline'),
  uilClass:v('uilClass'),workload:v('workload'),clothing:v('clothing'),duration:v('duration'),earliest:v('earliest'),latest:v('latest'),
  blank:[...document.querySelectorAll('select')].filter(s=>!s.hidden&&s.offsetParent!==null&&s.value==='').map(s=>s.id),
  btn:(document.querySelector('#form button[type=submit], button[type=submit]')||{}).textContent||''}}"""
with sync_playwright() as p:
    b = p.chromium.launch(**({"executable_path": os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {}), args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, locale="en-US")
    for pat in [r"^https://geocoding-api\.open-meteo\.com/", r"^https://api\.open-meteo\.com/", r"^https://api\.weather\.gov/"]:
        ctx.route(re.compile(pat), lambda r: r.fulfill(status=500, body="down", headers=H))
    if not BASE.startswith("http://127.0.0.1"):
        def live_site(r):
            resp = urllib.request.urlopen(urllib.request.Request(r.request.url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"}), timeout=25)
            r.fulfill(status=resp.status, body=resp.read(), headers={"Content-Type": resp.headers.get("Content-Type", "text/html")})
        ctx.route(re.compile(r"^https://aariv\.me/"), live_site)
    for q, diff in TABLE:
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:100]))
        pg.goto(BASE + "?" + q); pg.wait_for_timeout(700)
        got = pg.evaluate(READ)
        want = {**D, **diff}
        bad = {k: got[k] for k in want if got[k] != want[k]}
        check(not errs, f"?{q}: no script error {errs}")
        check(not bad, f"?{q}: menus {'as expected' if not bad else 'WRONG ' + json.dumps(bad)}")
        check(not got["blank"] and got["btn"].strip(), f"?{q}: no blank menu {got['blank']}, button labelled")
        pg.close()
    b.close()
if srv: srv.terminate()
print(f"{passes[0]} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
