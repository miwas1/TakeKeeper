import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiBase = process.env.TAKEKEEPER_API_URL ?? "http://127.0.0.1:8080/api";
const expectAi = process.env.TAKEKEEPER_EXPECT_AI_SUCCESS !== "false";
const fixtureRoot = new URL("../../attached_assets/demo/", import.meta.url);

async function payload(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  assert.ok(response.ok, `${response.status} ${response.url}: ${JSON.stringify(body)}`);
  return body;
}

async function upload(projectId: string, sceneId: string, file: string) {
  const bytes = await readFile(new URL(file, fixtureRoot));
  const target = await payload(await fetch(`${apiBase}/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, sceneId, fileName: file, contentType: "image/png", size: bytes.byteLength }),
  }));
  const uploadUrl = new URL(String(target.uploadUrl), apiBase).toString();
  const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png", "Content-Length": String(bytes.byteLength) }, body: bytes });
  assert.ok(uploaded.ok, `Fixture upload failed (${uploaded.status})`);
  return payload(await fetch(`${apiBase}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, sceneId, storageKey: target.storageKey, mediaType: "image/png" }),
  }));
}

async function createTake(shotId: string, mediaId: string, key: string, isReference = false) {
  return payload(await fetch(`${apiBase}/shots/${shotId}/takes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId, isReference, submissionKey: key }),
  }));
}

async function waitForCheck(takeId: string) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const result = await payload(await fetch(`${apiBase}/takes/${takeId}/continuity-check`));
    if (["completed", "failed"].includes(result.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Continuity check timed out");
}

const projects = await payload(await fetch(`${apiBase}/projects`)) as unknown as Array<Record<string, any>>;
const project = projects.find((item) => item.title === "The Last Cup");
assert.ok(project, "Seeded Last Cup project is missing");
const projectDetail = await payload(await fetch(`${apiBase}/projects/${project.id}`));
const scene = projectDetail.scenes.find((item: any) => item.sceneNumber === "1");
assert.ok(scene, "Last Cup scene 1 is missing");
const sceneDetail = await payload(await fetch(`${apiBase}/scenes/${scene.id}`));
const shot = sceneDetail.shots.find((item: any) => item.label === "1A");
assert.ok(shot, "Last Cup shot 1A is missing");
const suffix = Date.now().toString(36);

const referenceMedia = await upload(project.id, scene.id, "last-cup-reference-a.png");
const reference = await createTake(shot.id, referenceMedia.id, `last-cup-reference-${suffix}`, true);
const takeBMedia = await upload(project.id, scene.id, "last-cup-take-b.png");
const takeB = await createTake(shot.id, takeBMedia.id, `last-cup-b-${suffix}`);

await payload(await fetch(`${apiBase}/takes/${takeB.id}/continuity-check`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
}));
const checkB = await waitForCheck(takeB.id);

if (!expectAi) {
  assert.equal(checkB.status, "failed", "The no-credential smoke run should fail safely");
  const shotAfterFailure = await payload(await fetch(`${apiBase}/shots/${shot.id}`));
  assert.ok(shotAfterFailure.takes.some((item: any) => item.id === reference.id));
  assert.ok(shotAfterFailure.takes.some((item: any) => item.id === takeB.id));
  console.log("Last Cup live workflow reached the expected credential gate; uploaded takes were preserved");
  process.exit(0);
}

assert.equal(checkB.status, "completed", checkB.errorMessage ?? "Take B analysis failed");
const jacket = checkB.issues.find((issue: any) => issue.entity.toLowerCase().includes("jacket"));
assert.ok(jacket, "Take B should surface the zipped jacket for review");
await payload(await fetch(`${apiBase}/continuity/issues/${jacket.id}/intentional`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newState: "zipped", effectiveScope: "from_now_on", sourceTakeId: takeB.id, idempotencyKey: `last-cup-jacket-${suffix}` }),
}));

const takeCMedia = await upload(project.id, scene.id, "last-cup-take-c.png");
const takeC = await createTake(shot.id, takeCMedia.id, `last-cup-c-${suffix}`);
await payload(await fetch(`${apiBase}/takes/${takeC.id}/continuity-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
const checkC = await waitForCheck(takeC.id);
assert.equal(checkC.status, "completed", checkC.errorMessage ?? "Take C analysis failed");
assert.ok(!checkC.issues.some((issue: any) => issue.status === "open" && issue.entity.toLowerCase().includes("jacket")), "Approved zipped jacket must not be flagged again");
assert.ok(checkC.issues.some((issue: any) => issue.status === "open" && issue.entity.toLowerCase().includes("mug")), "Changed mug should remain reviewable");

await payload(await fetch(`${apiBase}/takes/${takeC.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "circle", isCircle: true }) }));
const shootDate = new Date().toISOString().slice(0, 10);
await payload(await fetch(`${apiBase}/reports/daily`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, shootDate }) }));
const reloaded = await payload(await fetch(`${apiBase}/shots/${shot.id}`));
assert.ok(reloaded.takes.some((item: any) => item.id === takeC.id && item.isCircle));
console.log("Complete Last Cup live continuity workflow passed");
