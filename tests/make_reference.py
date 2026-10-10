"""Generate reference WBGT values with the open-source pywbgt package (Liljegren C code).
Run: pip install pywbgt && python3 tests/make_reference.py
Writes tests/fixtures/liljegren_reference.json, which tests/heat.test.mjs compares against."""
import json, random
import numpy as np
import pandas as pd
from metpy.units import units
from metpy.calc import dewpoint_from_relative_humidity
from pywbgt import liljegren as L
from pywbgt import liljegrenWBGT

random.seed(42)
out = {"components": [], "full": []}

# 1) Component check: globe + natural wet bulb for given solar/fdir/cza/speed (no sun-position code).
for _ in range(200):
    t = random.uniform(15, 42); rh = random.uniform(15, 98)
    p = random.uniform(980, 1030); spd = random.uniform(0.5, 8)
    cza = random.uniform(0.05, 1.0); solar = random.uniform(0, 1000) * cza
    fdir = random.uniform(0, 0.9)
    td = dewpoint_from_relative_humidity(units.Quantity(t, "degC"), units.Quantity(rh, "percent")).magnitude
    a = lambda v: np.array([v], dtype=np.float64)
    tg = float(L.globe_temperature(a(t), a(td), a(p), a(spd), a(solar), a(fdir), a(cza))[0])
    tnwb = float(L.natural_wetbulb(a(t), a(td), a(p), a(spd), a(solar), a(fdir), a(cza))[0])
    if np.isnan(tg) or np.isnan(tnwb):
        continue
    out["components"].append(dict(tempC=t, rh=rh, pressure=p, speed=spd, solar=solar, fdir=fdir, cza=cza, tg=tg, tnwb=tnwb))

# 2) End-to-end daytime check incl. sun position, solar adjustment and 10 m -> 2 m wind.
places = [(29.62, -95.63), (33.45, -112.07), (40.71, -74.0), (25.76, -80.19)]
for _ in range(120):
    lat, lon = random.choice(places)
    day = pd.Timestamp("2026-06-01T00:00Z") + pd.Timedelta(days=random.randint(0, 120))
    utc = day + pd.Timedelta(hours=random.randint(14, 22), minutes=random.choice([0, 30]))
    t = random.uniform(22, 42); rh = random.uniform(20, 95)
    p = random.uniform(990, 1025); wind10 = random.uniform(0, 9); solar = random.uniform(50, 1000)
    td = dewpoint_from_relative_humidity(units.Quantity(t, "degC"), units.Quantity(rh, "percent")).magnitude
    res = liljegrenWBGT(
        pd.DatetimeIndex([utc.tz_convert(None)]), np.array([lat]), np.array([lon]),
        units.Quantity(np.array([solar]), "W/m**2"), units.Quantity(np.array([p]), "hPa"),
        units.Quantity(np.array([t]), "degC"), units.Quantity(np.array([td]), "degC"),
        units.Quantity(np.array([wind10]), "m/s"),
    )
    w = float(res["Twbg"].magnitude[0])
    if np.isnan(w):
        continue
    out["full"].append(dict(utcMs=int(utc.value // 10**6), lat=lat, lon=lon, tempC=t, rh=rh, pressure=p,
                            wind10=wind10, solar=solar, wbgt=w, speed2m=float(res["speed"].magnitude[0])))

# 3) Sun position check against NREL SPA (pvlib).
import pvlib
out["sun"] = []
for _ in range(150):
    lat = random.uniform(-60, 60); lon = random.uniform(-180, 180)
    utc = pd.Timestamp("2026-01-01T00:00Z") + pd.Timedelta(minutes=random.randint(0, 365 * 24 * 60))
    sp = pvlib.solarposition.get_solarposition(pd.DatetimeIndex([utc]), lat, lon, method="nrel_numpy")
    cza = float(np.cos(np.radians(sp["zenith"].iloc[0])))
    out["sun"].append(dict(utcMs=int(utc.value // 10**6), lat=lat, lon=lon, cza=cza))

def rnd(o):
    if isinstance(o, float): return round(o, 5)
    if isinstance(o, dict): return {k: rnd(v) for k, v in o.items()}
    if isinstance(o, list): return [rnd(v) for v in o]
    return o
json.dump(rnd(out), open("tests/fixtures/liljegren_reference.json", "w"), separators=(",", ":"))
print(len(out["components"]), "component cases,", len(out["full"]), "end-to-end cases,", len(out["sun"]), "sun cases")
