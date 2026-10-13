"""axe-core baseline guard for HeatWise (added Oct 12, 2026 after an accessibility audit; tests only, no app change).
Runs axe-core 4.14.0 with the WCAG 2.0/2.1/2.2 A+AA and best-practice tags on the main views at 360 and 1280 px.
The 2.2 tag also switches on `target-size` (WCAG 2.5.8), which axe leaves off by default and the other axe suites
here do not run. It fails only on a NEW serious or critical violation: a (rule, element) pair not listed in BASELINE.
Moderate/minor results are printed, not failed (tests/browser/axe_states_qa.py already requires 0 violations of every impact
for the WCAG 2.1 rule set).
Run: python3 tests/browser/axe_baseline_qa.py   (serves this repo on 127.0.0.1; optional CHROME_PATH, AXE_JS)"""
import os, sys, json, pathlib, socket, subprocess, time, urllib.request, re
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
# Serious/critical violations accepted at the Oct 12, 2026 audit: (rule id, regex on the axe target, why). The audit found none.
BASELINE = []

# ---- shared core (same in all four repos) ----
TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
AXE_VERSION = '4.14.0'
PATHS = [os.environ.get('AXE_JS', ''), str(ROOT / 'node_modules/axe-core/axe.min.js')]
AXE = next((open(p).read() for p in PATHS if p and os.path.exists(p)), None) or \
    urllib.request.urlopen(f'https://cdn.jsdelivr.net/npm/axe-core@{AXE_VERSION}/axe.min.js', timeout=30).read().decode()
passed = failed = 0
def check(name, cond, info=''):
    global passed, failed
    if cond: passed += 1; print('  ok   ' + name)
    else: failed += 1; print('  FAIL ' + name + ('  -> ' + str(info) if info else ''))
def known(rule, target):
    return any(rule == r and re.search(pat, target) for r, pat, _why in BASELINE)
def axe_new_serious(pg, tag):
    if not pg.evaluate('!!window.axe'): pg.add_script_tag(content=AXE)
    res = pg.evaluate("""async(tags)=>{const r=await axe.run(document,{runOnly:{type:'tag',values:tags},resultTypes:['violations']});
      return {v:axe.version,list:r.violations.flatMap(x=>x.nodes.map(n=>({id:x.id,impact:n.impact||x.impact,t:n.target.join(' ')})))}}""", TAGS)
    new = [x for x in res['list'] if x['impact'] in ('serious', 'critical') and not known(x['id'], x['t'])]
    other = sorted({f"{x['id']}({x['impact']})" for x in res['list'] if x not in new})
    if other: print(f'  info [{tag}] baseline/lower-impact, not failed: {other}')
    check(f'[{tag}] axe {res["v"]} WCAG 2.2 AA + best-practice: no new serious/critical violation', not new,
          [f"{x['id']}({x['impact']}) {x['t']}" for x in new][:6])
s = socket.socket(); s.bind(('127.0.0.1', 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{PORT}/'
H = {'Access-Control-Allow-Origin': '*'}
GEO_TWO = {'results': [
    {'name': 'Pasadena', 'latitude': 29.69, 'longitude': -95.21, 'admin1': 'Texas', 'country': 'United States', 'country_code': 'US', 'population': 151000},
    {'name': 'Pasadena', 'latitude': 34.15, 'longitude': -118.14, 'admin1': 'California', 'country': 'United States', 'country_code': 'US', 'population': 138000}]}
def mock(pg):  # no live weather calls: geocoding answered here, forecasts refused (the views below don't need them)
    pg.route(re.compile(r'^https://geocoding-api\.open-meteo\.com/'), lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(GEO_TWO), headers=H))
    pg.route(re.compile(r'^https://(api\.open-meteo\.com|api\.weather\.gov)/'), lambda r: r.fulfill(status=500, body='down', headers=H))
def w(pg, ms=300): pg.wait_for_timeout(ms)
def details(pg): pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
VIEWS = [
    ('landing', lambda pg: None),
    ('sample plan, details open', lambda pg: (pg.click('#sampleBtn'), pg.wait_for_selector('#results:not([hidden])', timeout=8000), details(pg))),
    ('place picker', lambda pg: (pg.fill('#place', 'Pasadena'), pg.click('#searchBtn'), w(pg, 900))),
    ('record-day replay', lambda pg: (pg.click('#replayBtn'), pg.wait_for_selector('#replayBanner:not([hidden])', timeout=10000), w(pg), details(pg))),
]
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROME_PATH') or None)
        for vw in (360, 1280):
            for name, fn in VIEWS:
                tag = f'{vw} {name}'
                ctx = b.new_context(viewport={'width': vw, 'height': 800}, locale='en-US'); pg = ctx.new_page(); mock(pg)
                pg.goto(BASE); pg.evaluate('localStorage.clear(); sessionStorage.clear()'); pg.goto(BASE); w(pg)
                try: fn(pg)
                except Exception as e: check(f'[{tag}] view reached', False, str(e)[:160]); ctx.close(); continue
                axe_new_serious(pg, tag); ctx.close()
        b.close()
finally:
    srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
