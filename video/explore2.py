import asyncio, os, sys, json
from urllib.parse import urlparse, unquote
from playwright.async_api import async_playwright
_pu=urlparse(os.environ.get('HTTPS_PROXY') or '')
PX={'server': f'http://{_pu.hostname}:{_pu.port}', 'username': unquote(_pu.username or ''), 'password': unquote(_pu.password or '')} if _pu.hostname else None
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'],**({'proxy':PX} if PX else {}))
        ctx=await b.new_context(viewport={'width':1280,'height':720},locale='en-US')
        pg=await ctx.new_page(); reqs=[]
        pg.on('response', lambda r: reqs.append((r.status, r.url[:140])) if 'aariv.me' not in r.url else None)
        pg.on('requestfailed', lambda r: reqs.append(('FAIL', r.url[:140], r.failure)))
        await pg.goto('https://aariv.me/Heatwise/', wait_until='domcontentloaded'); await asyncio.sleep(3)
        await pg.fill('#place','Sugar Land'); await pg.click('#searchBtn'); await asyncio.sleep(5)
        print('results', await pg.evaluate("document.getElementById('placeResults').innerText"))
        if await pg.locator('#placeResults li').count(): await pg.locator('#placeResults li button, #placeResults li').first.click()
        await asyncio.sleep(2)
        print('label', await pg.evaluate("document.getElementById('placeLabel').textContent"))
        await pg.click('button.primary'); await asyncio.sleep(15)
        print('status', await pg.evaluate("document.getElementById('status').textContent"))
        print(await pg.evaluate("document.getElementById('forecastSource').textContent+' | '+document.getElementById('nowRisk').innerText+' | '+document.getElementById('bestTime').innerText+' | '+document.getElementById('forecastMeta').textContent"))
        print('url', pg.url)
        for r in reqs: print(r)
        await pg.screenshot(path='shots/live_full.png', full_page=True)
        await b.close()
asyncio.run(main())
