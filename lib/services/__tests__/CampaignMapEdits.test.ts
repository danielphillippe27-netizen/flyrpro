import test from "node:test";
import assert from "node:assert/strict";
import { applyMapEditChanges, validateMapEditChanges } from "../CampaignMapEdits";

const square = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
test("building removal preserves independent address corrections and undo restores the previous overlay", () => {
  const original = { revision: 4, features: { "address:home": { parcelLinkSet: true, parcelId: "lot" } } };
  const changes = validateMapEditChanges([
    { kind: "building", id: "Roof", value: { hidden: true } },
    { kind: "address", id: "home", value: { parcelLinkSet: true, parcelId: "lot", buildingLinkSet: true } },
  ]);
  const removed = applyMapEditChanges(original, changes);
  assert.equal(removed.features["building:roof"].hidden, true);
  assert.equal(removed.features["address:home"].parcelId, "lot");
  assert.equal(original.features["address:home"].parcelId, "lot");
  const undo = applyMapEditChanges(removed, validateMapEditChanges([
    { kind: "building", id: "roof", value: null },
    { kind: "address", id: "home", value: original.features["address:home"] },
  ]));
  assert.deepEqual(undo.features, original.features);
});
test("valid translated polygons and multipolygons keep holes", () => {
  const hole = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]];
  assert.equal(validateMapEditChanges([{ kind: "parcel", id: "lot", value: { geometry: { type: "Polygon", coordinates: [square.coordinates[0], hole] } } }]).length, 1);
  assert.equal(validateMapEditChanges([{ kind: "building", id: "roof", value: { geometry: { type: "MultiPolygon", coordinates: [square.coordinates] } } }]).length, 1);
});
test("the entire batch rejects duplicate identity, malformed geometry, invalid links, and unknown fields", () => {
  for (const changes of [
    [{ kind: "parcel", id: "LOT", value: {} }, { kind: "parcel", id: "lot", value: {} }],
    [{ kind: "address", id: "home", value: { geometry: square } }],
    [{ kind: "building", id: "roof", value: { geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } } }],
    [{ kind: "address", id: "home", value: { geometry: { type: "Point", coordinates: [181, 42] } } }],
    [{ kind: "building", id: "roof", value: { buildingLinkSet: true, buildingId: "another" } }],
    [{ kind: "address", id: "home", value: { buildingId: "roof" } }],
    [{ kind: "parcel", id: "lot", value: { delete_addresses: true } }],
    [{ kind: "parcel", id: "lot", value: { hidden: "yes" } }],
    [{ kind: "parcel", id: "lot", value: { geometry: { type: "Polygon", coordinates: [[[0, 0], [Infinity, 0], [1, 1], [0, 0]]] } } }],
  ]) assert.throws(() => validateMapEditChanges(changes));
});
test("intentional unlink is distinguishable from untouched data and can be reversed", () => {
  const changes = validateMapEditChanges([{ kind: "address", id: "home", value: { buildingLinkSet: true } }]);
  assert.deepEqual(changes[0].value, { buildingLinkSet: true });
  const restored = applyMapEditChanges(applyMapEditChanges({ revision: 0, features: {} }, changes), [{ kind: "address", id: "home", value: null }]);
  assert.deepEqual(restored.features, {});
});
