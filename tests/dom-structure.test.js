import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function declaredElementIds(scriptPath) {
  const source = readFileSync(scriptPath, "utf8");
  const block = source.match(/const elements = Object\.fromEntries\(\[([\s\S]*?)\]\.map/);
  assert.ok(block, `elements declaration missing in ${scriptPath}`);
  return [...block[1].matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((match) => match[1]);
}

for (const page of ["popup", "options"]) {
  test(`${page} script only references element IDs present in its HTML`, () => {
    const root = new URL(`../src/${page}/`, import.meta.url);
    const html = readFileSync(new URL(`${page}.html`, root), "utf8");
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const missing = declaredElementIds(new URL(`${page}.js`, root)).filter((id) => !ids.has(id));
    assert.deepEqual(missing, []);
  });
}
