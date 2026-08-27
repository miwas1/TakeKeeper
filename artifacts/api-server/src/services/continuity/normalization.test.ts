import assert from "node:assert/strict";
import {
  areStatesEquivalent,
  buildComparisonCandidates,
  calibrateSeverity,
  findMatchingCandidate,
  inferObservationVisibility,
  makeIssueKey,
  normalizeCategory,
  normalizePosition,
} from "./normalization";
import type { ApprovedContinuityItem } from "./normalization";
import type { VisualObservation } from "@workspace/takekeeper-domain";

const item: ApprovedContinuityItem = {
  id: "continuity-item-1",
  category: "wardrobe",
  entity: "Maya's red jacket",
  expectedState: "unzipped",
  sourceType: "script",
  confidence: 0.95,
  active: true,
};

function observation(observedState: string, visibility: VisualObservation["visibility"] = "visible"): VisualObservation {
  return {
    category: "wardrobe",
    entity: "Maya jacket",
    observedState,
    visibility,
    confidence: 0.92,
    region: { x: 0.25, y: 0.2, width: 0.4, height: 0.6 },
  };
}

assert.equal(normalizeCategory("Hair & Makeup"), "hair_makeup");
assert.equal(normalizePosition("Maya's right"), "actor_right");
assert(areStatesEquivalent("wardrobe", "jacket", "unzipped", "open"));
assert(!areStatesEquivalent("wardrobe", "jacket", "unzipped", "zipped"));
assert.equal(inferObservationVisibility({ observedState: "not visible in this frame", visibility: "visible" }), "not_visible");

const hiddenCandidates = buildComparisonCandidates([item], [observation("zipped", "not_visible")]);
assert.equal(hiddenCandidates.length, 0, "not-visible entities must not become mismatches");

const candidates = buildComparisonCandidates([item], [observation("zipped")]);
assert.equal(candidates.length, 1);
assert.equal(
  findMatchingCandidate({
    category: "wardrobe",
    entity: "Maya's jacket",
    expectedState: "open",
    observedState: "zipped",
  }, candidates)?.item.id,
  item.id,
);
assert.equal(
  findMatchingCandidate({
    category: "wardrobe",
    entity: "Maya's jacket",
    expectedState: "face-down",
    observedState: "actor_left",
  }, candidates),
  null,
  "a model issue must match the deterministic candidate states",
);

assert.equal(makeIssueKey({ category: "wardrobe", entity: "Maya's jacket", expectedState: "open", observedState: "zipped" }), "wardrobe|maya jacket|open|closed");
assert.equal(calibrateSeverity("high", 0.55, candidates[0]), "low");
assert.equal(calibrateSeverity("high", 0.92, candidates[0]), "high");

console.log("Phase 6 normalization checks passed");
