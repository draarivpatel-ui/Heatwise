import asyncio, os, sys, json
from urllib.parse import urlparse, unquote
from playwright.async_api import async_playwright
_pu=urlparse(os.environ.get('HTTPS_PROXY') or '')
PX={'server': f'http://{_pu.hostname}:{_pu.port}', 'username': unquote(_pu.username or ''), 'password': unquote(_pu.password or '')} if _pu.hostname else None
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'],**({'proxy':PX} if PX else {}))
        ctx=await b.new_context(viewport={'width':1280,'height':720},device_scale_factor=1,locale='en-US')
        pg=await ctx.new_page()
        reqs=[]
        pg.on('response', lambda r: reqs.append((r.status, r.url[:120])) if 'aariv.me' not in r.url else None)
        pg.on('console', lambda m: print('CONSOLE', m.text[:200]))
        url=sys.argv[1]
        await pg.goto(url, wait_until='domcontentloaded'); await asyncio.sleep(12)
        print(await pg.evaluate("document.getElementById('status').textContent"))
        print(await pg.evaluate("document.getElementById('forecastSource').textContent+' | '+document.getElementById('nowRisk').innerText+' | '+document.getElementById('bestTime').innerText"))
        for r in reqs: print(r)
        await pg.screenshot(path=sys.argv[2], full_page=True)
        h=await pg.evaluate("document.body.scrollHeight"); print('height',h)
        await b.close()
asyncio.run(main())
