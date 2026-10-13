// Run with: node tests/docs.test.mjs  (docs hygiene: README links/paths resolve; every data file is named)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok -", name); };
const exists = (p) => fs.existsSync(path.join(root, p.replace(/[#?].*$/, "").replace(/\/$/, "")));

t("relative markdown links resolve", () => {
  const bad = [];
  for (const m of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    const u = m[1]; if (/^(https?:|mailto:|#)/.test(u)) continue;
    if (!exists(u)) bad.push(u);
  }
  assert.deepEqual(bad, []);
});
t("backticked repo paths exist", () => {
  const bad = [];
  for (const m of readme.matchAll(/`((?:js|data|scripts|tests|docs|fonts)\/[A-Za-z0-9_./-]+)`/g)) {
    if (m[1].includes("{") || m[1].includes("*")) continue;
    if (!exists(m[1])) bad.push(m[1]);
  }
  assert.deepEqual(bad, []);
});
t("every file in data/validation is named in README", () => {
  const dir = path.join(root, "data/validation");
  const missing = fs.readdirSync(dir).filter((f) => !readme.includes(f) && !readme.includes("data/validation/"));
  assert.deepEqual(missing, []);
  assert.ok(/## Data sources/.test(readme));
});
t("README Data sources names each data source's origin", () => {
  const s = readme.split("## Data sources")[1].split("\n## ")[0];
  for (const k of ["api.weather.gov", "Open-Meteo", "Iowa Environmental Mesonet", "data/validation/"]) assert.ok(s.includes(k), k);
});
console.log(`${n} docs checks passed`);
