import assert from "node:assert/strict";
import { roleAllows } from "./authorization";

for (const role of ["owner", "admin", "editor", "viewer"] as const) {
  assert.equal(roleAllows(role, "read"), true, `${role} should be able to read`);
}
for (const role of ["owner", "admin", "editor"] as const) {
  assert.equal(roleAllows(role, "write"), true, `${role} should be able to write`);
}
assert.equal(roleAllows("viewer", "write"), false);
assert.equal(roleAllows("editor", "manage"), false);
assert.equal(roleAllows("admin", "manage"), true);
assert.equal(roleAllows("admin", "delete"), false);
assert.equal(roleAllows("owner", "delete"), true);
assert.equal(roleAllows(null, "read"), false);

console.log("Project role capability checks passed");
