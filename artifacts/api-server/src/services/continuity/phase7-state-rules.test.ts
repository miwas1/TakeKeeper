import assert from "node:assert/strict";
import {
  areStatesEquivalent,
  effectiveScopeApplies,
  makeIntentionalDecisionKey,
  makeIssueDimensionKey,
  normalizeState,
  stateDimension,
} from "./normalization";

assert.equal(normalizeState("wardrobe", "Maya's jacket", "zip it"), "closed");
assert.equal(normalizeState("wardrobe", "Maya's jacket", "closed jacket"), "closed");
assert.equal(stateDimension("wardrobe", "Maya's jacket", "zipped"), "closure");
assert.equal(
  makeIssueDimensionKey({ category: "wardrobe", entity: "Maya's jacket", expectedState: "unzipped", observedState: "zipped" }),
  makeIssueDimensionKey({ category: "wardrobe", entity: "Maya jacket", expectedState: "open", observedState: "closed jacket" }),
);
assert(areStatesEquivalent("wardrobe", "Maya's jacket", "unzipped", "open jacket"));

const change = {
  scope: "this_shot",
  changeSceneId: "scene-1",
  currentSceneId: "scene-1",
  effectiveFromShotId: "shot-3b",
  currentShotId: "shot-3b",
  effectiveFromOrder: 4,
};
assert(effectiveScopeApplies({ ...change, currentOrder: 4 }));
assert(!effectiveScopeApplies({ ...change, currentOrder: 5, currentShotId: "shot-3c" }), "shot-only state must not leak to the next shot");
assert(!effectiveScopeApplies({ ...change, currentOrder: 5, currentSceneId: "scene-2", currentShotId: "shot-4a" }), "scene state must not leak to another scene");
assert(effectiveScopeApplies({ ...change, scope: "rest_of_scene", currentOrder: 5, currentShotId: "shot-3c" }));
assert(!effectiveScopeApplies({ ...change, scope: "rest_of_scene", currentOrder: 8, effectiveUntilOrder: 7, currentShotId: "shot-3c" }));

const keyInput = {
  sceneId: "scene-1",
  category: "wardrobe",
  entity: "Maya's jacket",
  sourceTakeId: "take-2",
  effectiveFromTakeId: "take-2",
  effectiveScope: "from_now_on",
  newState: "zipped",
};
assert.equal(makeIntentionalDecisionKey(keyInput), makeIntentionalDecisionKey(keyInput), "a retried approval must have the same deterministic key");
assert.equal(
  makeIntentionalDecisionKey(keyInput),
  makeIntentionalDecisionKey({ ...keyInput, entity: "Maya jacket", newState: "closed jacket" }),
  "normalized state aliases must not create duplicate approvals",
);

console.log("Phase 7 normalized state and scope checks passed");
