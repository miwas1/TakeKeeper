import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const fixtureRoot = new URL("../../attached_assets/demo/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("last-cup-fixture.json", fixtureRoot), "utf8")) as {
  fixtureVersion: number;
  media: Array<{ label: string; file: string }>;
};

assert.equal(manifest.fixtureVersion, 1);
assert.deepEqual(manifest.media.map((item) => item.label), ["Reference A", "Take B", "Take C"]);

const hashes = new Set<string>();
for (const item of manifest.media) {
  const bytes = await readFile(new URL(item.file, fixtureRoot));
  assert.ok(bytes.byteLength > 100_000, `${item.file} is unexpectedly small`);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${item.file} is not a PNG`);
  hashes.add(createHash("sha256").update(bytes).digest("hex"));
}

assert.equal(hashes.size, manifest.media.length, "Every continuity fixture must be a distinct image");
console.log("Last Cup fixture integrity checks passed");
