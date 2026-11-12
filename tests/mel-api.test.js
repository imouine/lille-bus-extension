import test from "node:test";
import assert from "node:assert/strict";

import { buildWfsUrl, extractRecords } from "../src/lib/mel-api.js";

test("WFS URL uses the public GeoServer endpoint", () => {
  const url = new URL(buildWfsUrl("prochains_passages", {
    count: 50,
    cqlFilter: "code_ligne='L1'",
  }));
  assert.equal(url.pathname, "/geoserver/dsp_ilevia/ows");
  assert.equal(url.searchParams.get("typeNames"), "dsp_ilevia:prochains_passages");
  assert.equal(url.searchParams.get("count"), "50");
  assert.equal(url.searchParams.get("CQL_FILTER"), "code_ligne='L1'");
});

test("GeoJSON feature properties are normalized to records", () => {
  assert.deepEqual(extractRecords({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { code_ligne: "L1" } }],
  }), [{ code_ligne: "L1" }]);
});

test("legacy records remain supported", () => {
  const records = [{ code_ligne: "L2" }];
  assert.equal(extractRecords({ records }), records);
});
